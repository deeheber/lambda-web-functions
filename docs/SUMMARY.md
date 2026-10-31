# Build summary

**Merge:** `build/2026-10-31` into `main`, `e4735a5` → `2861753` (41 commits before this summary), 2 reviews, final verdict **APPROVED**. 16 tasks done (15 plan tasks plus R1-01), 0 blocked, 0 skipped. PR: https://github.com/deeheber/lambda-web-functions/pull/5 (draft, CI checks passing).

## What was built

**Phase 1: App and tests (P1-01 to P1-06).** This phase sets up a TypeScript Express 5 "hello world" app for AWS Lambda Web Functions. It has a typed `loadConfig(env)` in `src/config.ts`, which is the only place that reads `process.env`. Auth is a fail-closed middleware in `src/auth/index.ts` that routes on the `lambda-web-endpoint-name` header. The `iam` endpoint trusts the platform. The `public` endpoint requires a Cognito access token, checked by an `aws-jwt-verify` adapter that sits behind a `JwtVerifier` interface. There are three routes: `/health`, `/whoami` (auth mode, subject, `envId` and a per-request `requestCount`) and `/stream`, which sends server-sent ticks. `src/server.ts` is the entry point. It handles SIGTERM with a 500 ms shutdown deadline, and `npm run dev` runs the CJS bundle locally. P1-06 is the phase-end push and has no code change.

**Phase 2: Infrastructure and build (P2-01 to P2-05).** This phase adds two CloudFormation templates, `infra/artifacts.yaml` (the code bucket) and `infra/app.yaml`. The app template defines one `AWS::Lambda::WebFunction` with two endpoints (`iam`, `public`), a Cognito user pool and client, and tunables declared as Parameters. A test checks that each endpoint is paired with the right auth mode. `scripts/build.sh` bundles `src/` into a single CJS `index.js` with esbuild and zips it. `deploy.sh` and `teardown.sh` manage both stacks through a shared `scripts/env.sh`. P2-05 is the phase-end push.

**Phase 3: Smoke tests and docs (P3-01 to P3-04).** This phase adds `create-test-user.sh` and `smoke-jwt.sh` for the `public` endpoint, a SigV4-signed `scripts/smoke-iam.ts` for the `iam` endpoint (it takes its inputs from argv), and the README. P3-04 is the phase-end push. None of these scripts was run against AWS.

**Review fix (R1-01).** `createJwtVerifier(settings, jwks?)` now accepts an optional pre-loaded JWKS, passed in through `cacheJwks`. This lets the tests sign RS256 tokens locally and exercise the real verifier offline. The production call is unchanged and still loads the JWKS lazily.

## Decisions that shaped it

