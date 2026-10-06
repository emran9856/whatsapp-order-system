require("dotenv").config();

const express = require("express");
const jwt = require("jsonwebtoken");
const bcrypt = require("bcryptjs");
const { Pool } = require("pg");

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

const PORT = process.env.PORT || 3000;

const required = [
  "DATABASE_URL",
  "JWT_SECRET",
  "ADMIN_USERNAME",
  "ADMIN_PASSWORD",
  "GRAPH_API_VERSION",
  "WHATSAPP_ACCESS_TOKEN",
  "WHATSAPP_PHONE_NUMBER_ID",
  "ADMIN_WHATSAPP_NUMBER",
  "META_VERIFY_TOKEN"
];

for (const key of required) {
  if (!process.env[key]) console.warn(`Missing environment variable: ${key}`);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes("localhost")
    ? false
    : { rejectUnauthorized: false }
});

async function initDb() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS customers (
      id BIGSERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      phone TEXT NOT NULL UNIQUE,
      address TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS orders (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT REFERENCES customers(id) ON DELETE SET NULL,
      customer_phone TEXT NOT NULL,
      message_text TEXT NOT NULL,
      amount NUMERIC(12,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS ledger (
      id BIGSERIAL PRIMARY KEY,
      customer_id BIGINT NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('bill','payment')),
      amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
      note TEXT DEFAULT '',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );
  `);
}

function normalizePhone(phone) {
  return String(phone || "").replace(/\D/g, "");
}

function auth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;

  if (!token) return res.status(401).json({ error: "Login required" });

  try {
    req.user = jwt.verify(token, process.env.JWT_SECRET);
    next();
  } catch {
    return res.status(401).json({ error: "Invalid or expired login" });
  }
}

async function sendWhatsAppText(to, body) {
  const url =
    `https://graph.facebook.com/${process.env.GRAPH_API_VERSION}/` +
    `${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`;

  const response = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: normalizePhone(to),
      type: "text",
      text: {
        preview_url: false,
        body
      }
    })
  });

  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data?.error?.message || "WhatsApp API error");
    error.meta = data;
    throw error;
  }

  return data;
}

function verifyMetaSignatureIfConfigured(req) {
  // For a production hardening step, validate X-Hub-Signature-256
  // with your Meta App Secret. The basic setup below relies on
  // the Meta webhook verification token.
  return true;
}

/* ---------------- AUTH ---------------- */

app.post("/api/login", async (req, res) => {
  const { username, password } = req.body || {};

  if (
    username !== process.env.ADMIN_USERNAME ||
    password !== process.env.ADMIN_PASSWORD
  ) {
    return res.status(401).json({ error: "Wrong username or password" });
  }

  const token = jwt.sign(
    { username, role: "admin" },
    process.env.JWT_SECRET,
    { expiresIn: "7d" }
  );

  res.json({ token });
});

/* ---------------- DASHBOARD ---------------- */

app.get("/api/dashboard", auth, async (req, res) => {
  const customers = await pool.query(
    `SELECT COUNT(*)::int AS count FROM customers WHERE active = TRUE`
  );
  const orders = await pool.query(
    `SELECT COUNT(*)::int AS count FROM orders WHERE created_at >= CURRENT_DATE`
  );
  const sales = await pool.query(
    `SELECT COALESCE(SUM(amount),0)::numeric AS total
     FROM ledger WHERE type='bill' AND created_at >= CURRENT_DATE`
  );
  const due = await pool.query(`
    SELECT COALESCE(SUM(
      CASE WHEN l.type='bill' THEN l.amount ELSE -l.amount END
    ),0)::numeric AS total
    FROM ledger l
    JOIN customers c ON c.id=l.customer_id
    WHERE c.active=TRUE
  `);

  res.json({
    customers: customers.rows[0].count,
    ordersToday: orders.rows[0].count,
    salesToday: sales.rows[0].total,
    totalDue: due.rows[0].total
  });
});

/* ---------------- CUSTOMERS ---------------- */

