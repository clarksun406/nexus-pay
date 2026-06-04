# NexusPay

> **Payment gateway orchestration system** — one API in front of Stripe, Square and Braintree, with merchant onboarding, weighted/cost-aware routing, hosted + embedded checkout, dispute and payout reconciliation, and a self-service dashboard.

NexusPay does **not** clear card transactions itself. It sits between your code and the card networks' acquirers, providing:

- A **single, consistent API** for payments, refunds, captures and cancellations.
- **Intelligent routing** across multiple PSP accounts (failover, weighted random, or cheapest-by-fees).
- A **merchant dashboard** for ops users (payments, refunds, disputes, payouts, connectors, members).
- **Hosted payment links** and an **embedded checkout** flow with token vaulting.
- **Outbound + inbound webhook** processing, with HMAC signing, idempotency and retries.
- **Multi-tenant RBAC** down to the merchant level (OWNER / ADMIN / DEVELOPER / FINANCE / VIEWER).

See [`ROADMAP.md`](./ROADMAP.md) for current status and what's next.

---

## Table of contents

- [Features](#features)
- [Architecture](#architecture)
- [Tech stack](#tech-stack)
- [Quick start](#quick-start)
- [Configuration](#configuration)
- [Provider setup](#provider-setup)
- [Webhooks](#webhooks)
- [API reference](#api-reference)
- [Security model](#security-model)
- [Development](#development)
- [Project structure](#project-structure)
- [License](#license)

---

## Features

### Payments
- **PaymentIntent state machine** (`REQUIRES_PAYMENT_METHOD` → `REQUIRES_CONFIRMATION` → `PROCESSING` → `REQUIRES_ACTION` → `REQUIRES_CAPTURE` → `SUCCEEDED` / `FAILED` / `CANCELED`).
- **Idempotency keys** required on `create`; safe replay returns the existing intent.
- **Manual / automatic capture** (Stripe `capture_method`, Square `autocomplete`, Braintree `authorizePaymentMethod`).
- **3DS / SCA**: `REQUIRES_ACTION` is a real state — the dashboard surfaces the `next_action` URL and the public checkout redirects automatically.
- **Refunds** (full or partial) actually call the provider and emit merchant-facing webhook events.

### Connectors & routing
- One merchant can configure **multiple connectors per provider** (e.g. two Stripe accounts in different geos).
- Per-connector **fee config** (`{ fixed, percentage }` in minor units) drives both routing and payouts.
- **Routing rules** matched by currency, amount range, country code, payment method type, with `priority` and `max_cost_bps`.
- **Selection strategies**: weighted-random (default) or cheapest-by-fees (`{ costAware: true }`).
- **Fallback connector** per rule.

### Hosted + embedded checkout
- **Payment links** (`/pay/:token`) for hosted one-tap checkout.
- **Embedded** flow via publishable key + `/pub/tokenize` returning a single-use `gw_tok_…` that the secret-key flow consumes.

### Dispute handling
- Inbound webhooks ingest disputes from Stripe, Square and Braintree.
- Internal status enum: `OPEN`, `UNDER_REVIEW`, `WARNING_NEEDS_RESPONSE`, `WON`, `LOST`, `CHARGE_REFUNDED`.
- Dashboard supports **draft + submit of evidence** (text fields submitted to Stripe directly; Square / Braintree saved locally pending file-upload integration).
- `dispute.created`, `dispute.updated`, `dispute.won`, `dispute.lost` etc. emitted to merchant webhooks.

### Reconciliation / payouts
- Hourly worker aggregates SUCCEEDED payments and refunds per `(merchant, connector, currency, mode)` into idempotent payout summaries with per-item breakdown.
- **Internal reconciliation view** — actual money movement is handled by the provider's own payout schedule. The numbers let merchants verify what's about to be deposited.

### Webhook delivery (outbound to merchants)
- Transactional outbox pattern: PaymentIntent / Refund / Dispute writes append to `outbox_events` in the same DB transaction.
- Background worker fans out to subscribed `webhook_endpoints`, signs payloads with HMAC-SHA256 (`X-NexusPay-Signature: t=…,v1=…`), and retries with exponential backoff (1m → 6h, max 6 attempts).

### Webhook ingestion (inbound from providers)
- **Stripe**: HMAC-SHA256 signed payload + replay protection (5 min default tolerance).
- **Square**: per-connector signature key, exact-URL HMAC verification.
- **Braintree**: dual-key (`bt_signature` + `bt_payload`) verification, with the handler also responding to the gateway's URL-verification `GET /webhooks/braintree?bt_challenge=…`.
- Idempotent via `processed_webhook_events`.

### Auth & RBAC
- Email + password with bcrypt (cost 12).
- **TOTP MFA** with 8 backup codes; mid-login MFA sessions persisted in DB (not in-process).
- **Refresh-token rotation**: persisted (hashed), one-shot, replay-detected.
- **Password reset** via single-use, hashed, 1h-TTL token.
- **Account enumeration protection** on `forgot-password` (always 204).
- **Role-based access control** with five merchant roles, enforced on every dashboard endpoint via `requireRole(...)`.
- **API keys**: `pk_*` + `sk_*`, stored only as SHA-256 hash, raw key shown once, **rotation** supported (new key issued + old revoked atomically).

### Security
- **AES-256-GCM credential encryption** for provider secrets in the DB (server refuses to start storing creds without a valid key).
- **Sensitive data scrubbing** on every logged request body and a strict header allowlist; webhook bodies aren't logged at all.
- **Rate limiting** (token bucket) on `/auth` (per IP), `/pub` (per IP) and `/api/v1/payment-intents` (per API key).
- **Request IDs** propagated end-to-end (`X-Request-Id`) and recorded as `trace_id`.

### Observability
- Per-request logging into `gateway_logs` with status, duration and trace id.
- Health check at `/health`.
- (Stub) Prometheus endpoint at `/actuator/prometheus`.

### Payment Orchestration (P0)
- **Smart Retry Engine** — decline-code-aware retries (immediate for network errors, delayed for soft declines) with card BIN routing and automatic 3DS upgrade on soft declines
- **Reconciliation System** — three-way reconciliation (internal + PSP + bank), automatic PSP data pull (Stripe Balance Transactions), bank settlement import, historical backfill up to 366 days
- **Channel Health Monitor** — real-time success rate and latency percentiles (p95/p99) with automatic demotion and historical trend analysis
- **3DS Authentication** — 2.x challenge + frictionless flows, 1.0 PaReq/PaRes redirect flow, ECI-based liability shift recording

---

## Architecture

```
                        ┌────────────────────────────────────────────────┐
                        │                  Frontend (Vue 3)              │
                        │   Dashboard · Hosted Pay · Embedded Checkout   │
                        └──────────────┬─────────────────────────────────┘
                                       │ HTTPS
                                       ▼
   ┌───────────────────────────────────────────────────────────────────────┐
   │                          Backend API (Express)                       │
   │                                                                      │
   │   /api/v1/auth      /api/v1/me        /api/v1/payment-intents        │
   │   /api/v1/merchants /pub/...          /webhooks/{stripe,square,bt}   │
   │                                                                      │
   │  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐  ┌──────────┐  │
   │  │ Routing      │→ │ Provider     │  │ Webhook      │  │ Payout   │  │
   │  │ Engine       │  │ Dispatcher   │  │ Worker       │  │ Worker   │  │
   │  └──────────────┘  └──────┬───────┘  └──────┬───────┘  └────┬─────┘  │
   └─────────────────────────────┼─────────────────┼───────────────┼──────┘
                                 │                 │               │
                                 ▼                 ▼               ▼
                       ┌─────────────────┐ ┌──────────────────┐ ┌──────────┐
                       │ Stripe / Square │ │  Postgres        │ │ Postgres │
                       │ Braintree APIs  │ │  (intents,       │ │ (payouts)│
                       └─────────────────┘ │  outbox, logs…)  │ └──────────┘
                                           └──────────────────┘
```

**Key flows**

| Flow | Path |
|------|------|
| Server-to-server payment | merchant → `POST /api/v1/payment-intents` (idempotency key) → routing engine picks connector → provider dispatcher charges → response stored, outbox event written → webhook worker delivers to merchant. |
| 3DS payment | provider returns `requires_action` → intent moved to `REQUIRES_ACTION` with `three_ds_action_url` → buyer completes auth → provider sends `payment_intent.succeeded` to inbound webhook → status reconciled, outbox event emitted. |
| Hosted checkout | merchant creates `payment_link` → buyer hits `/pay/:token` → `POST /pub/pay/:token/checkout` creates and confirms an intent server-side. |
| Refund | dashboard or API → `RefundService.create` → over-refund check → provider refund call → fee re-computed → outbox event. |
| Inbound dispute | provider webhook → signature verified → `DisputeService.upsertGeneric/upsertFromStripe` → linked to PI → outbox event for merchant webhook. |
| Outbound webhook | `outbox_events` row → fanout to `webhook_deliveries` → signed POST with `X-NexusPay-Signature` → retry on failure. |

---

## Tech stack

| Layer | Technology |
|-------|-----------|
| Backend | Node.js 18+ · Express · TypeScript · Knex · zod · jsonwebtoken · bcryptjs · otplib · nodemailer (optional) |
| Frontend | Vue 3 (`<script setup>`) · Vite · Pinia (persisted) · Vue Router · Tailwind CSS · Chart.js · date-fns · lucide-vue |
| Database | PostgreSQL 14+ · Knex migrations |
| Tests | Vitest · supertest |
| Containerisation | Docker · docker-compose |

---

## Quick start

### Docker (recommended)

```bash
cp .env.example .env
docker compose up --build
```

- Dashboard: <http://localhost:5173>
- Backend API: <http://localhost:3001>

> The example `.env` ships with a **dev-only** `ENCRYPTION_KEY`. Replace it (and `JWT_SECRET`) for any real deployment.

### Local development

```bash
# 1. Database
createdb nexuspay

# 2. Backend
cd backend
cp .env.example .env
npm install
npm run migrate     # tsx-based, idempotent
npm run dev         # tsx watch on src/index.ts

# 3. Frontend (in a second shell)
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173> and register. The first registration creates an organisation, a merchant and an `OWNER` membership.

### Tests

```bash
cd backend
npm test            # Vitest, single run
npm run test:watch  # watch mode
```

Frontend tests are not yet set up (tracked in `ROADMAP.md`).

---

## Configuration

All backend config is read from environment variables. See `backend/.env.example` for the full list.

| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `3001` | HTTP port |
| `DATABASE_URL` | `postgres://...localhost...` | Postgres connection string |
| `JWT_SECRET` | _required_ | At least 256 bits |
| `JWT_ACCESS_TOKEN_EXPIRY_MS` | `900000` | 15 min |
| `JWT_REFRESH_TOKEN_EXPIRY_MS` | `2592000000` | 30 days |
| `ENCRYPTION_KEY` | _required for connectors_ | Base64-encoded 32 bytes for AES-256-GCM. Generate with `openssl rand -base64 32`. |
| `PAY_BASE_URL` | `http://localhost:5173` | Used for invite / reset / Square webhook URLs |
| `CORS_ALLOWED_ORIGINS` | `http://localhost:5173` | Comma-separated list |
| `STRIPE_WEBHOOK_SECRET` | _empty_ | Required to verify Stripe inbound webhooks |
| `WEBHOOK_WORKER_ENABLED` | `true` | Set to `false` to disable the outbound delivery worker |
| `PAYOUT_WORKER_ENABLED` | `true` | Set to `false` to disable the hourly payout reconciliation |
| `INVITE_TOKEN_EXPIRY_MS` | `172800000` | 48h |
| `PASSWORD_RESET_TOKEN_EXPIRY_MS` | `3600000` | 1h |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASSWORD` / `SMTP_FROM` | _empty_ | When `SMTP_HOST` is empty, emails are logged to stdout (dev fallback) |

---

## Provider setup

### Stripe

1. Get a secret key (`sk_test_…` or `sk_live_…`).
2. **Connectors → New connector → Stripe.** Paste the secret key. (Optional) paste the publishable key — needed only for the embedded / hosted checkout flow.
3. (Optional) set fee config to drive cost-aware routing and payouts: e.g. `fixed = 30`, `percentage = 2.9`.
4. Configure webhook delivery — see [Webhooks](#webhooks).

### Square

1. Create an OAuth application or get an access token.
2. **Connectors → New connector → Square.** Provide:
   - **Access token** (`EAAA…`) — the production or sandbox token.
   - **Location ID** (`LXX…`) — typically required by Square Payments.
   - **Webhook signature key** — generated when you create the webhook subscription in the Square Dashboard.
3. Connector mode (`TEST` / `LIVE`) selects the sandbox vs production base URL automatically.

### Braintree

1. Get a `publicKey` + `privateKey` pair from the Braintree control panel.
2. **Connectors → New connector → Braintree.** Provide:
   - **Public key**, **private key** (Basic-auth pair for Braintree's GraphQL API).
   - (Optional) **Merchant account ID** — for multi-currency / sub-merchant routing.
3. Mode chooses sandbox vs production endpoints automatically.

---

## Webhooks

NexusPay receives provider events at these URLs, where `${PAY_BASE_URL}` is the public base URL of the backend:

| Provider  | URL                                  | Notes |
|-----------|--------------------------------------|-------|
| Stripe    | `${PAY_BASE_URL}/webhooks/stripe`    | Set `STRIPE_WEBHOOK_SECRET` to the value Stripe shows after creating the endpoint. |
| Square    | `${PAY_BASE_URL}/webhooks/square`    | Per-connector. Set the same URL in the Square Dashboard subscription **and** in the connector's `provider_config.webhookNotificationUrl` (or leave it blank to use the default). The signing key from Square goes into the connector credentials as `webhookSignatureKey`. |
| Braintree | `${PAY_BASE_URL}/webhooks/braintree` | The handler answers Braintree's `bt_challenge` GET verification automatically using the keys of any active Braintree connector. |

### Square — exact-URL signature requirement

Square computes the signature as `HMAC-SHA256(signingKey, notificationUrl + rawBody)`. The `notificationUrl` **must match exactly** the URL configured in the Square Dashboard, including scheme/host/path. If your backend is behind a proxy:

1. set `provider_config.webhookNotificationUrl` on the Square connector to the public URL Square sees, **or**
2. set `PAY_BASE_URL` so the default `${PAY_BASE_URL}/webhooks/square` matches.

If the URL doesn't match, signature verification fails with `400 Invalid signature`.

### Outbound (merchant-facing) webhook signing

Every event delivered to your endpoint includes:

```
Content-Type:           application/json
User-Agent:             NexusPay-Webhook/1.0
X-NexusPay-Event:       payment_intent.succeeded
X-NexusPay-Event-Id:    <uuid>
X-NexusPay-Signature:   t=<unix-ts>,v1=<hex sha256>
```

Verify with `HMAC-SHA256(signingSecret, "<t>.<rawBody>")`.

---

## API reference

All merchant-server endpoints live under `/api/v1/` and require either a JWT (`Authorization: Bearer <accessToken>`) or an API key (`Authorization: Bearer sk_…`). Public checkout endpoints live under `/pub/`.

### Auth

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/auth/register` | Creates a user + organisation + merchant + OWNER membership |
| POST | `/api/v1/auth/login` | Returns either auth tokens or `{ mfaRequired, mfaSessionToken }` |
| POST | `/api/v1/auth/login/mfa` | Exchanges MFA session + TOTP / backup code for tokens |
| POST | `/api/v1/auth/refresh` | Rotates refresh tokens |
| POST | `/api/v1/auth/logout` | Revokes refresh + bumps `token_version` |
| POST | `/api/v1/auth/accept-invite` | Sets password (for new users) and activates membership |
| POST | `/api/v1/auth/forgot-password` | Always 204 |
| POST | `/api/v1/auth/reset-password` | Validates token, sets password, revokes all sessions |
| POST | `/api/v1/auth/mfa/setup` | Returns TOTP secret + otpauth URI |
| POST | `/api/v1/auth/mfa/confirm` | Confirms TOTP, returns 8 one-time backup codes |
| POST | `/api/v1/auth/mfa/disable` | TOTP / backup code to disable MFA |

### Payments (server-to-server, requires `sk_…`)

| Method | Path | Notes |
|---|---|---|
| POST | `/api/v1/payment-intents` | Idempotent on `idempotencyKey` |
| GET | `/api/v1/payment-intents/:id` | Read-only |
| POST | `/api/v1/payment-intents/:id/confirm` | Routes + charges; may return `REQUIRES_ACTION` |
| POST | `/api/v1/payment-intents/:id/capture` | Manual-capture flow |
| POST | `/api/v1/payment-intents/:id/cancel` | |
| POST | `/api/v1/payment-intents/:id/refunds` | Full or partial |

### Dashboard (requires JWT + RBAC)

| Method | Path | Notes |
|---|---|---|
| GET | `/api/v1/me` | Current user + memberships |
| GET | `/api/v1/merchants/:id/payment-intents` | Filters: `status`, `orderId`, `minAmount`, `maxAmount`, `createdFrom`, `createdTo`, `search` |
| GET | `/api/v1/merchants/:id/payment-intents/:id` | |
| POST | `/api/v1/merchants/:id/payment-intents/:id/capture` | |
| POST | `/api/v1/merchants/:id/payment-intents/:id/cancel` | |
| POST | `/api/v1/merchants/:id/payment-intents/:id/refunds` | |
| GET | `/api/v1/merchants/:id/refunds` | |
| GET | `/api/v1/merchants/:id/disputes` | |
| GET | `/api/v1/merchants/:id/disputes/:id` | |
| GET / PUT | `/api/v1/merchants/:id/disputes/:id/evidence` | Save draft |
| POST | `/api/v1/merchants/:id/disputes/:id/evidence/submit` | Submit to provider (Stripe today) |
| GET | `/api/v1/merchants/:id/payouts` | |
| GET | `/api/v1/merchants/:id/payouts/:id` | Includes line items |
| GET / POST / PUT / DELETE | `/api/v1/merchants/:id/connectors[/:id]` | |
| PUT | `/api/v1/merchants/:id/connectors/reorder` | Drag-and-drop ordering |
| GET / POST / PUT / DELETE | `/api/v1/merchants/:id/routing-rules[/:id]` | |
| GET / POST / DELETE | `/api/v1/merchants/:id/api-keys[/:id]` | |
| POST | `/api/v1/merchants/:id/api-keys/:id/rotate` | New key issued, old revoked |
| GET / POST / PUT / DELETE | `/api/v1/merchants/:id/webhook-endpoints[/:id]` | |
| GET | `/api/v1/merchants/:id/webhook-deliveries` | |
| GET / POST / PUT / DELETE | `/api/v1/merchants/:id/payment-links[/:id]` | |
| GET / POST / PUT / DELETE | `/api/v1/merchants/:id/members[/:id]` | `members/invite` to invite |
| GET | `/api/v1/merchants/:id/logs` | API call audit |

### Public (no auth)

| Method | Path | Notes |
|---|---|---|
| GET | `/pub/pay/:token` | Hosted payment link metadata |
| POST | `/pub/pay/:token/checkout` | Creates + confirms an intent for the link |
| POST | `/pub/tokenize` | Embedded checkout: takes `pk_…` + provider PM id, returns `gw_tok_…` |
| GET | `/pub/providers` | Available providers + public configs for a `pk_…` |
| POST | `/pub/checkout-session` | Like `/providers` but POST |

---

## Security model

| Concern | Mitigation |
|---|---|
| Cross-merchant access | `requireRole(...)` enforced on every dashboard route; resolves merchant membership from `merchant_users`. |
| Provider secrets at rest | AES-256-GCM (`encrypted_credentials`); server refuses to save when `ENCRYPTION_KEY` is missing. |
| API keys at rest | Only SHA-256 hash stored. Raw key shown once at creation. Rotation issues new + revokes old in a single transaction. |
| Token replay | Refresh tokens persisted (hashed), one-shot, replay-detected on `/auth/refresh`. JTI claim avoids hash collisions. |
| MFA session theft | Sessions persisted (hashed), 5-min TTL, one-shot, swept on every lookup. Backup codes consumed on use. |
| XSS / log sensitivity | `gateway_logs` request bodies pass through a substring + exact-key + card-number scrubber; signed inbound webhook bodies aren't logged at all. |
| Account enumeration | `/forgot-password` always returns 204. |
| Brute force | Token-bucket rate limiter on `/auth` (20/min/IP), `/pub` (60/min/IP) and `/api/v1/payment-intents` (120/min/key). |
| Provider webhook spoofing | All three providers' signatures verified before the body is parsed. |

---

## Development

### Migrations

```bash
cd backend
npm run migrate
```

Migrations live in `backend/src/db/migrations/`. They run via `tsx` in transactional batches.

### Testing

```bash
npm test           # Vitest, single run
npm run test:watch
```

Current coverage: pure-logic units (crypto, fee calculator, rate limiter, scrub, dispute mapper, routing engine, signature verifiers for all three providers). HTTP integration tests and frontend tests are tracked in [`ROADMAP.md`](./ROADMAP.md).

### Building

```bash
cd backend && npm run build       # tsc to dist/
cd frontend && npm run build      # Vite production build
```

### Code structure conventions

- **Routes** (`src/routes/`) only do parsing (zod), authn, RBAC and HTTP error mapping.
- **Services** (`src/services/`) own business logic; each exports a single `someService` instance.
- **Migrations** are append-only and reversible.
- **Provider-specific code** lives in `provider-dispatcher.ts` (per-PSP charge/capture/cancel/refund) and `utils/{stripe,square,braintree}-signature.ts`.

---

## Project structure

```
nexus-pay/
├── backend/                       Node.js Express backend
│   ├── src/
│   │   ├── config/                env-driven config
│   │   ├── db/
│   │   │   ├── connection.ts      Knex pool
│   │   │   ├── migrate.ts         migration runner
│   │   │   └── migrations/        001-005, append-only
│   │   ├── middleware/            auth, RBAC, rate limit, request logging
│   │   ├── routes/                /api/v1, /pub, /webhooks
│   │   ├── services/              business logic (payments, refunds, disputes,
│   │   │                          payouts, routing, webhooks, email, MFA, etc.)
│   │   └── utils/                 crypto, scrub, signature verifiers
│   ├── vitest.config.ts
│   └── Dockerfile
│
├── frontend/                      Vue 3 + Vite + Tailwind dashboard
│   ├── src/
│   │   ├── components/            Sidebar, TopBar
│   │   ├── layouts/               Dashboard layout
│   │   ├── lib/                   axios instance with refresh-token interceptor
│   │   ├── pages/                 ~20 pages (Login, Payments, PaymentDetail,
│   │   │                          Refunds, Disputes, Payouts, Connectors,
│   │   │                          RoutingRules, ApiKeys, Webhooks, Team, etc.)
│   │   ├── router/                Vue Router config + guards
│   │   └── stores/                Pinia auth store (persisted)
│   └── Dockerfile
│
├── docker-compose.yml             Postgres + backend + frontend nginx
├── .env.example                   shared dev env
├── README.md                      this file
├── ROADMAP.md                     status + what's next
└── LICENSE
```

---

## License

MIT. See [`LICENSE`](./LICENSE).
