# Roadmap

A living, honest map of what's done, what's in flight, and what's next. Items here reflect the actual state of `main` — not aspirations.

**Legend**

- ✅ **Done** — implemented and on `main`.
- 🚧 **Partial** — works for the common case, but with explicit gaps documented below.
- 📋 **Planned** — designed / scoped but not yet built.

---

## ✅ Done

### Payments
- ✅ Stripe charge / capture / cancel / refund
- ✅ Square charge / capture / cancel / refund (REST Payments API, sandbox + production routing by mode)
- ✅ Braintree charge / capture / cancel / refund (GraphQL API)
- ✅ Idempotency keys on `create`, replay-safe
- ✅ Manual + automatic capture
- ✅ 3DS / SCA: `REQUIRES_ACTION` state and `three_ds_action_url`, dashboard + hosted-checkout redirect
- ✅ Refund correctness: provider call, currency passthrough, over-refund guard across multiple partials, fee re-computed
- ✅ Per-attempt records (`payment_requests`) for retry / forensics

### Connectors & routing
- ✅ Multi-account per provider, weighted-random selection, primary/fallback
- ✅ Per-connector `fee_config` (`fixed` + `percentage` in minor units)
- ✅ Routing rules: currency, amount range, country, payment method, priority
- ✅ Cost-aware filtering: `max_cost_bps` drops over-priced candidates; optional cheapest-by-fees pick
- ✅ Provider-specific credential fields in the dashboard (Stripe / Square / Braintree)

### Hosted + embedded checkout
- ✅ Payment links (token-based hosted page)
- ✅ `/pub/tokenize` flow with `gw_tok_…` single-use tokens
- ✅ 3DS redirect handling on the hosted page

### Disputes
- ✅ Inbound dispute ingestion (Stripe + Square + Braintree)
- ✅ Internal status enum + provider-status mapping
- ✅ Outbox events to merchant webhooks (`dispute.created` / `dispute.updated` / `dispute.won` / `dispute.lost`)
- ✅ Evidence draft + Stripe submission to `POST /v1/disputes/:id`
- 🚧 Square / Braintree evidence submission — see _Partial_ below

### Reconciliation / payouts
- ✅ `payouts` + `payout_items` schema with idempotent rollups
- ✅ Hourly worker for the previous 24h
- ✅ Per-payment + per-refund line items rolled into the summary
- ✅ Dashboard list + drill-down detail page
- 🚧 Currently an internal reconciliation view only — see _Partial_

### Webhook delivery
- ✅ Transactional outbox pattern (`outbox_events` written in same TX as state change)
- ✅ Background worker fans out to subscribed endpoints
- ✅ HMAC-SHA256 signing with timestamp (`X-NexusPay-Signature: t=…,v1=…`)
- ✅ Exponential backoff (1m → 6h, 6 attempts), `webhook_deliveries` audit
- ✅ Per-endpoint subscribed-event filtering

### Webhook ingestion
- ✅ `/webhooks/stripe` with signature + replay protection + 5-min tolerance
- ✅ `/webhooks/square` with per-connector signing keys + exact-URL signature
- ✅ `/webhooks/braintree` POST + `GET ?bt_challenge=…` URL verification
- ✅ Idempotency via `processed_webhook_events` (provider-namespaced ids)

### Auth & RBAC
- ✅ Email + password (bcrypt cost 12) registration & login
- ✅ TOTP MFA + 8 backup codes
- ✅ MFA mid-login sessions in DB (hashed, TTL-swept)
- ✅ JWT access + refresh; refresh tokens persisted, rotated, replay-detected, JTI'd
- ✅ Logout revokes refresh + bumps `token_version`
- ✅ Member invites (table + token + email)
- ✅ Password reset (single-use, hashed, 1h TTL, account-enumeration safe)
- ✅ RBAC enforced on **every** merchant dashboard route via `requireRole(...)` (OWNER / ADMIN / DEVELOPER / FINANCE / VIEWER)
- ✅ API keys: SHA-256-only storage, one-time reveal, rotation (atomic new+revoke)

### Security
- ✅ AES-256-GCM at-rest encryption for provider credentials; server refuses to save without a valid key
- ✅ `gateway_logs` body scrubbing (substring + exact-match + card-number masking + recursion cap)
- ✅ Header allowlist on logged headers; signed inbound webhook bodies not logged at all
- ✅ Token-bucket rate limiting on `/auth` (per IP), `/pub` (per IP), `/api/v1/payment-intents` (per API key)
- ✅ Request IDs end-to-end, recorded as `trace_id` on every log row

### Email
- ✅ `email.service` with optional `nodemailer`, dev fallback to stdout
- ✅ Invite emails (HTML + text)
- ✅ Password reset emails
- ✅ SMTP config via env (`SMTP_HOST` / `_PORT` / `_USER` / `_PASSWORD` / `_FROM`)

