# NexusPay

Payment gateway orchestration system — Node.js + Vue 3.

A fully-featured payment gateway supporting multiple providers, intelligent routing, and both hosted and embeddable checkout.

## Features

- **Multi-provider routing** — Stripe, Square, Braintree support with weighted-random routing rules
- **Connector management** — connect multiple accounts per provider, set weights, designate a primary
- **Two checkout modes** — hosted pay link + embedded form
- **Complete payment lifecycle** — create → confirm → capture → refund
- **Role-based access control** — OWNER, ADMIN, DEVELOPER, FINANCE, VIEWER
- **Webhook delivery** — configurable endpoints with HMAC signing
- **API key pairs** — `pk_xxx` publishable + `sk_xxx` secret, TEST and LIVE modes
- **MFA** — TOTP-based two-factor authentication with backup codes
- **Merchant dashboard** — payments, refunds, routing rules, connectors, API keys, logs, members

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js, Express, TypeScript |
| Frontend | Vue 3, Vite, Tailwind CSS, Pinia |
| Database | PostgreSQL, Knex.js migrations |
| Auth | JWT + API key authentication |
| Charts | Chart.js + vue-chartjs |

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL 14+

### Option A — Docker (recommended)

```bash
cp .env.example .env
docker compose up --build
```

- Dashboard: http://localhost:5173
- Backend API: http://localhost:3001

### Option B — Local Development

**1. Database**

```bash
createdb nexuspay
```

**2. Backend**

```bash
cd backend
cp .env.example .env
npm install
npm run migrate
npm run dev
```

**3. Frontend**

```bash
cd frontend
npm install
npm run dev
```

**4. Create Account**

Open http://localhost:5173 and register. The first registration creates a merchant account with the OWNER role.

## Project Structure

```
nexuspay/
├── backend/               Node.js Express backend
│   ├── src/
│   │   ├── config/        App configuration
│   │   ├── db/            Database connection & migrations
│   │   ├── middleware/     Auth, logging middleware
│   │   ├── routes/        API route handlers
│   │   ├── services/      Business logic
│   │   └── utils/         Crypto utilities
│   └── Dockerfile
├── frontend/              Vue 3 dashboard
│   ├── src/
│   │   ├── components/    Shared components
│   │   ├── layouts/       Page layouts
│   │   ├── lib/           API client
│   │   ├── pages/         Route pages
│   │   ├── router/        Vue Router config
│   │   └── stores/        Pinia stores
│   └── Dockerfile
├── docker-compose.yml
└── README.md
```

## API Overview

All merchant endpoints are under `/api/v1/` and require `Authorization: Bearer sk_xxx`.
Public checkout endpoints are under `/pub/`.

| Resource | Endpoint |
|----------|----------|
| Auth | `/api/v1/auth/` |
| Payment Intents | `/api/v1/payment-intents/` |
| Merchant Resources | `/api/v1/merchants/{id}/...` |
| Public Checkout | `/pub/pay/{token}`, `/pub/tokenize` |

## Configuring Provider Webhooks

NexusPay receives provider events at the following URLs (`PAY_BASE_URL` is the
public base URL of the backend, e.g. `https://api.example.com`):

| Provider  | URL                                  | Notes |
|-----------|--------------------------------------|-------|
| Stripe    | `${PAY_BASE_URL}/webhooks/stripe`    | Set `STRIPE_WEBHOOK_SECRET` in the backend `.env` to the value Stripe gave you. |
| Square    | `${PAY_BASE_URL}/webhooks/square`    | Per-connector. Set the same URL in the Square Dashboard subscription **and** in the connector's `provider_config.webhookNotificationUrl` (or leave the latter unset to use the default). The signature key from Square goes into the connector's credentials as `webhookSignatureKey`. |
| Braintree | `${PAY_BASE_URL}/webhooks/braintree` | The handler responds to Braintree's `bt_challenge` GET verification automatically using the `publicKey`/`privateKey` of any active Braintree connector. |

### Square — exact-URL signature requirement

Square computes the signature as `HMAC-SHA256(signingKey, notificationUrl + rawBody)`.
The `notificationUrl` **must match exactly** the URL configured in the Square
Dashboard, including scheme/host/path. If your backend is behind a proxy,
either:

1. set `provider_config.webhookNotificationUrl` on the Square connector to
   the public URL Square sees, **or**
2. set `PAY_BASE_URL` so the default `${PAY_BASE_URL}/webhooks/square` matches.

If the URL doesn't match, signature verification fails with `400 Invalid signature`.

### Braintree — webhook URL verification

When you register the webhook URL in the Braintree gateway, it sends a `GET`
to `?bt_challenge=...`. NexusPay's `/webhooks/braintree` GET handler answers
with `${publicKey}|${HMAC-SHA1(SHA1(privateKey), bt_challenge).hex}` for the
first active Braintree connector — so you can paste the URL and it Just Works
as long as you've already saved the connector with both keys.

## Email Delivery

Invitation links and password reset emails are sent via SMTP when configured:

```env
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASSWORD=...
SMTP_FROM=NexusPay <no-reply@yourdomain.com>
```

When `SMTP_HOST` is empty (the default), the message is logged to stdout
instead — useful for local development. The dashboard always shows the
generated invite URL so flows still work end-to-end without SMTP.
