# WhatsApp Order + Billing System

This project uses:

- Meta WhatsApp Cloud API
- Node.js + Express
- PostgreSQL
- Simple Admin Panel

## Features

- Customer add
- Customer edit
- Customer soft-remove
- Incoming WhatsApp order webhook
- Forward incoming order to admin WhatsApp number
- Store order history
- Add bill to a customer
- Automatically calculate billed / paid / due
- Send the new bill + current due to the customer's WhatsApp
- Add payments
- Customer search
- Dashboard

## Important WhatsApp rule

The code sends normal text messages through the Cloud API. Whether Meta allows a particular outbound message depends on the current WhatsApp messaging rules and conversation window. If the customer is outside the applicable customer-service window, you may need an approved template or another supported utility-message mechanism. Do not try to bypass Meta's messaging policies.

## 1. Install Node.js

Install Node.js 20+ from:
https://nodejs.org/

## 2. Create the Meta app

Use:
https://developers.facebook.com/

Create a Meta app, add WhatsApp, and obtain:

- WhatsApp Business Account ID (WABA ID)
- Phone Number ID
- System User access token with the required WhatsApp permissions
- A business phone number connected to WhatsApp Cloud API

The official Meta collection explains that Cloud API requires a Meta business portfolio, WhatsApp Business Account and business phone number.

## 3. PostgreSQL

For production, create a PostgreSQL database. Render is one option:
https://render.com/

Copy its connection string into DATABASE_URL.

## 4. Local setup

Open a terminal in this folder:

npm install

Copy `.env.example` to `.env` and fill in the values.

Then:

npm start

Open:
http://localhost:3000

## 5. Meta webhook

After the app is deployed publicly, your webhook URL is:

https://YOUR-APP.onrender.com/webhook

Verification token:
the exact value you placed in META_VERIFY_TOKEN.

Subscribe your WhatsApp app/WABA to webhook events.

## 6. Environment variables

Set these:

PORT=3000
APP_BASE_URL=https://YOUR-APP.onrender.com
ADMIN_USERNAME=admin
ADMIN_PASSWORD=your-long-password
JWT_SECRET=your-long-random-secret
DATABASE_URL=your-postgresql-url
GRAPH_API_VERSION=vXX.X
WHATSAPP_ACCESS_TOKEN=your-token
WHATSAPP_PHONE_NUMBER_ID=your-phone-number-id
WHATSAPP_BUSINESS_ACCOUNT_ID=your-waba-id
ADMIN_WHATSAPP_NUMBER=9665XXXXXXXX
META_VERIFY_TOKEN=your-webhook-token

## 7. Customer phone format

Store numbers as digits only with country code.

Example:
9665XXXXXXXX

Do not put:
+966 5XXXXXXXX

## 8. Deploy to Render

Push this folder to GitHub.

In Render:
New -> Web Service -> connect the GitHub repo.

Build command:
npm install

Start command:
npm start

Add the environment variables in Render.

Render's Node web-service documentation supports npm install/npm start style deployments.

## 9. First test

1. Add your own customer number in Admin.
2. Send a WhatsApp message from that number to the business API number.
3. The webhook should save the order.
4. The order should be forwarded to ADMIN_WHATSAPP_NUMBER.
5. Open that customer in Admin.
6. Enter a bill amount.
7. Click Save & Send Bill.
8. The system records the bill, recalculates due, and attempts to send the bill to the customer's WhatsApp.

## Security notes

- Never commit `.env`.
- Use a long random ADMIN_PASSWORD.
- Use a long random JWT_SECRET.
- Use a System User access token for production instead of a short-lived test token.
- For a production deployment, add Meta webhook signature validation with your App Secret.
- For a production business, consider using a managed PostgreSQL database with backups.