- Phases follow SPEC section 8: P1 is the app, P2 is infra and build, P3 is smoke tests and docs. There is no phase 0. (plan)
- One function with two endpoints. `lambda-web-endpoint-name` cannot be forged, and auth fails closed. (P1-03, P2-02)
- On the `iam` path, `subject` is always `null`, because Lambda forwards no caller identity. (P1-03, P1-04)
- There are no ⚠️ ASSUMPTION tuning tasks. Each value lives in exactly one place, and constraints enforce that. (plan)
- The plan is fully serial, with no parallel streams. (plan)
- The CJS bundle runs inside a `"type": "module"` package, so both `npm run dev` and `build.sh` write `dist/package.json` `{"type":"commonjs"}`. That file is not zipped. (P1-05, P2-03)
- Every relative import uses the `.ts` extension (`allowImportingTsExtensions` + `noEmit`), so Node 24 can run `src/server.ts` directly. (P1-01)
- `loadConfig(env = process.env)` takes the env object as a parameter, and tests pass plain objects. Child processes get a literal `env`. (P1-01)
- `src/auth/index.ts` imports only `src/auth/types` at runtime. Type-only imports of `src/auth/types.ts` and `src/config.ts` are allowed from any `src/` module. (P1-03)
- `requestCount` goes up once for every request, rejected ones included, before auth runs. `/whoami` reads it from `res.locals`, so concurrent requests never see each other's counts. (P1-04)
- `WWW-Authenticate: Bearer` is sent only on 401s from the jwt endpoint. A 401 for a missing or unknown endpoint has no such header. (P1-03)
- `/stream` writes its first event one interval after the request starts and then one per interval. The timer is cleared on the last tick and on close. (P1-04)
- In `loadConfig`, numbers must match `/^\d+$/`, with ticks ≥ 1, intervalMs ≥ 0 and port 0 to 65535. An empty string counts as unset. (P1-01)
- `STREAM_INTERVAL_MS=0` is accepted. Defaults are stored as string constants in `src/config.ts`. (P1-01, handoff)
- An empty endpoint header counts as missing. The exact-match test uses `IAM`, `iam2` and `Public` in place of `'iam '`. (P1-03, handoff)
- `src/app.ts` exports `errorHandler` and `notFoundHandler` so tests can mount them. There is no test-only route or flag. (P1-04)
- `SHUTDOWN_DEADLINE_MS = 500` in `src/server.ts` is half the platform's 1 s limit. It is not a tunable. (P1-05)
- The stream timing test allows 5 ms of slack (≥ 35 ms for a 40 ms interval). (P1-04, handoff)
- `scripts/env.sh` sets `AWS_REGION` (default `us-west-2`), `STACK_NAME` (default `lwf`) and `ARTIFACTS_STACK_NAME`, and defines `stack_output`. `smoke-iam.ts` takes the URL and Region from argv. (P2-04, P3-02)
- `build.sh` takes an optional output dir. `deploy.sh` always rebuilds before it uploads. (P2-03, P2-04)
- The revision has `DeletionPolicy: Delete` next to `UpdateReplacePolicy: Retain`, which avoids cfn-lint 1.58 W3011. (P2-02)
- The smoke scripts check for at least one event, with ticks numbered consecutively from 1. They do not assert `STREAM_TICKS`. (P3-01, P3-02)
- The phase-end tasks have no code, so each got an empty commit with the task ID as its subject to satisfy `kukulu_task_done`. (P1-06, P2-05, P3-04)
- The JWT adapter's offline seam is an optional `jwks` parameter that is pre-loaded through `cacheJwks`. It is not an env var or a bypass. (R1-01)
- The lazy-load test spies on `net.Socket.prototype.connect`, because aws-jwt-verify uses `node:https`, which neither fetch stubs nor `vi.mock('node:https')` can reach. (R1-01)

## Assumptions still in play

None of these were tuned, and all are still guesses:

- `STREAM_TICKS` (`stream.ticks`): default `5`, in `src/config.ts`.
- `STREAM_INTERVAL_MS` (`stream.intervalMs`): default `500`, in `src/config.ts`.
- `MaxEnvironments`: default `2`, an `infra/app.yaml` Parameter. This is the cost cap and its minimum value.
- `RateLimit`: default `100` requests/s per endpoint, an `infra/app.yaml` Parameter (allowed range 100 to 1000).

## Spec issues

Suggested edits to SPEC.md:

- CJS bundle vs ESM package (sections 4 and 7): `node dist/index.js` crashes under `"type": "module"`. The build resolved this with `dist/package.json` `{"type":"commonjs"}`. SPEC should state it.
- Import permissions table (section 4): `jwt-verifier.ts` and `whoami.ts` need types from `src/auth/types.ts`. SPEC should allow type-only imports explicitly.
- Principle 1 vs scripts (sections 3 and 4): the scripts need a Region and stack outputs. The build resolved this with `scripts/env.sh` and argv for `smoke-iam.ts`.
- Smoke tests "→ N events" (section 4): the scripts cannot know N. The checks are now "at least one event, numbered from 1".
- `UpdateReplacePolicy: Retain` alone fails cfn-lint 1.58 (W3011). SPEC should list `DeletionPolicy: Delete` too.
- Stack names are not specified. The build defaults to `lwf` and `lwf-artifacts`, and both can be overridden.
- `SystemLogLevel` is listed with no value. The build omits it.
- `parallel.setup` names `npm ci`, but this flight uses no parallel streams.
- PLAN P1-02 said to prove "no JWKS fetch" by stubbing `globalThis.fetch`. That is the wrong seam for aws-jwt-verify 5.x on Node, which fetches through `node:https`. A future plan should prescribe an injected JWKS instead. (review rounds 1 and 2)
- `Ref` on `AWS::Lambda::WebFunction` returns the ARN, so the `FunctionName` output (`!Ref HelloFunction`) holds an ARN, not a name. SPEC should rename the output or use a `GetAtt`. (review rounds 1 and 2)
- PLAN P1-03's acceptance case `'iam '` cannot be sent over HTTP, because the parser trims header values. The substitutes `IAM`, `iam2` and `Public` are sound. (review rounds 1 and 2)

