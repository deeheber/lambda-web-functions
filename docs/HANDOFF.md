# Handoff

- Branch: `build/2026-10-31`
- Base commit: `e4735a5` (main)
- Head commit (before handoff commit): `37d918d`
- Tasks: 15 done, 0 blocked, 0 skipped.
- Final `kukulu_verify`: all constraints, typecheck, lint, test (79 tests), build green.

## Blocked / skipped tasks

None.

## Interpretation choices

- P1-01: `STREAM_INTERVAL_MS=0` is accepted (only `/^\d+$/` required). Defaults are string constants in `src/config.ts`.
- P1-03: an empty endpoint header counts as missing. The exact-match test uses `IAM`, `iam2`, `Public` because the HTTP parser strips the trailing space of `'iam '`.
- P1-04: stream timing test allows 5 ms slack (>= 35 ms for a 40 ms interval).
- P1-06, P2-05, P3-04: phase-end tasks have no code change, so an empty commit with the task ID subject was made to satisfy `kukulu_task_done`.

## Assumption config keys (not tuned; no tuning tasks in this flight)

- `STREAM_TICKS` default 5 (`src/config.ts`)
- `STREAM_INTERVAL_MS` default 500 (`src/config.ts`)
- `MaxEnvironments` default 2 (`infra/app.yaml`)
- `RateLimit` default 100 (`infra/app.yaml`)

## Manual checks (all NOT VERIFIED (human))

- Phase 1: `npm run dev`; iam `/whoami` 200 (authMode iam, subject null); public without token 401 with `WWW-Authenticate: Bearer`; no header 401; `curl -N` on `/stream` shows ticks one at a time. (The implementer did run `npm run dev` and saw `/whoami` return 200 on iam.)
- Phase 2: `npm run deploy` succeeds in us-west-2; function `lwf-hello` has one revision and two Active endpoints (`iam`, `public`).
- Phase 3: `create-test-user` prints a token; `smoke:iam` and `smoke:jwt` exit 0; `/whoami` shows a shared `envId` and rising `requestCount` on both endpoints; logs in `/aws/lambda/web/lwf-hello`; `npm run teardown` removes both stacks.

`scripts/smoke-iam.ts`, `smoke-jwt.sh`, `create-test-user.sh`, `deploy.sh`, `teardown.sh` were only syntax-checked and usage-tested; none were run against AWS.

## Codebase notes

- `infra-tunables-are-parameters` scans `scripts/` and `infra/` text, including comments: do not write `MaxEnvironments=4` style text there.
- `stream-tunables-only-in-config` scans `scripts/`; avoid variables named `ticks`/`intervalMs` assigned numbers.
- ESLint forbids `any`, so `test/infra.test.ts` types the template with `Record<string, unknown>` and uses `toMatchObject`.
- Native Node type stripping runs `src/server.ts` directly in `test/server.test.ts`; `.ts` import extensions are required.
- The root package is `"type": "module"`, so the CJS bundle needs a `dist/package.json` with `{"type":"commonjs"}` for local runs (done by `build.sh` and `npm run dev`; it is not zipped).
- Express 5 `app.listen` passes startup errors to its callback.
- On macOS `sed -i` needs a suffix argument; use the Edit tool instead.
- Vitest is v5.0.5 in this lockfile.

## For the reviewer

Auth is fail-closed and lives in `src/auth/index.ts` only; the app takes a `JwtVerifier` via `createApp(config, deps)`. `requestCount` in `whoami` comes from `res.locals`, not the global getter, so concurrent requests do not see each other's counts. Extra dev dependencies for `smoke-iam.ts`: `@smithy/signature-v4`, `@aws-crypto/sha256-js`, `@aws-sdk/credential-provider-node` (used only in `scripts/`).
