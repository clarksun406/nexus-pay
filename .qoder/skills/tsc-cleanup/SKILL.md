---
name: tsc-cleanup
description: Clear the ~90 pre-existing TypeScript errors in NexusPay backend (mostly Express v5 req.params mismatches, provider-dispatcher unknown fetch data, retry.service null-vs-undefined). Run once to reach the AGENTS.md tsc-zero gate, then retire the skill.
---

You are clearing accumulated TypeScript debt so the repo meets the AGENTS.md tsc-zero gate. Work methodically; do not batch unrelated fixes.

## 1. Baseline

Run `cd backend && ./node_modules/.bin/tsc --noEmit` and capture the error list. Group errors by root cause — most will fall into one of these buckets:

| Bucket | File pattern | Root cause | Fix |
|---|---|---|---|
| Express v5 params | `src/routes/*.ts` | `req.params.xxx` is `string \| string[]` in Express v5 types, but routes treat it as `string` | Add runtime narrowing: `const merchantId = req.params.merchantId as string;` at the top of each handler, OR install `@types/express@^4` as a devDep override if the team prefers |
| fetch unknown | `src/services/provider-dispatcher.ts` | `await response.json()` returns `unknown` under strict TS | Type the body: `const data = (await response.json()) as { ... };` |
| null-vs-undefined | `src/services/retry.service.ts`, `src/services/payment-intent.service.ts` | Passing `null` where param type is `string \| undefined` | Change the call site to `undefined` |

Confirm the bucket counts with the team before starting if the totals differ wildly from ~90.

## 2. Fix order

1. **Smallest blast radius first.** Fix the null-vs-undefined and fetch-unknown buckets (5-10 files, zero behavior change).
2. **Express params next.** Apply the narrowing pattern file-by-file. Prefer inline `as string` casts over changing route signatures — do not rewrite middleware.
3. **Re-run `tsc --noEmit` after each file.** Stop if a new error appears that wasn't in the baseline.

## 3. Do not

- Rewrite middleware (`src/middleware/auth.ts`) — the type errors are in routes, not middleware.
- Introduce a global `@types/express` downgrade without checking with the team.
- Add `// @ts-ignore` or `any` casts to hide errors.
- Touch frontend types in this pass (separate concern).

## 4. Close out

After the final `tsc --noEmit` exits clean:

1. Run `cd frontend && ./node_modules/.bin/vue-tsc -b --noEmit` to confirm frontend is also clean.
2. Run `npm run build` in `backend/` to confirm emit works.
3. Commit as `chore: clear pre-existing tsc errors` (one commit for the whole pass, squash-merge friendly).
4. Tell the user this skill can now be deleted from `.qoder/skills/` — the `/verify` skill handles ongoing regression detection.
