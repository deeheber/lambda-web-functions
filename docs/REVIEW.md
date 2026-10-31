# Review: build/2026-10-31 (flight sam-two-functions)
Round: 1

## Verdict

CHANGES REQUESTED

Constraints (category 1) and boundaries (category 2) are clean, and so is spec drift. Every acceptance test named in PLAN exists and passes. `kukulu_verify` is green: all 18 constraints passed with no fixture failures and no hits, and typecheck, lint, `npm test` (11 files, 108 tests) and `npm run build` (`sam build`) all passed. Mutation sampling found untested mechanics in two files: `src/app.ts` (3 survivors) and `scripts/env.sh` (4 survivors). Each gets one fix task, and both fixes add tests only.

## Findings

### F1. Category 3 (tests): three mechanics in `src/app.ts` are untested (P1-01)

- `src/app.ts:31-35`: the request counter runs before auth. PLAN Decisions ("requestCount semantics") says it counts once per request, rejected ones included, before auth. I swapped the two `app.use` calls so auth runs first, which means rejected requests are no longer counted. That mutant survived `test/app.test.ts`, `test/auth.test.ts` and `test/stream.test.ts`. `requestCount rises by one per request` only sends accepted iam requests, so it cannot see the order.
  - What would break: a refactor could stop counting 401s, and `/whoami` would silently under-report environment reuse.
  - Fix: add a jwt-mode test. Send `/whoami` with a token (count n), then `/whoami` without a token (401), then `/whoami` with a token again. The last count must be n + 2.
- `src/app.ts:30`: I deleted `app.disable('x-powered-by')` and the mutant survived. PLAN P1-01 says this line stays. Fix: assert that the `x-powered-by` header is absent.
- `src/app.ts:21-24`: I deleted the `res.headersSent` branch of `errorHandler` and the mutant survived. This branch matters for `/stream`: an error after `flushHeaders()` must end the response rather than try to send a 500. Fix: add an `errorHandler` test with a route that writes a partial body and then calls `next(err)`. The response must complete with the original status and the partial body, and must not hang or throw `ERR_HTTP_HEADERS_SENT`.
- Task: R1-01.

### F2. Category 3 (tests): `scripts/env.sh` mechanics from the P3-01 rework are untested (P3-01)

`env.sh takes the stack name and Region from samconfig.toml` runs only in the repo root with no `AWS_REGION` in the inherited shell, so it cannot tell the designed behaviour from a weaker one. Four mutants survived `test/scripts.test.ts`:
- `scripts/env.sh:13`: `AWS_REGION="$(_samconfig_value region)"` changed to `AWS_REGION="${AWS_REGION:-$(_samconfig_value region)}"`. A caller's `AWS_REGION` then wins. That is exactly the 0.1 hazard that PLAN P3-01 and PLAN Spec issues ("Region and stack name in two places") set out to remove: the smoke scripts would query a different Region than `sam deploy` used. The test passes only because the reviewer's shell had no `AWS_REGION` set.
- `scripts/env.sh:18`: `export AWS_REGION` deleted. The `aws` CLI children of `create-test-user.sh` and `smoke-jwt.sh` would then not see the Region.
- `scripts/env.sh:14`: the "could not read stack_name and region" guard disabled (`if false; then`).
- `scripts/env.sh:3`: the `samconfig.toml` lookup changed from `${BASH_SOURCE[0]}` to `$(pwd)`. PLAN P3-01 says to locate the file from `${BASH_SOURCE[0]}`, not from the caller's working directory. The test runs with `cwd: root`, so it cannot tell the difference.
- What would break: `npm run smoke:iam`, `create-test-user` and `smoke:jwt` could target the wrong Region or stack with no error.
- Fix: add tests only. The bash children inherit the environment (no `env` option), and the test file must not spell `process.env`.
- Task: R1-02.

## Mutation sampling (round 1)

| File | Mutant | Result | Caught by |
|---|---|---|---|
| `src/auth/index.ts` | `/health` exemption becomes `/healthz` | killed | auth `jwt mode allows /health without a token`, app `GET /health returns 200 in jwt mode without a token` |
| `src/auth/index.ts` | construction-time throw for jwt without a verifier removed | killed | auth and app `throws ... without a verifier` |
| `src/config.ts` | unknown `AUTH_MODE` falls back to iam | killed | config `throws on an unknown AUTH_MODE: *`, server `exits non-zero when AUTH_MODE is none` |
| `src/config.ts` | `COGNITO_CLIENT_ID` not required | killed | config `throws in jwt mode when COGNITO_CLIENT_ID is missing` |
| `src/app.ts` | counter moved after auth | **survived** | none |
| `src/app.ts` | `x-powered-by` left enabled | **survived** | none |
| `src/app.ts` | `headersSent` branch removed | **survived** | none |
| `src/app.ts` | `notFoundHandler` removed | killed | app `unknown path returns 404 not_found in iam mode` |
| `src/app.ts` | `requestCount = 1` | killed | app `requestCount rises by one per request` |
| `src/server.ts` | verifier built from a hard-coded pool, not `config.auth.cognito` | killed | server `exits non-zero in jwt mode with a malformed COGNITO_USER_POOL_ID` |
| `src/routes/whoami.ts` | `subject: null` | killed | app `GET /whoami in jwt mode with a valid token ...` |
| `src/auth/jwt-verifier.ts` | `tokenUse: 'id'` | killed | jwt-verifier `resolves a valid access token`, `rejects an id token` |
| `src/routes/stream.ts` | `tick += 2` | killed | stream `streams stream.ticks events then ends` |
| `template.yaml` | iam `EndpointType: MultiRegion` | killed | template `both functions have a HomeRegion endpoint ...` |
| `template.yaml` | public `AuthType: IamAuth` | killed | template `the IamAuth function ...`, `the ApplicationManaged function ...`, `every function's AUTH_MODE matches its AuthType` |
| `scripts/env.sh` | caller `AWS_REGION` wins | **survived** | none |
| `scripts/env.sh` | `export AWS_REGION` removed | **survived** | none |
| `scripts/env.sh` | unreadable-samconfig guard disabled | **survived** | none |
| `scripts/env.sh` | samconfig located from `$(pwd)` | **survived** | none |
| `scripts/smoke-iam.ts` | `service: 'execute-api'` | killed | scripts `smoke-iam.ts signs for service lambda ...` |
| `scripts/smoke-iam.ts` | `who.authMode === 'iam'` check removed | survived | none (see Notes) |
| `scripts/smoke-iam.ts` | `who.subject === null` check removed | survived | none (see Notes) |
| `scripts/smoke-iam.ts` | unsigned-403 check weakened | survived | none (see Notes) |

