# Review
Round: 2

Branch: `build/2026-10-31` (base `e4735a5`, head `08fb001`). 16 tasks done (15 plan tasks and R1-01), 0 blocked, 0 skipped.

## Verdict

APPROVED

## What was checked

- `prChecks` from `kukulu_status`: `pass`, with no failing checks.
- `kukulu_verify` (run by the reviewer): all 13 constraints pass, with no fixture failures and no hits. Typecheck, lint, `npm test` (82 tests in 11 files) and `npm run build` all exit 0.
- `docs/SPEC.md` was read in full. Section 4's `src/auth/jwt-verifier.ts` row requires a `CognitoJwtVerifier` with `tokenUse: "access"` and `clientId` behind a `JwtVerifier` interface. It does not pin the factory's signature, so the optional `jwks?` parameter is an additive extension that SPEC allows. Principle 3 ("tests pass a fake and never fetch a JWKS") and the section 2 non-goal (no test touches the network) both still hold.
- Fix-round diff (`c101b0e..HEAD`) touches only `src/auth/jwt-verifier.ts`, `src/auth/types.ts` and `test/jwt-verifier.test.ts`, plus pipeline docs and state. Commit `6d17f98` (R1-01) was read against the PLAN task and SPEC sections 2, 3, 4 and 6:
  - The seam is an optional second parameter, `createJwtVerifier(settings, jwks?)`. It pre-loads keys through `inner.cacheJwks`. It is not an env var, a bypass flag or a test-only branch. `src/server.ts` still calls `createJwtVerifier(config.auth.cognito)` unchanged, so production keeps loading the JWKS lazily. Nothing calls `hydrate()` eagerly.
  - The `Jwks` type was added to `src/auth/types.ts` as a type only. The task's design constraints explicitly allow this, even though the task's "Files touched" line omits the file.
  - The test does not import or mock `aws-jwt-verify`. It signs RS256 tokens locally with `node:crypto`. The vacuous `globalThis.fetch` stub test is gone.
  - No other test sends a token to a real verifier: `app.test.ts` and `auth.test.ts` use fakes, and `server.test.ts` sends no Bearer token. The unmutated suite makes no network calls.
- The whole branch was reviewed in round 1 (see that round's REVIEW in git history: `git show c101b0e:docs/REVIEW.md`). Outside the files listed above, nothing in `src/`, `infra/`, `scripts/` or `test/` has changed since then. No `.gitignore`, CI, editor or `.gitattributes` changes in this round.
- Mutation testing of the fix-round files, using `kukulu_mutate` with the `vitest` target on `test/jwt-verifier.test.ts` and `confirmKill: true`. Every kill was confirmed: the unmutated test file passes 6/6.

| File | Mutation | Result |
|---|---|---|
| `src/auth/jwt-verifier.ts` | `tokenUse: 'access'` → `'id'` | killed ("resolves a valid access token to its sub", "rejects an id token") |
| `src/auth/jwt-verifier.ts` | `tokenUse` → `null` | killed ("rejects an id token") |
| `src/auth/jwt-verifier.ts` | `clientId` → `null` | killed ("rejects a token for another client id") |
| `src/auth/jwt-verifier.ts` | `sub: payload.sub` → `String(payload.username)` | killed ("resolves a valid access token to its sub") |
| `src/auth/jwt-verifier.ts` | add eager `inner.hydrate().catch(() => {})` | killed ("does not fetch the JWKS at creation") |
| `src/auth/jwt-verifier.ts` | remove the `cacheJwks` pre-load | killed ("resolves a valid access token to its sub") |

`src/auth/types.ts` changed only by gaining a type, so there was nothing to mutate there.

## Findings

None. Categories 1 to 3 are clean across the branch, and there are no blocked tasks.

## Spec issues

Carried over from round 1. None of these blocks approval.

- PLAN P1-02 prescribed proving "no JWKS fetch" by stubbing `globalThis.fetch`. That is the wrong seam for aws-jwt-verify 5.x on Node, which fetches through `node:https`. R1-01 fixed the test. A future plan should prescribe an injected JWKS instead.
- `Ref` on `AWS::Lambda::WebFunction` returns the ARN, so the `FunctionName` output (`!Ref HelloFunction`, as SPEC section 4 specifies) holds an ARN, not a name. The output name is misleading.
- PLAN P1-03's acceptance case `'iam '` (with a trailing space) cannot be sent over HTTP, because the parser trims header values. The substitutes the implementer chose (`IAM`, `iam2`, `Public`) are sound.

## Manual checks still owed

All are NOT VERIFIED (human), copied from HANDOFF.md:

- Phase 1:
  - Run `npm run dev`.
  - On the `iam` endpoint, `/whoami` returns 200 with authMode `iam` and subject `null`.
  - On `public` without a token: 401 with `WWW-Authenticate: Bearer`.
  - With no endpoint header: 401.
  - `curl -N` on `/stream` shows the ticks arriving one at a time.
- Phase 2: `npm run deploy` succeeds in us-west-2. Function `lwf-hello` has one revision and two Active endpoints (`iam`, `public`).
- Phase 3:
  - `create-test-user` prints a token.
  - `smoke:iam` and `smoke:jwt` exit 0.
  - `/whoami` shows a shared `envId` and a rising `requestCount` on both endpoints.
  - Logs appear in `/aws/lambda/web/lwf-hello`.
  - `npm run teardown` removes both stacks.

`scripts/smoke-iam.ts`, `smoke-jwt.sh`, `create-test-user.sh`, `deploy.sh` and `teardown.sh` were only syntax-checked and usage-tested. None was run against AWS.

R1-01 adds no manual checks.

## Notes

- `src/auth/jwt-verifier.ts:15` casts the `Jwks` type through `unknown` to the library's parameter type. This keeps `aws-jwt-verify` types out of `src/auth/types.ts`, as the boundary requires. The cost is that a malformed JWKS passed by a caller would not be caught at compile time. Only tests pass it, so this is acceptable.
- In the "does not fetch the JWKS at creation" test, the spy on `net.Socket.prototype.connect` returns without connecting. Under the eager-hydrate mutant, that leaves pending sockets until the request times out. This only happens under mutation and does not affect the real suite.
- The CLAUDE.md module map is now out of date in two rows. The `src/auth/jwt-verifier.ts` row still reads `createJwtVerifier(settings)`, and the `src/auth/types.ts` row does not list `Jwks`. R1-01 did not have CLAUDE.md in its files, so this is not a finding. The summarizer can carry it forward.
- When `cacheJwks` was removed, the mutant made a real HTTPS request to Cognito (it got a 404). That is expected: it shows the injected JWKS is what keeps the real suite offline.
