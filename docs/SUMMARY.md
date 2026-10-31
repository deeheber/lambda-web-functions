# Summary: flight sam-two-functions

**Merge:** `build/2026-10-31`, base `flight/sam` (merge base `50576cd`) → head `dcc0abf`, 35 commits, 2 reviews, final verdict **APPROVED** (review 2).

## What was built

**Phase 1: App (P1-01 to P1-03).** Auth no longer routes on the `lambda-web-endpoint-name` header. A new required `AUTH_MODE` setting (`iam` or `jwt`, exact match) picks the mode for each process. In `iam` mode every request is accepted (Lambda's IamAuth has already checked the SigV4 signature). In `jwt` mode a Cognito access token is required everywhere except `/health`, and a missing or bad token gets 401 with `WWW-Authenticate: Bearer`. `AUTH_MODE=none` or any other value stops the process at startup. `/whoami` now returns `authMode`, `subject`, `envId`, `startedAt`, `requestCount` and no longer returns `endpoint`. The server builds the JWT verifier only in `jwt` mode. New `dev` and `dev:public` npm scripts run the iam and jwt variants locally on ports 3000 and 3001. P1-03 is the phase-end push.

**Phase 2: SAM template and build (P2-01 to P2-03).** The hand-written CloudFormation (`infra/`) and the zip/upload scripts are replaced by one SAM `template.yaml` with two `AWS::Serverless::WebFunction`s: `lwf-iam` (IamAuth, `AUTH_MODE=iam`) and `lwf-public` (ApplicationManaged, `AUTH_MODE=jwt`, Cognito pool and client). Both use `EndpointType: HomeRegion`. A `samconfig.toml` names the stack `lwf` and the Region `us-west-2`. `npm run build` is now `sam build`, and `deploy`/`teardown` call the SAM CLI. `infra/`, `scripts/{build,deploy,teardown}.sh` and `test/infra.test.ts` are deleted. `test/template.test.ts` and a rewritten `test/bundle.test.ts` replace them. P2-03 is the phase-end push.

**Phase 3: Smoke tests and docs (P3-01 to P3-03).** `scripts/env.sh` now reads `stack_name` and `region` from `samconfig.toml` and overrides any `AWS_REGION` the caller set, so the smoke and test-user scripts always target the stack `sam deploy` used. The smoke-iam script was updated for the per-function URLs. The README was rewritten for the two-function SAM layout, and the CLAUDE.md module map was checked against the finished code. P3-03 is the phase-end push.

**Review fixes (R1-01, R1-02).** These add tests only. R1-01 covers three mechanics in `src/app.ts`: rejected requests are counted before auth, `X-Powered-By` is absent, and the `headersSent` path of `errorHandler` works. R1-02 covers four mechanics in `scripts/env.sh`: the samconfig Region wins over the caller's, `AWS_REGION` is exported, the unreadable-samconfig guard fires, and samconfig is found from `BASH_SOURCE`.

## Decisions that shaped it

From PLAN.md Decisions:
- (plan) Phases follow SPEC section 8 (P1 App, P2 SAM, P3 Smoke/docs). There is no phase 0.
- (plan) No parallel streams. The plan is fully serial because nearly every task touches shared wiring.
- (plan) The base branch is `flight/sam`, so all changes reach `main` through a PR.
- (plan) No ⚠️ ASSUMPTION tuning tasks. Each value has one home: `STREAM_TICKS`/`STREAM_INTERVAL_MS` in `src/config.ts`, `MaxEnvironments`/`RateLimit` as `template.yaml` parameters.
- (P1-01) `AuthConfig` is a discriminated union exported from `src/config.ts` and imported type-only by `src/auth/index.ts`. `AuthEndpoints` is deleted.
- (P1-01) `authMiddleware(auth, verifier?)` throws at construction when the mode is `jwt` and no verifier is given. It fails closed at startup rather than with a 401 at request time.
- (P1-01) `createApp(config, deps)` keeps `deps` required (`AppDeps = { verifier?: JwtVerifier }`). The iam server passes `{}`.
- (P1-01) `AUTH_MODE` is parsed with an exact, case-sensitive match and no trimming. An empty value counts as unset and throws `AUTH_MODE is required`. Any other value throws an error that names it.
- (P1-01) In `iam` mode the Cognito variables are not read or validated. `config.auth` is exactly `{ mode: 'iam' }`.
- (P1-01) `/whoami` key order is `authMode, subject, envId, startedAt, requestCount`. `endpoint` is removed.
- (P1-01) The jwt `/health` exemption matches `req.path === '/health'` exactly, and `subject` is null there. Every jwt 401 carries `WWW-Authenticate: Bearer`. iam mode never returns 401.
- (P1-01) `requestCount` works as in 0.1: it is incremented once per request, rejected requests included, before auth.
- (P1-01) `server.ts` builds the verifier only in jwt mode. The listening line gains `authMode`. `SHUTDOWN_DEADLINE_MS = 500` is unchanged.
- (P1-02) `dev`/`dev:public` both use the esbuild CJS bundle in `dist/`. `dev:public` uses fake Cognito values (`us-west-2_000000000`/`local`) on `127.0.0.1:3001`.
- (P2-01) `EndpointType: HomeRegion` is set explicitly on both functions. `AutoDeploymentMode` and `RevisionWeights` are omitted.
- (P2-01) `npm run build` becomes `sam build` in the task that creates `template.yaml`. `.aws-sam/` is added to `.gitignore` and the eslint ignores, and `cfn-lint template.yaml` runs as extraVerify from P2-01.
- (P2-01) `test/bundle.test.ts` always rebuilds in `beforeAll` and copies each `server.js` to a fresh temp dir before running it.
- (P2-02) All 0.1 infra and build files are deleted together in P2-02.
- (P3-01) `scripts/env.sh` stays as the shared helper and reads stack name and Region from `samconfig.toml`. A shell-wide `AWS_REGION` cannot redirect the scripts.
- (P1-01) `AUTH_MODE=none` is also proven offline in `test/server.test.ts`.
- (plan) The README may repeat SPEC section 5 defaults as documentation. The "one home" rule applies to code and config.
- (plan) The planner rewrote CLAUDE.md's shared sections for 0.2 up front. P3-02 only confirms the module map.

From HANDOFF.md Interpretation choices:
- P1-01: the unknown `AUTH_MODE` error reads `AUTH_MODE must be "iam" or "jwt", got "<value>"`.
- P1-03, P2-03, P3-03: the phase-end tasks made no code changes. Empty commits were created so `kukulu_task_done` could stamp a sha.
- P3-01: `create-test-user.sh` and `smoke-jwt.sh` already matched the spec and were left unchanged.
- P3-02: the only CLAUDE.md module-map drift was the "after P3-01" wording on the `scripts/env.sh` row.
- R1-01, R1-02: none.

## Assumptions still in play

- `STREAM_TICKS` = `5` (`src/config.ts`): still a guess, not tuned.
- `STREAM_INTERVAL_MS` = `500` (`src/config.ts`): still a guess, not tuned.
- `MaxEnvironments` = `2` (`template.yaml` parameter default): still a guess, not tuned.
- `RateLimit` = `100` (`template.yaml` parameter default): still a guess, not tuned.

## Spec issues

From PLAN.md, each resolved in the plan. Consider folding them into SPEC.md:
- CLAUDE.md update timing (section 8, Phase 3): the shared sections were rewritten up front, not in Phase 3.
- `test/readme.test.ts` (section 8): adding `dev:public` in Phase 1 forced a minimal README edit in P1-02.
- Region and stack name in two places (section 4): `env.sh` now reads both from `samconfig.toml`.
- `AUTH_MODE=none` manual check (section 8, Phase 1): it can be checked offline and is covered by `test/server.test.ts`.
- `EndpointType` (sections 1, 2): SPEC does not say whether to set it. It is now set explicitly and asserted by a test, because no linter validates it.
- `Timeout` vs `TimeoutSeconds` (sections 4, 5): the SAM property `Timeout` is set to `!Ref TimeoutSeconds`.
- `yaml` short-form tags (section 3, principle 7): the parser cannot tell `!Ref X` from the literal string `'X'`. The reviewer checks that case by reading.
- `parallel.setup` (section 7) names `npm ci`, but no streams are used.
- `npm test` now runs `sam build` (section 7): it needs the SAM CLI and npm network access, and it builds twice per verify.
- SAM CLI telemetry (section 2): `sam build` may send telemetry unless `SAM_CLI_TELEMETRY=0` is set. SPEC is silent on this.

From REVIEW.md round 1: none. From REVIEW.md round 2: none.

Known-gap candidates: none. The final REVIEW.md has no `Known-gap candidates` bullets.

## Manual checks owed

All NOT VERIFIED (human):
- **Phase 1:** run `npm run dev`, then `curl localhost:3000/whoami`. Expect 200, `authMode` `iam` and `subject` null. Run `curl -N localhost:3000/stream` and expect ticks to stream. Run `npm run dev:public`, then `curl -i localhost:3001/whoami` and expect 401 with `WWW-Authenticate: Bearer`. `/health` there should return 200. `AUTH_MODE=none` should fail at startup.
- **Phase 2:** `npm run deploy` should succeed in us-west-2. The console should show `lwf-iam` (endpoint `iam`, IAM auth) and `lwf-public` (endpoint `public`), each Active with one revision. The code bucket stack `lwf-<hash>-WebFunctionCode` should exist.
- **Phase 3:** `npm run smoke:iam`, `create-test-user` and `smoke:jwt` should each exit 0. Each function should report a stable `envId` and a rising `requestCount`, and the two functions should report different `envId`s. Logs should appear in `/aws/lambda/web/lwf-iam` and `/aws/lambda/web/lwf-public`. `npm run teardown` should remove both stacks.

## Review history

- Review 1: CHANGES REQUESTED. 2 findings (F1 `src/app.ts` untested mechanics, P1-01; F2 `scripts/env.sh` untested mechanics, P3-01), giving 2 fix tasks (R1-01, R1-02). Sources: review 0, mutation 2, blocked 0. 0 unblocked. Converging.
- Review 2: APPROVED. 0 findings and 0 fix tasks. No finding recurred: the round-1 task IDs do not reappear, and all 7 round-1 survivors in the fixed files are now killed. **Notes-only approval:** REVIEW.md carries a `## Notes` section. It covers a robustness gap in the `env.sh exports AWS_REGION` test (it depends on the caller not exporting `AWS_REGION`; prefixing `unset AWS_REGION;` would fix it), the carried smoke-iam survivors, a README pointer suggestion (send `lwf-iam` readers to `npm run smoke:iam`), the harmless `_samconfig` unset, and the PR head-branch collision with merged PR #5. None of these was queued as work.

## Pipeline friction

- review, stale-pr-checks: kukulu_status prChecks reported state "fail" (CodeRabbit) for PR #5, which is the already-MERGED init-setup PR: this flight reuses the branch name build/2026-10-31 (date-based branchPrefix), so gh resolves the old PR. The check was CANCELLED, not failed, and belongs to a different flight; the reviewer had to query gh by hand to discover this, and the pr=draft step may hit the same collision.

## Suggested CLAUDE.md additions

- Never run bare `sam build`: esbuild is a devDependency found only via npm's PATH. Always `npm run build`.
- A built bundle run in place under `.aws-sam/build/<Fn>/` crashes (`require is not defined`) because Node finds the root `package.json` with `"type": "module"`; bundle.test.ts copies `server.js` to a temp dir first.
- `.aws-sam/` must be in both `.gitignore` and the eslint `ignores`, or lint reports ~1,280 errors from the minified bundle.
- `scripts/env.sh` now takes `STACK_NAME` and `AWS_REGION` from `samconfig.toml` and overrides any caller `AWS_REGION`.
- macOS BSD `sed -i` needs a suffix argument; use perl or python for in-place edits.

## Advisory mutation survivors

- Carried from round 1: the `scripts/smoke-iam.ts` survivors (the `/whoami` `authMode`/`subject` checks and the unsigned-403 check) are still untested offline. The Phase 3 manual run covers them.

## Breaking call

Breaking: yes — the flight replaces the deployed 0.1 shape (one function, two endpoints, `infra/` CloudFormation, `AUTH_ENDPOINT_*` env vars) with two SAM WebFunctions and a required `AUTH_MODE`, changes the `/whoami` body (drops `endpoint`, adds `authMode`), and changes `npm run build`/`deploy`/`teardown` to the SAM CLI. Existing deployments and callers that rely on 0.1 behavior would break. The repository has no CHANGELOG.md.
