# Review: build/2026-10-31 (flight sam-two-functions)
Round: 2

## Verdict

APPROVED

Categories 1–3 are clean across the whole branch, and no task is blocked or skipped. Since the round-1 review (`2e8489f`), the branch changed only `test/app.test.ts` and `test/scripts.test.ts` (R1-01, R1-02), plus pipeline bookkeeping in `docs/HANDOFF.md`, `docs/PROGRESS.md` and `.kukulu/state.json`. No `src/`, `scripts/`, `template.yaml` or config file changed, so the round-1 whole-branch findings still hold for constraints, boundaries, spec drift and the interpretation choices.

`kukulu_verify` (run by me at `6451b66`):
- All 18 constraints passed, with no fixture failures and no hits.
- `npm run typecheck`, `npm run lint`, `npm test` (11 files, 115 tests) and `npm run build` (`sam build`) all passed.

## Findings

None.

## Round-2 mutation check

Per the round-2 rule, I mutated only the files of the round-1 fix tasks. I re-ran every round-1 survivor in those files. Each kill used the targeted `vitest` command with `confirmKill: true`, and every re-run on the unmutated tree passed. So each kill below is real.

| File | Mutant | Result | Caught by |
|---|---|---|---|
| `src/app.ts` | request counter moved after auth | killed | app `requestCount counts rejected requests` (8 vs 9) |
| `src/app.ts` | `app.disable('x-powered-by')` deleted | killed | app `does not send X-Powered-By` |
| `src/app.ts` | `res.headersSent` branch of `errorHandler` deleted | killed | errorHandler `ends the response when headers were already sent` (`Error: aborted`) |
| `scripts/env.sh` | caller `AWS_REGION` wins (`${AWS_REGION:-...}`) | killed | scripts `env.sh overrides a caller AWS_REGION with samconfig.toml` |
| `scripts/env.sh` | `export AWS_REGION` deleted | killed | scripts `env.sh exports AWS_REGION` |
| `scripts/env.sh` | unreadable-samconfig guard disabled (`if false`) | killed | scripts `env.sh fails clearly without a readable samconfig.toml` |
| `scripts/env.sh` | samconfig located from `$(pwd)` | killed | scripts `env.sh finds samconfig.toml from its own location, not the cwd` (plus the unreadable-samconfig test) |

Each delivered test matches the acceptance test that PLAN `## Review fixes (round 1)` R1-01 and R1-02 name for it, in name, setup and assertion. Neither task changed a source or script file, as their design constraints required. The new tests stay inside the constraints: none spells `process.env`, the bash children inherit the environment (no `env` option), nothing calls AWS, and temp directories are removed in `finally`.

## PR checks

`kukulu_status.prChecks` reports `fail` for `CodeRabbit`. I checked this myself and it is not a finding for this flight:
- `gh pr list --head build/2026-10-31 --state all` returns only PR #5. That PR is `MERGED` into `main`, at head `af1b8ce`.
- This branch's head is `6451b66`, and no PR is open for it yet.
- On PR #5, `gh pr view 5` shows CodeRabbit as `COMPLETED / CANCELLED`, not failed.
- The repo has no `.github/workflows`, so this branch has no CI of its own.

The round-1 review recorded the same thing.

## Spec issues

None.

## Manual checks still owed

All NOT VERIFIED (human), copied from HANDOFF.md:

- Phase 1: `npm run dev` then `curl localhost:3000/whoami` (200, authMode iam, subject null); `curl -N localhost:3000/stream`; `npm run dev:public` then `curl -i localhost:3001/whoami` (401 + WWW-Authenticate: Bearer) and `/health` (200); `AUTH_MODE=none` fails at startup.
- Phase 2: `npm run deploy` succeeds in us-west-2; console shows `lwf-iam` (endpoint `iam`, IAM auth) and `lwf-public` (endpoint `public`), each Active with one revision; code bucket stack `lwf-<hash>-WebFunctionCode` exists.
- Phase 3: `npm run smoke:iam`, `create-test-user`, `smoke:jwt` exit 0; stable `envId` and rising `requestCount` per function, different `envId`s across functions; logs in `/aws/lambda/web/lwf-iam` and `/aws/lambda/web/lwf-public`; `npm run teardown` removes both stacks.

## Notes

- `test/scripts.test.ts` `env.sh exports AWS_REGION` (advisory). The test inherits the caller's environment. If the shell running `npm test` already exports `AWS_REGION`, the assignment in `env.sh` keeps it exported, so the test would also pass without `export AWS_REGION`. It killed the mutant here because this shell does not export `AWS_REGION`. Prefixing the `bash -c` script with `unset AWS_REGION;` would make the test independent of the environment without spelling `process.env`. This is a robustness gap in the test, not a gap in coverage. It is a note and not a finding, for two reasons:
  - PLAN R1-02 acceptance test (2) specifies exactly this command, `bash -c 'source scripts/env.sh && printenv AWS_REGION'`, and does not require independence from the caller's environment, so the delivered test matches its task.
  - The kill is real on the machine that runs verify.
- Carried from round 1: the `scripts/smoke-iam.ts` survivors (the `/whoami` `authMode`/`subject` checks and the unsigned-403 check) are still untested offline. The Phase 3 manual run covers them.
- Carried from round 1: the README "Environment reuse" section could point `lwf-iam` readers at `npm run smoke:iam`, because a plain `curl` gets 403 there.
- Carried from round 1: `scripts/env.sh` unsets `_samconfig` only on the success path. This is harmless.
- `pr=draft`: the head branch name `build/2026-10-31` was already used by the merged PR #5. The operator should check that the new draft PR targets `flight/sam` and is not confused with #5.
