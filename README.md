# NexusPay

Payment gateway orchestration system — Node.js + Vue 3.

A fully-featured payment gateway supporting multiple providers, intelligent routing, and both hosted and embeddable checkout.

## Features

### Core Payment Platform
- **Multi-provider routing** — Stripe, Square, Braintree support with weighted-random routing rules
- **Connector management** — connect multiple accounts per provider, set weights, designate a primary
- **Two checkout modes** — hosted pay link + embedded form
- **Complete payment lifecycle** — create → confirm → capture → refund
- **Role-based access control** — OWNER, ADMIN, DEVELOPER, FINANCE, VIEWER
- **Webhook delivery** — configurable endpoints with HMAC signing
- **API key pairs** — `pk_xxx` publishable + `sk_xxx` secret, TEST and LIVE modes
- **MFA** — TOTP-based two-factor authentication with backup codes
- **Merchant dashboard** — payments, refunds, routing rules, connectors, API keys, logs, members

### Payment Orchestration (P0)
- **Smart Retry Engine** — decline-code-aware retries (immediate for network errors, delayed for soft declines) with card BIN routing and automatic 3DS upgrade on soft declines
- **Reconciliation System** — three-way reconciliation (internal + PSP + bank), automatic PSP data pull (Stripe Balance Transactions), bank settlement import, historical backfill up to 366 days
- **Channel Health Monitor** — real-time success rate and latency percentiles (p95/p99) with automatic demotion and historical trend analysis
- **3DS Authentication** — 2.x challenge + frictionless flows, 1.0 PaReq/PaRes redirect flow, ECI-based liability shift recording

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
├── backend/                    Node.js Express backend
│   ├── src/
│   │   ├── config/             App configuration
│   │   ├── db/                 Database connection & migrations
│   │   │   └── migrations/     001_initial_schema
│   │   │                       002_retry_and_reconciliation
│   │   │                       003_p0_completion (BIN/settlement/3DS-liability)
│   │   ├── middleware/         Auth (JWT + API key), request logging
│   │   ├── routes/             API route handlers
│   │   │   ├── auth            registration/login/refresh/mfa
│   │   │   ├── payment-intent  create/confirm/capture/refund/cancel
│   │   │   ├── merchant        connectors/routing-rules/payment-links/webhooks/api-keys
│   │   │   ├── public          hosted checkout + tokenize
│   │   │   ├── retry           retry-config / retry-stats / decline-codes / BIN / 3DS-upgrade
│   │   │   ├── health          dashboard / metrics / trend / thresholds
│   │   │   ├── reconciliation  sources / run / backfill / sync / settlements
│   │   │   └── threeds         sessions / challenge / pares / liability-shifts
│   │   ├── services/           Business logic (see below)
│   │   └── utils/              AES encryption helper
│   └── Dockerfile
├── frontend/                   Vue 3 dashboard
│   ├── src/
│   │   ├── components/         Sidebar, TopBar
│   │   ├── layouts/            Dashboard
│   │   ├── lib/                Axios API client w/ 401 auto-refresh
│   │   ├── pages/              Route pages (17 views)
│   │   ├── router/             Vue Router + auth guards
│   │   └── stores/             Pinia (auth + persistedstate)
│   └── Dockerfile
├── docker-compose.yml          postgres 16 + backend + frontend
├── ROADMAP.md                  Feature roadmap (P0–P4)
└── README.md
```

### Backend Services (domain layer)

| Service | Purpose |
|---------|---------|
| `auth.service` | registration, login, MFA (TOTP), refresh tokens |
| `payment-intent.service` | payment lifecycle, idempotency, connector resolution |
| `payment-link.service` | hosted pay links |
| `connector.service` | CRUD for provider accounts, credential encryption |
| `routing-engine` | rule priority + weighted-random provider selection |
| `routing-rule.service` | CRUD for merchant routing rules |
| `provider-dispatcher` | unified charge/capture/cancel/refund across Stripe/Square/Braintree |
| `refund.service` | refund lifecycle |
| `webhook.service` | HMAC-signed webhook delivery + retries |
| `apikey.service` | `pk_`/`sk_` keypair generation, TEST/LIVE mode |
| `member.service` | invite/role management |
| `log.service` | gateway_logs persistence |
| `retry.service` | decline-code-aware retry strategy + BIN routing + 3DS upgrade |
| `decline-code.service` | Stripe decline code categorization |
| `bin-routing.service` | card BIN registry + preferred provider scoring |
| `scheduler.service` | retry execution, health check, PSP sync, settlement freshness |
| `reconciliation.service` | three-way reconciliation + bank settlement + historical backfill |
| `psp-sync.service` | PSP transaction auto-pull (Stripe adapter) |
| `health-monitor.service` | success rate + latency p95/p99 + trend + auto-demotion |
| `threeds.service` | 3DS 1.0 + 2.x sessions, frictionless, liability shift |

## Scheduler Tasks

The backend starts an in-process scheduler on boot (`services/scheduler.service.ts`) with four periodic jobs:

| Task | Interval |
|------|----------|
| Retry execution (due scheduled retries) | every 1 min |
| Health check (error rate + latency thresholds, auto-demotion) | every 5 min |
| PSP auto-sync (pull new transactions from Stripe) | every 15 min |
| Settlement freshness check (stale pending settlements) | every 6 h |

For multi-instance deployments, introduce a distributed lock (e.g. `pg_advisory_lock` or Redis) — see ROADMAP.md P4 基建.

## API Overview

All merchant endpoints are under `/api/v1/` and require `Authorization: Bearer sk_xxx`.
Public checkout endpoints are under `/pub/`.

| Resource | Endpoint |
|----------|----------|
| Auth | `/api/v1/auth/` |
| Payment Intents | `/api/v1/payment-intents/` |
| Merchant Resources | `/api/v1/merchants/{id}/...` |
| Public Checkout | `/pub/pay/{token}`, `/pub/tokenize` |

### P0 Orchestration APIs

| Resource | Endpoint |
|----------|----------|
| Retry Config | `GET/PUT /api/v1/merchants/:id/retry-config` |
| Retry Stats | `GET /api/v1/merchants/:id/retry-stats` |
| Decline Codes | `GET /api/v1/decline-codes` |
| Card BIN Registry | `GET /api/v1/bin/:bin`, `GET /api/v1/bin`, `POST /api/v1/bin` |
| 3DS Upgrade Retry | `POST /api/v1/payment-intents/:id/3ds-upgrade-retry` |
| Health Dashboard | `GET /api/v1/merchants/:id/health` |
| Connector Metrics | `GET /api/v1/connectors/:id/health` |
| Latency Trend | `GET /api/v1/connectors/:id/health/trend` |
| Restore Connector | `POST /api/v1/connectors/:id/restore` |
| Health Thresholds | `PUT /api/v1/merchants/:id/health-thresholds` |
| Reconciliation Source | `POST /api/v1/merchants/:id/reconciliation/sources` |
| Import Transactions | `POST /api/v1/reconciliation/sources/:id/import` |
| PSP Sync | `POST /api/v1/merchants/:id/reconciliation/sync`, `POST /api/v1/reconciliation/sources/:id/sync` |
| Run Reconciliation | `POST /api/v1/merchants/:id/reconciliation/run` |
| Historical Backfill | `POST /api/v1/merchants/:id/reconciliation/backfill` |
| Bank Settlement | `POST /api/v1/merchants/:id/reconciliation/settlements`, `GET .../settlements` |
| Discrepancies | `GET /api/v1/reconciliation/reports/:id/discrepancies`, `GET /api/v1/merchants/:id/reconciliation/discrepancies/open` |
| Resolve Discrepancy | `POST /api/v1/reconciliation/discrepancies/:id/resolve` |
| 3DS Session | `POST /api/v1/payment-intents/:id/3ds/session`, `GET/PUT /api/v1/3ds/sessions/:id` |
| 3DS Challenge | `POST /api/v1/3ds/sessions/:id/challenge`, `POST /api/v1/3ds/challenges/:id/submit` |
| 3DS 1.0 PaRes | `POST /api/v1/3ds/sessions/:id/pares` |
| Liability Shifts | `GET /api/v1/payment-intents/:id/3ds/liability-shifts` |

## Roadmap

See [ROADMAP.md](./ROADMAP.md) for the feature roadmap. P0 core capabilities (retry engine, reconciliation, channel health, 3DS) are complete; P1 (network tokenization, cost routing, fraud engine, refund sync) is planned next.