app.get("/api/customers", auth, async (req, res) => {
  const q = String(req.query.q || "").trim();
  const result = await pool.query(
    `SELECT c.*,
      COALESCE(SUM(CASE WHEN l.type='bill' THEN l.amount ELSE 0 END),0)::numeric AS total_billed,
      COALESCE(SUM(CASE WHEN l.type='payment' THEN l.amount ELSE 0 END),0)::numeric AS total_paid,
      COALESCE(SUM(CASE WHEN l.type='bill' THEN l.amount ELSE -l.amount END),0)::numeric AS due
     FROM customers c
     LEFT JOIN ledger l ON l.customer_id=c.id
     WHERE c.active=TRUE
       AND ($1='' OR c.name ILIKE '%'||$1||'%' OR c.phone ILIKE '%'||$1||'%')
     GROUP BY c.id
     ORDER BY c.created_at DESC`,
    [q]
  );

  res.json(result.rows);
});

app.post("/api/customers", auth, async (req, res) => {
  const { name, phone, address = "", notes = "" } = req.body || {};
  const normalized = normalizePhone(phone);

  if (!name?.trim() || !normalized) {
    return res.status(400).json({ error: "Name and phone are required" });
  }

  try {
    const result = await pool.query(
      `INSERT INTO customers(name, phone, address, notes, active)
       VALUES($1,$2,$3,$4,TRUE)
       ON CONFLICT(phone) DO UPDATE SET
         name=EXCLUDED.name,
         address=EXCLUDED.address,
         notes=EXCLUDED.notes,
         active=TRUE,
         updated_at=NOW()
       RETURNING *`,
      [name.trim(), normalized, address, notes]
    );
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put("/api/customers/:id", auth, async (req, res) => {
  const { name, phone, address = "", notes = "" } = req.body || {};
  const normalized = normalizePhone(phone);

  if (!name?.trim() || !normalized) {
    return res.status(400).json({ error: "Name and phone are required" });
  }

  try {
    const result = await pool.query(
      `UPDATE customers
       SET name=$1, phone=$2, address=$3, notes=$4, active=TRUE, updated_at=NOW()
       WHERE id=$5
       RETURNING *`,
      [name.trim(), normalized, address, notes, req.params.id]
    );

    if (!result.rowCount) return res.status(404).json({ error: "Customer not found" });
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Soft delete: customer disappears from active list but history remains.
app.delete("/api/customers/:id", auth, async (req, res) => {
  const result = await pool.query(
    `UPDATE customers SET active=FALSE, updated_at=NOW()
     WHERE id=$1 RETURNING id`,
    [req.params.id]
  );

  if (!result.rowCount) return res.status(404).json({ error: "Customer not found" });
  res.json({ ok: true });
});

/* ---------------- ORDERS ---------------- */

app.get("/api/customers/:id/orders", auth, async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM orders WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 200`,
    [req.params.id]
  );
  res.json(result.rows);
});

/* ---------------- BILLING ---------------- */

app.post("/api/customers/:id/bill", auth, async (req, res) => {
  const amount = Number(req.body.amount);
  const note = String(req.body.note || "").trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Enter a valid bill amount" });
  }

  const customerResult = await pool.query(
    `SELECT * FROM customers WHERE id=$1 AND active=TRUE`,
    [req.params.id]
  );

  if (!customerResult.rowCount) {
    return res.status(404).json({ error: "Customer not found" });
  }

  const customer = customerResult.rows[0];

  await pool.query(
    `INSERT INTO ledger(customer_id,type,amount,note)
     VALUES($1,'bill',$2,$3)`,
    [customer.id, amount, note]
  );

  const balanceResult = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN type='bill' THEN amount ELSE -amount END),0)::numeric AS due
     FROM ledger WHERE customer_id=$1`,
    [customer.id]
  );

  const due = Number(balanceResult.rows[0].due);

  const message =
`📋 আপনার হিসাব

👤 নাম: ${customer.name}
💰 নতুন বিল: ${amount.toFixed(2)}
📌 মোট বাকি: ${due.toFixed(2)}

${note ? `📝 নোট: ${note}\n` : ""}
ধন্যবাদ।`;

  let whatsapp = null;
  try {
    whatsapp = await sendWhatsAppText(customer.phone, message);
  } catch (e) {
    return res.status(502).json({
      error: "Bill saved, but WhatsApp message could not be sent.",
      detail: e.meta || e.message,
      due
    });
  }

  res.json({ ok: true, due, whatsapp });
});

app.post("/api/customers/:id/payment", auth, async (req, res) => {
  const amount = Number(req.body.amount);
  const note = String(req.body.note || "").trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    return res.status(400).json({ error: "Enter a valid payment amount" });
  }

  const customerResult = await pool.query(
    `SELECT * FROM customers WHERE id=$1 AND active=TRUE`,
    [req.params.id]
  );

  if (!customerResult.rowCount) {
    return res.status(404).json({ error: "Customer not found" });
  }

  const customer = customerResult.rows[0];

  await pool.query(
    `INSERT INTO ledger(customer_id,type,amount,note)
     VALUES($1,'payment',$2,$3)`,
    [customer.id, amount, note]
  );

  const balanceResult = await pool.query(
    `SELECT COALESCE(SUM(CASE WHEN type='bill' THEN amount ELSE -amount END),0)::numeric AS due
     FROM ledger WHERE customer_id=$1`,
    [customer.id]
  );

  const due = Number(balanceResult.rows[0].due);

  res.json({ ok: true, due });
});

app.get("/api/customers/:id/ledger", auth, async (req, res) => {
  const result = await pool.query(
    `SELECT * FROM ledger WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 500`,
    [req.params.id]
  );
  res.json(result.rows);
});

/* ---------------- WHATSAPP WEBHOOK ---------------- */

app.get("/webhook", (req, res) => {
  const mode = req.query["hub.mode"];
  const token = req.query["hub.verify_token"];
  const challenge = req.query["hub.challenge"];

  if (mode === "subscribe" && token === process.env.META_VERIFY_TOKEN) {
    return res.status(200).send(challenge);
  }

  res.sendStatus(403);
});

app.post("/webhook", async (req, res) => {
  try {
    if (!verifyMetaSignatureIfConfigured(req)) {
      return res.sendStatus(403);
    }

    // Always acknowledge quickly so Meta doesn't retry unnecessarily.
    res.sendStatus(200);

    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    const message = value?.messages?.[0];

    if (!message) return;

    const from = normalizePhone(message.from);
    if (!from) return;

    let text = "";
    if (message.type === "text") {
      text = message.text?.body || "";
    } else {
      text = `[${message.type} message received]`;
    }

    const customerResult = await pool.query(
      `SELECT * FROM customers WHERE phone=$1 LIMIT 1`,
      [from]
    );

    let customer = customerResult.rows[0];

    // Do NOT recreate a customer who was deliberately removed.
    if (!customer) {
      console.log("Unknown customer message:", from);
      await sendWhatsAppText(
        from,
        "আপনার নম্বরটি এখনো customer list-এ যোগ করা হয়নি। অনুগ্রহ করে কর্তৃপক্ষের সাথে যোগাযোগ করুন।"
      ).catch(() => {});
      return;
    }

    if (!customer.active) {
      await sendWhatsAppText(
        from,
        "আপনার customer account বর্তমানে inactive। অনুগ্রহ করে কর্তৃপক্ষের সাথে যোগাযোগ করুন।"
      ).catch(() => {});
      return;
    }

    await pool.query(
      `INSERT INTO orders(customer_id, customer_phone, message_text)
       VALUES($1,$2,$3)`,
      [customer.id, from, text]
    );

    const forward =
`📦 নতুন অর্ডার

👤 Customer: ${customer.name}
📱 WhatsApp: +${from}

📝 Message:
${text}

⏰ ${new Date().toLocaleString("en-GB", { timeZone: "Asia/Riyadh" })}`;

    await sendWhatsAppText(process.env.ADMIN_WHATSAPP_NUMBER, forward);
  } catch (e) {
    console.error("Webhook error:", e);
  }
});

/* ---------------- HEALTH ---------------- */

app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true });
  } catch {
    res.status(500).json({ ok: false });
  }
});

app.get("*", (req, res) => {
  res.sendFile(require("path").join(__dirname, "public", "index.html"));
});

initDb()
  .then(() => {
    app.listen(PORT, "0.0.0.0", () => {
      console.log(`Server listening on port ${PORT}`);
    });
  })
  .catch((err) => {
    console.error("Database initialization failed:", err);
    process.exit(1);
  });
