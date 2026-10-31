# Review
Round: 1

Branch: `build/2026-10-31` (base `e4735a5`, head `3c000dd`). 15 tasks done, 0 blocked, 0 skipped.

## Verdict

CHANGES REQUESTED

## What was checked

- `kukulu_verify` (run by the reviewer): all 13 constraints pass with no fixture failures and no hits; typecheck, lint, `npm test` (79 tests, 11 files) and `npm run build` all exit 0. `cfn-lint infra/*.yaml` (1.58.0) exits 0.
- Every task commit read against its PLAN task and the SPEC sections it cites. Every source, test, infra and script file was read in full.
- Constraints that need a human reader: no top-level object/array literal in `src/` is mutated; no top-level `await` in `src/`; `src/auth/index.ts` imports only `express` types and `./types.ts`; `whoami` and `jwt-verifier` import only types from `src/auth/types.ts` (allowed by the PLAN decision). No violations found.
- Boundaries: `src/` imports nothing from `scripts/`, `infra/` or `test/`; `scripts/` imports nothing from `src/`. The only `.gitignore` change is the one P1-01 asked for, plus the `.kukulu/implement.lock` line written by the pipeline. No CI, editor or `.gitattributes` edits.
- `prChecks`: `pass` (no failing checks). Round 1 does not need this, but it is recorded here.
- Mutation sample (`kukulu_mutate`, all restored, tree clean afterwards):

| File | Mutation | Result |
|---|---|---|
| `src/auth/index.ts` | final unknown-name `unauthorized` → `next()` | killed (auth.test) |
| `src/auth/index.ts` | drop `WWW-Authenticate` | killed (auth.test) |
| `src/config.ts` | equal endpoint names check → `if (false)` | killed (config.test) |
| `src/env-info.ts` | drop `requestCount += 1` | killed (env-info.test) |
| `src/app.ts` | remove auth middleware | killed (app.test) |
| `src/routes/whoami.ts` | `subject` → `null` | killed (app.test) |
| `src/routes/stream.ts` | remove `res.on('close')` clear | killed (stream.test) |
| `src/routes/stream.ts` | `>=` → `>` on last tick | killed (stream.test) |
| `src/server.ts` | remove SIGTERM `setTimeout` fallback | killed (server.test) |
| `scripts/build.sh` | `--format=cjs` → `esm` | killed (bundle.test) |
| `infra/app.yaml` | `EndpointName: iam` → `iam-x` | killed (infra.test pairing) |
| `src/auth/jwt-verifier.ts` | `tokenUse: 'access'` → `'id'` | **survived** |
| `src/auth/jwt-verifier.ts` | `tokenUse` → `null` | **survived** |
| `src/auth/jwt-verifier.ts` | `clientId` → `null` | **survived** |
| `src/auth/jwt-verifier.ts` | `sub: payload.sub` → `String(payload.username)` | **survived** |
| `src/auth/jwt-verifier.ts` | add eager `inner.hydrate().catch(() => {})` | **survived** |

## Findings

### 1. (Category 3, tests) The JWT adapter's SPEC-required behaviour is untested, and its "no JWKS fetch" test cannot fail. Task R1-01

- **Where:** `src/auth/jwt-verifier.ts:5-14`, `test/jwt-verifier.test.ts:5-30`.
- **What is wrong:** SPEC section 4 requires the adapter to build `CognitoJwtVerifier` with `tokenUse: "access"` and `clientId`, and to return the token's `sub` (section 6). None of this is tested. All five mutants in the table above survived the full test suite, including `tokenUse: 'id'` and `clientId: null`. Both still type-check, because aws-jwt-verify's types accept `null` for each.
  The test `rejects a malformed token without fetching a JWKS` stubs `globalThis.fetch`. On Node, aws-jwt-verify 5.2.1 does not use global `fetch`: `dist/esm/node-web-compat-node.js` imports its fetcher from `https-node.js`, which calls `node:https` `request`. The assertion `fetchStub` was "never called" therefore always holds. A malformed token also fails at parse time, before any JWKS lookup. The eager-`hydrate()` mutant shows the effect: it makes a real outbound HTTPS request during `createJwtVerifier`, and the test still passes. The test guards nothing.
- **What would break:** a regression to `tokenUse: 'id'`, or a dropped `clientId`, would let ID tokens or tokens from another app client through on the `public` endpoint. That weakens the auth the whole SPEC hinges on (principles 2 and 3), and nothing before the manual phase 3 smoke test would catch it. A regression to eager JWKS fetching would make tests touch the network, which the SPEC section 2 non-goal forbids, and nothing would catch that either.
- **Minimal fix:** give the adapter an offline seam through its own API so a test can run a real `verify` with a local key. For example, an optional second parameter that pre-loads a JWKS through the inner verifier's `cacheJwks`, in the same dependency-injection style as `createApp(config, deps)`. Then replace the vacuous fetch-stub test with tests that sign tokens locally using an RSA key from `node:crypto`. The seam must not be an env var, a bypass flag or a test-only branch.

## Spec issues

- PLAN P1-02 tells the tests to prove "no JWKS fetch" by stubbing `globalThis.fetch`. That is the wrong seam for aws-jwt-verify 5.x on Node, which fetches through `node:https`. A future plan should prescribe an injected JWKS or fetcher instead.
- SPEC section 1 says `Ref` on `AWS::Lambda::WebFunction` returns the ARN, so the `FunctionName` output (`!Ref HelloFunction`, as SPEC section 4 specifies) holds an ARN, not a name. This does no harm, but the output name is misleading. SPEC could use a `GetAtt` for the name, if the resource has one, or rename the output.
- PLAN P1-03's acceptance case `'iam '` (trailing space) cannot be sent over HTTP, because the parser trims header values. The implementer used `'IAM'`, `'iam2'` and `'Public'` instead, which is a sound substitute.

## Manual checks still owed

All NOT VERIFIED (human), copied from HANDOFF.md:

- Phase 1: `npm run dev`; iam `/whoami` 200 (authMode iam, subject null); public without token 401 with `WWW-Authenticate: Bearer`; no header 401; `curl -N` on `/stream` shows ticks one at a time. (The implementer did run `npm run dev` and saw `/whoami` return 200 on iam.)
- Phase 2: `npm run deploy` succeeds in us-west-2; function `lwf-hello` has one revision and two Active endpoints (`iam`, `public`).
- Phase 3: `create-test-user` prints a token; `smoke:iam` and `smoke:jwt` exit 0; `/whoami` shows a shared `envId` and rising `requestCount` on both endpoints; logs in `/aws/lambda/web/lwf-hello`; `npm run teardown` removes both stacks.

`scripts/smoke-iam.ts`, `smoke-jwt.sh`, `create-test-user.sh`, `deploy.sh` and `teardown.sh` were only syntax-checked and usage-tested. None was run against AWS.

## Notes

- The HANDOFF interpretation choices are all consistent with SPEC and PLAN: `STREAM_INTERVAL_MS=0` is accepted, an empty endpoint header counts as missing, empty commits were used for the phase-end tasks, and the stream timing test allows 5 ms of slack. The slack hardly matters, because the first-to-last span is about 80 ms against a 35 ms floor.
- The shell scripts' AWS logic is covered only by `bash -n`, the usage-exit tests and text checks. That is by design (no-AWS rule), and the phase 3 manual checks cover it.
- On the `public` endpoint the auth middleware exempts `req.path === '/health'` exactly. Express routing is case-insensitive, so `/HEALTH` reaches the health route but still needs a token. That fails closed, so it is acceptable.