### Tests
- ✅ Vitest configured + `npm test` / `test:watch`
- ✅ Unit tests for: `crypto` (round-trip + key validation + plaintext passthrough), `stripe-signature`, `square-signature`, `braintree-signature` (incl. multi-pair sigs), `fee-calculator`, `rate-limit` (capacity / refill / isolation / custom keyGen), `scrub`, dispute mapper, routing engine (mock-DB based)

### Dashboard UX
- ✅ Login / Register / Forgot / Reset / Accept-invite pages
- ✅ Payments list with search, status, amount, date filters and paginator
- ✅ Payment detail with status-gated **Capture / Cancel / 3DS / Refund** buttons
- ✅ Refunds page
- ✅ Disputes list + detail with evidence draft / submit
- ✅ Payouts list + drill-down line items
- ✅ Connectors page with per-provider credential fields + fee config
- ✅ Routing Rules, API Keys (with rotation), Webhooks, Team (with invite), Logs

### Documentation
- ✅ Comprehensive `README.md` (architecture, configuration, provider setup, webhook setup, security model, API reference)
- ✅ This `ROADMAP.md`

---

## 🚧 Partial — works, but with documented gaps

### Square / Braintree dispute evidence
Stripe-only end-to-end. Drafts persist for any provider. Square uses a file-upload flow on a different endpoint; Braintree's evidence flow needs the SDK. Tracked in [Provider parity](#provider-parity).

### Payouts as money movement
Payouts today are **internal reconciliation summaries** — they don't initiate deposits. Real money movement is handled by the underlying provider's payout schedule. Surfacing the numbers lets merchants verify what's about to be deposited; we plan to integrate provider payout APIs for live status. See [Settlement](#settlement).

### Rate limiting at scale
Token buckets are kept in process memory. Single-instance deploys are fine; multi-instance deploys need the limiter backed by Redis. See [Production hardening](#production-hardening).

### Frontend token storage
Pinia persists access + refresh tokens to `localStorage` for the dashboard. This is XSS-vulnerable. We plan to move refresh into an httpOnly + SameSite cookie. See [Auth hardening](#auth-hardening).

---

## 📋 Planned

### Production hardening
- 📋 **Redis-backed rate limiter** — swap the in-memory token bucket for `ioredis` + a Lua-based counter so limits hold across instances.
- 📋 **Stronger health checks** — `/health/live` (process liveness) + `/health/ready` (DB + worker queue ping).
- 📋 **Real Prometheus metrics** — replace the stub `/actuator/prometheus` with `prom-client`: HTTP RED metrics, worker queue depth, refund / dispute counts.
- 📋 **Structured logging** — JSON logger (pino) with request id correlation; replace `console.log`.
- 📋 **DB connection-pool sizing** per environment instead of a hardcoded `max: 20`.
- 📋 **CI** — minimal GitHub Actions: tsc + Vitest + Vite build + `knex migrate:latest --env=test`.

### Auth hardening
- 📋 **httpOnly + SameSite refresh cookie** instead of `localStorage` storage.
- 📋 **CSRF tokens** for cookie-mode endpoints.
- 📋 **Audit log** of admin actions (role changes, key rotations, connector edits) — currently only API call traffic is in `gateway_logs`.

### Provider parity
- 📋 Square dispute **evidence file uploads** (text fields are not enough — Square uses `/v2/disputes/:id/evidence_files`).
- 📋 Braintree dispute evidence via SDK.
- 📋 Optional fourth provider: Adyen (or PayPal Commerce).
- 📋 Apple Pay / Google Pay decryption support on `/pub/tokenize`.

### Settlement
- 📋 Live payout-status integration with Stripe Connect / Square.
- 📋 Retroactive payout backfill endpoint (currently bounded to the last 24h window).

### Tests
- 📋 **Integration tests with `supertest`** (the dependency is already installed):
  - RBAC: cross-merchant requests must 403
  - End-to-end webhook outbound delivery (write outbox → assert `webhook_deliveries` reflects success / failure / retry)
  - Inbound webhook idempotency
  - Refund over-refund guard
- 📋 **Frontend tests** — Vitest + `@vue/test-utils` for Login / PaymentDetail status gating / Disputes form / refresh interceptor.

### UX polish
- 📋 Connector edit screen (today: delete + re-create only).
- 📋 Connection-test button for Stripe / Square / Braintree credentials at create time.
- 📋 Bulk export (CSV) of payments / refunds / payouts.
- 📋 Sortable columns + saved filters on the Payments page.
- 📋 Email-verification flow for newly registered accounts.

### Docs & governance
- 📋 **OpenAPI spec** generated from zod schemas (route table → `openapi.yaml`).
- 📋 Public docs site (Mintlify / Vitepress).
- 📋 Runbooks for the webhook + payout workers (alerts, retries, backfill).

---

## Out of scope (explicitly)

- We are not building card-data tokenisation ourselves. PCI scope is delegated to the provider's hosted fields / Stripe.js / Square Web Payments SDK.
- We are not implementing direct interchange-level routing (BIN-based bank-of-issuance routing); routing is at the PSP-account level.
- We are not building a fraud engine. PSP-level fraud / 3DS challenge is the line of defence.
