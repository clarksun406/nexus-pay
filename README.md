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