The final REVIEW.md has no `Known-gap candidates` list.

## Manual checks owed

All are NOT VERIFIED (human).

- **Phase 1:** Run `npm run dev`. On the `iam` endpoint, `/whoami` should return 200 with authMode `iam` and subject `null`. On `public` without a token, expect 401 with `WWW-Authenticate: Bearer`. With no endpoint header, expect 401. `curl -N` on `/stream` should show the ticks arriving one at a time. (The implementer saw only the `iam` `/whoami` 200.)
- **Phase 2:** `npm run deploy` should succeed in us-west-2. Function `lwf-hello` should have one revision and two Active endpoints (`iam`, `public`).
- **Phase 3:** `create-test-user` should print a token, and `smoke:iam` and `smoke:jwt` should both exit 0. `/whoami` should show a shared `envId` and a rising `requestCount` on both endpoints. Logs should appear in `/aws/lambda/web/lwf-hello`. `npm run teardown` should remove both stacks.

`smoke-iam.ts`, `smoke-jwt.sh`, `create-test-user.sh`, `deploy.sh` and `teardown.sh` were only syntax-checked and usage-tested. None was run against AWS.

## Review history

- Round 1: CHANGES REQUESTED. 1 finding (category 3: JWT adapter behaviour untested, with a vacuous fetch-stub test). 1 fix task, R1-01 (sources: review 1, mutation 0, blocked 0). Not non-converging.
- Round 2: APPROVED. 0 findings, 0 fix tasks. No finding recurred. All 6 mutants on the fix-round files were killed.
- Round 2 approved with notes only. A `## Notes` section was flagged but not queued as work:
  - The `Jwks` type is cast through `unknown` to the library type, so a malformed JWKS would not be caught at compile time. Only tests pass one.
  - The socket-connect spy leaves sockets pending, but only under the eager-hydrate mutant.
  - The CLAUDE.md module map is out of date: the `jwt-verifier.ts` row still reads `createJwtVerifier(settings)`, and the `types.ts` row does not list `Jwks`.
  - The cacheJwks-removed mutant made a real HTTPS request to Cognito (404). This shows the injected JWKS is what keeps the suite offline.

## Pipeline friction

- plan, ambiguous-prompt: plan-build skill says any command in verify, extraVerify or build may be an object entry, but kukulu_plan_commit rejects `from` on build entries ("only valid on verify and extraVerify"). The skill text should say `from` is not allowed under `build`; cost one extra commit attempt.

## Suggested CLAUDE.md additions

- `infra-tunables-are-parameters` scans the text of `scripts/` and `infra/`, comments included. Do not write `MaxEnvironments=4`-style text there.
- `stream-tunables-only-in-config` scans `scripts/`. Do not assign numbers to variables named `ticks` or `intervalMs`.
- ESLint forbids `any`, so `test/infra.test.ts` types the template as `Record<string, unknown>` and uses `toMatchObject`.
- `test/server.test.ts` runs `src/server.ts` directly with native Node type stripping, so `.ts` import extensions are required.
- The root package is `"type": "module"`, so the CJS bundle needs `dist/package.json` with `{"type":"commonjs"}` for local runs. `build.sh` and `npm run dev` write it, and it is not zipped.
- Express 5 `app.listen` passes startup errors to its callback.
- On macOS, `sed -i` needs a suffix argument. Use the Edit tool instead.
- Vitest is v5.0.5 in this lockfile.
- Update the module map: the `src/auth/jwt-verifier.ts` row should read `createJwtVerifier(settings, jwks?)`, and the `src/auth/types.ts` row should list `Jwks`. (from REVIEW round 2 Notes)

## Advisory mutation survivors

None.

## Breaking call

Breaking: no. This is a greenfield first build: the base held only docs and pipeline config, so no existing public interface, config default or user-relied behaviour was changed. There is no CHANGELOG.md.
