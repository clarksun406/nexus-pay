# AGENTS.md

This file provides guidance to the AI agent when working with code in this repository.

## Build & run commands

Run from the repo root (uses `concurrently`):

- `npm run dev` — starts backend (`:3001`) + frontend (`:5173`) concurrently
- `npm run build` — `tsc` backend + `vite build` frontend
- `npm run dev:backend` / `npm run dev:frontend` — individual sides

Inside `backend/`:

- `npm run dev` → `tsx watch src/index.ts` (hot reload, no build step)
- `npm run build` → `tsc` (emits `dist/`)
- `npm run migrate` → `ts-node src/db/migrate.ts` (runs pending Knex migrations)

Inside `frontend/`:

- `npm run dev` → `vite` (proxies `/api` and `/pub` to `http://localhost:3001` — see `frontend/vite.config.ts`)
- `npm run build` → `vue-tsc -b && vite build`
- Path alias `@/*` → `src/*` (configured in `frontend/tsconfig.json` + vite alias)

## Type-check gate (mandatory before ship)

`tsc --noEmit` must exit with **zero errors** in both `backend/` and `frontend/` before marking any task done. There is currently ~90 pre-existing errors (Express v5 `req.params` types, `provider-dispatcher` unknown fetch data, a few `null` vs `undefined` mismatches in `retry.service.ts`). Track and clear them — see `/tsc-cleanup` skill. New regressions are blocking.

## Database migrations

- Migration files live under `backend/src/db/migrations/` with numeric prefixes: `001_initial_schema.ts`, `002_retry_and_reconciliation.ts`, `003_p0_completion.ts`.
- Use Knex schema-builder API (not raw SQL except for extensions like `pgcrypto`).
- Every `up` must have a matching `down` that drops tables in reverse dependency order or `dropColumn`s in the opposite sequence they were added.
- `down` uses `dropTableIfExists` so re-runs are safe.
- Run `npm run migrate` after adding a new file; never edit a migration once it's landed on `main`.

## Environment

- `.env` (gitignored) is loaded by `backend/src/config/index.ts` from the repo root.
- Required for backend boot: `DB_*` (postgres), `JWT_SECRET` (≥256 bits), `ENCRYPTION_KEY` (used by `utils/crypto.ts` to wrap connector credentials — never store plaintext secrets).
- Optional: `STRIPE_SECRET_KEY`, `SQUARE_ACCESS_TOKEN`, `CORS_ALLOWED_ORIGINS`, `PAY_BASE_URL`.
- Sample values live in `.env.example`.

## Branch + commit convention

- Branches: `feature/<short-slug>`, `fix/<short-slug>`, `chore/<short-slug>` (lowercase, kebab-case).
- MRs into `main` **squash-merge** on GitLab.
- Commit messages: lowercase conventional prefixes — `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`, `test:`. One-line subject, no scope in parens. Body optional. See `git log` for examples.

## Architecture pointers

- Backend layers: `routes/` → `services/` → `db/` (Knex) → PostgreSQL. Routes never touch `db()` directly.
- `services/provider-dispatcher.ts` is the unified Stripe/Square/Braintree adapter; new providers are added as private methods + a `switch` branch. (Planned: refactor to strategy interfaces for P3 — don't add more switch branches without discussing it.)
- `services/scheduler.service.ts` starts four periodic jobs on backend boot (retry, health, PSP sync, settlement check). **No distributed lock yet** — do not run two backend instances in production until P4 infra adds one.
- `services/routing-engine.ts` does rule-priority + weighted-random connector selection; `services/bin-routing.service.ts` layers per-card-BIN scoring on top.
- Frontend is a thin Vue 3 SPA; API calls go through `frontend/src/lib/api.ts` (axios + 401 auto-refresh).

## Security reminders

- Never log or commit plaintext API keys, JWTs, or connector credentials. Secrets are encrypted with `utils/crypto.ts` before persistence (`provider_accounts.encrypted_credentials`).
- API keys use `pk_` (publishable) / `sk_` (secret) prefixes with TEST/LIVE modes — preserve this pattern when extending auth.
- `routes/` use `authenticateJwt`, `requireRole(...)`, or `requireSecretKey` middleware from `middleware/auth.ts`; pick the strictest that fits.

## Subdirectory AGENTS.md

Module-specific guidance can live in `backend/AGENTS.md` or `frontend/AGENTS.md` and is loaded automatically when working inside those directories. Use these for concerns that don't apply to the whole repo (e.g., frontend component conventions, backend migration review checklist).

## Private per-user notes

A `AGENTS.local.md` at the repo root is loaded with higher priority than this file and is gitignored. Use it for personal workflow preferences, local paths, or debugging shortcuts you don't want committed.
