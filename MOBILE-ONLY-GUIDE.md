# মোবাইল-অনলি সেটআপ গাইড

এই সিস্টেমটি Android ফোনের Chrome ব্রাউজার দিয়েই সেটআপ ও ব্যবহার করা যাবে। কম্পিউটার বা Termux প্রয়োজন নেই।

## ১) GitHub
Chrome-এ GitHub খুলে নতুন repository তৈরি করুন। এই ZIP-এর ফাইলগুলো repository-তে আপলোড করুন। `public/index.html` অবশ্যই `public` folder-এর ভিতরে থাকবে।

## ২) Render
Render-এ GitHub repository connect করে New → Web Service করুন।
Build Command: `npm install`
Start Command: `npm start`
তারপর Deploy করুন।

## ৩) PostgreSQL
Render-এ New → PostgreSQL তৈরি করুন। পাওয়া Internal Database URL-টি Web Service-এর `DATABASE_URL` হিসেবে দিন।

## ৪) Environment Variables
`ADMIN_USERNAME`, `ADMIN_PASSWORD`, `JWT_SECRET`, `DATABASE_URL`, `GRAPH_API_VERSION`, `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `ADMIN_WHATSAPP_NUMBER`, `META_VERIFY_TOKEN` সেট করুন।

## ৫) Meta Webhook
Callback URL: `https://YOUR-APP.onrender.com/webhook`
Verify Token: Render-এর `META_VERIFY_TOKEN`-এর একই value। Messages webhook subscribe করুন।

## ৬) ব্যবহার
`https://YOUR-APP.onrender.com` খুলে admin login করুন। Customer add/edit/remove, order, bill, payment ও due সব ফোন থেকেই করা যাবে।

## ৭) অ্যাপের মতো ব্যবহার
Chrome → ⋮ → Add to Home screen। এতে Home Screen থেকে সরাসরি সিস্টেম খুলতে পারবেন।

## গুরুত্বপূর্ণ
Customer-এর incoming text order save হয়ে admin WhatsApp নম্বরে forward হবে। Admin panel থেকে bill amount দিলেই customer-এর WhatsApp-এ bill পাঠানো যাবে। Customer remove করলে history রাখা থাকবে।
