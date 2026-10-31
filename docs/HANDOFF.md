# Handoff

Branch: build/2026-10-31 (base flight/sam). Head before handoff: b2e8c68. Tasks: 9 done, 0 blocked, 0 skipped.

## Blocked / skipped
None.

## Interpretation choices
- P1-01: none beyond the plan. Unknown AUTH_MODE error message reads `AUTH_MODE must be "iam" or "jwt", got "<value>"`.
- P1-03, P2-03, P3-03: phase-end tasks made no code changes; an empty commit was created so `kukulu_task_done` could stamp a sha.
- P3-01: `create-test-user.sh` and `smoke-jwt.sh` already matched the spec and were left unchanged.
- P3-02: the only CLAUDE.md module-map drift was the "after P3-01" wording on the `scripts/env.sh` row.

## Assumption config keys
- `STREAM_TICKS` = 5, `STREAM_INTERVAL_MS` = 500 (src/config.ts): not tuned.
- `MaxEnvironments` = 2, `RateLimit` = 100 (template.yaml parameters): not tuned.

## Manual checks (all NOT VERIFIED, human)
- Phase 1: `npm run dev` then `curl localhost:3000/whoami` (200, authMode iam, subject null); `curl -N localhost:3000/stream`; `npm run dev:public` then `curl -i localhost:3001/whoami` (401 + WWW-Authenticate: Bearer) and `/health` (200); `AUTH_MODE=none` fails at startup.
- Phase 2: `npm run deploy` succeeds in us-west-2; console shows `lwf-iam` (endpoint `iam`, IAM auth) and `lwf-public` (endpoint `public`), each Active with one revision; code bucket stack `lwf-<hash>-WebFunctionCode` exists.
- Phase 3: `npm run smoke:iam`, `create-test-user`, `smoke:jwt` exit 0; stable `envId` and rising `requestCount` per function, different `envId`s across functions; logs in `/aws/lambda/web/lwf-iam` and `/aws/lambda/web/lwf-public`; `npm run teardown` removes both stacks.

## Codebase notes
- Never run bare `sam build`: esbuild is a devDependency found only via npm's PATH. Always `npm run build`.
- A built bundle run in place under `.aws-sam/build/<Fn>/` crashes (`require is not defined`) because Node finds the root `package.json` with `"type": "module"`; bundle.test.ts copies `server.js` to a temp dir first.
- `.aws-sam/` must be in both `.gitignore` and the eslint `ignores`, or lint reports ~1,280 errors from the minified bundle.
- `scripts/env.sh` now takes `STACK_NAME` and `AWS_REGION` from `samconfig.toml` and overrides any caller `AWS_REGION`.
- macOS BSD `sed -i` needs a suffix argument; use perl or python for in-place edits.

## For the reviewer
- Auth is now `AUTH_MODE` (`iam`|`jwt`) in `src/config.ts`; `authMiddleware(auth, verifier?)` throws at construction for jwt without a verifier; the verifier is only built in jwt mode in `src/server.ts`.
- Infra moved from `infra/` + hand-written scripts to `template.yaml` (SAM, two `AWS::Serverless::WebFunction`) and `samconfig.toml`. `infra/`, `scripts/{build,deploy,teardown}.sh` and `test/infra.test.ts` are deleted.
- Nothing in this run called AWS; `cfn-lint template.yaml` and `npm run build` (sam build, local) pass.

## Round 1
Review-fix round: 2 tasks done (R1-01, R1-02), 0 blocked. Total 11 done.
- R1-01: three tests in test/app.test.ts (rejected requests counted, no X-Powered-By, headersSent path). No src changes.
- R1-02: four tests in test/scripts.test.ts for scripts/env.sh (samconfig region wins, exported, unreadable guard, BASH_SOURCE lookup). No script changes.
- Interpretation: none. The mutant re-runs (kukulu_mutate) were not available to the implementer; the reviewer should re-run them.
- Full verify green (typecheck, lint, 115 tests, build).
