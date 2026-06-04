---
name: verify
description: Run the full pre-ship verification for NexusPay — type-check both backend and frontend, run Knex migrations in dry-run mode against a throwaway DB, and (when tests exist) execute the test suite. Use before marking any feature complete. Blocks on zero tsc errors.
---

You are running the project's pre-ship verification gate. Execute every step sequentially; if any step fails, stop and report the failure — do not mark the task done.

## Step 1 — backend type check

```bash
cd backend && ./node_modules/.bin/tsc --noEmit
```

- **Exit 0 = pass.** Any error is a hard fail. Do not claim success if there are "only pre-existing errors" — AGENTS.md mandates zero errors before ship.
- If errors are pre-existing, report them and suggest the `/tsc-cleanup` skill.
- If errors are new (introduced by the current change), fix them and re-run.

## Step 2 — frontend type check

```bash
cd frontend && ./node_modules/.bin/vue-tsc -b --noEmit
```

Same policy as Step 1. If `node_modules` is missing, run `npm install --silent` first.

## Step 3 — migration dry-run

Verify the latest migration is well-formed (reversible, idempotent):

1. Start a throwaway postgres (use docker if available, else skip and warn):
   ```bash
   docker run --rm -d --name nexuspay-verify -e POSTGRES_PASSWORD=postgres -p 15432:5432 postgres:16-alpine
   ```
2. Create a fresh DB and run all migrations:
   ```bash
   cd backend
   DB_PORT=15432 DB_HOST=localhost DB_NAME=postgres DB_USERNAME=postgres DB_PASSWORD=postgres npm run migrate
   ```
3. Verify `down` works (requires a rollback script — if none exists, skip and warn):
   ```bash
   DB_PORT=15432 DB_HOST=localhost DB_NAME=postgres DB_USERNAME=postgres DB_PASSWORD=postgres npx ts-node src/db/migrate.ts rollback
   ```
4. Tear down: `docker stop nexuspay-verify`.

If docker is unavailable, skip this step and tell the user to verify migrations manually.

## Step 4 — test suite (when present)

Check `backend/package.json` for a `test` script. If present:

```bash
cd backend && npm test
```

If no test script exists, skip and note: "No test suite configured — consider adding one before P1."

## Step 5 — summary

Report a compact pass/fail table:

```
[tsc-backend ]  pass / fail (N errors)
[tsc-frontend]  pass / fail (N errors)
[migrations  ]  pass / fail / skipped
[tests       ]  pass / fail / skipped
```

Only declare overall success if tsc-backend AND tsc-frontend both pass.