Every kill with a targeted command was re-run on the unmutated tree with `confirmKill`, and every re-run passed.

## Other checks (clean)

- Constraints: `kukulu_verify` reported every rule passing with no fixture failures. Reading the diff, I found no top-level `await`, no mutated top-level literals in `src/`, no `lambda-web-` anywhere in `src/` or `template.yaml`, and `aws-jwt-verify` imported only by the adapter.
- Boundaries: `src/` imports nothing from `scripts/` or `test/`, and `scripts/` imports nothing from `src/`. `src/auth/index.ts` imports `AuthConfig` from `../config.ts` with `import type` only. The `.gitignore` changes (add `.aws-sam/`, remove `*.zip`) and the `eslint.config.js` `.aws-sam/` ignore are the ones PLAN P2-01 and P2-02 called for.
- Spec drift: `template.yaml` matches SPEC section 4 and PLAN P2-01. `samconfig.toml` matches SPEC section 4. The `/whoami` key order, the listening line with `authMode`, and building the verifier only in jwt mode all match SPEC section 6 and PLAN P1-01. The bundle test copies `server.js` to a temp dir as SPEC section 7 requires. The README covers the SPEC section 8 Phase 3 list in the order PLAN P3-02 gives. The CLAUDE.md module map matches the code.
- HANDOFF interpretation choices: all four are consistent with SPEC and PLAN. The empty commits for phase-end tasks follow the phase-end protocol in CLAUDE.md.
- Blocked and skipped tasks: none.
- Clean-room: not active for this flight (`kukulu_status.cleanroom` is null, and `.kukulu/cleanroom/` does not exist).

## Spec issues

None.

## Manual checks still owed

All NOT VERIFIED (human), copied from HANDOFF.md:

- Phase 1: `npm run dev` then `curl localhost:3000/whoami` (200, authMode iam, subject null); `curl -N localhost:3000/stream`; `npm run dev:public` then `curl -i localhost:3001/whoami` (401 + WWW-Authenticate: Bearer) and `/health` (200); `AUTH_MODE=none` fails at startup.
- Phase 2: `npm run deploy` succeeds in us-west-2; console shows `lwf-iam` (endpoint `iam`, IAM auth) and `lwf-public` (endpoint `public`), each Active with one revision; code bucket stack `lwf-<hash>-WebFunctionCode` exists.
- Phase 3: `npm run smoke:iam`, `create-test-user`, `smoke:jwt` exit 0; stable `envId` and rising `requestCount` per function, different `envId`s across functions; logs in `/aws/lambda/web/lwf-iam` and `/aws/lambda/web/lwf-public`; `npm run teardown` removes both stacks.

## Notes

- `scripts/smoke-iam.ts` survivors (advisory, no task). The `/whoami` `authMode`/`subject` checks and the unsigned-403 check run only against a deployed `IamAuth` endpoint. The script also refuses non-`https://` URLs and resolves AWS credentials. An offline test would need a fake TLS server that mimics SigV4 rejection, or a text grep that only restates the code. Both cost more than they prove for manual-only tooling. The Phase 3 manual check runs the script for real. The risk that remains: if one of these checks were deleted, the smoke run would pass falsely.
- `prChecks` from `kukulu_status` shows `fail` for CodeRabbit. That result belongs to PR #5, the already-merged `init-setup` PR (base `main`), which used the same head branch name `build/2026-10-31`. On PR #5 the CodeRabbit check is `CANCELLED`, not failed. It says nothing about this flight. A round-2 reviewer should not treat it as a category-3 finding. The operator should also expect `pr=draft` to collide with the merged PR #5 on that branch name. I logged this as pipeline feedback.
- `README.md` "Environment reuse" says to call `/whoami` "several times on each endpoint". On `lwf-iam` a plain `curl` gets 403. The signed path is `npm run smoke:iam`. A pointer there would help a newcomer, but this is not a SPEC requirement.
- `scripts/env.sh` unsets `_samconfig` only on the success path. This is harmless.
