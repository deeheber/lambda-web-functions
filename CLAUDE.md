# Lambda Web Functions Hello World

A TypeScript Express 5 app deployed as one AWS Lambda Web Function with two endpoints (`iam`: IamAuth/SigV4, `public`: ApplicationManaged/Cognito JWT), defined in plain CloudFormation. Source of truth: `docs/SPEC.md`.

## Principles

- [ ] `process.env` appears only in `src/config.ts`; `loadConfig(env = process.env)` takes the env as a parameter so tests pass plain objects.
- [ ] Auth fails closed: missing or unknown `lambda-web-endpoint-name` → 401. No "disabled", `none`, `off` or `skip` mode anywhere.
- [ ] `lambda-web-endpoint-name` is read only in `src/auth/index.ts`.
- [ ] Only `src/auth/jwt-verifier.ts` imports `aws-jwt-verify`; the app gets a `JwtVerifier` through `createApp(config, deps)`, and tests pass a fake.
- [ ] The only module-level mutable state in `src/` is `requestCount` in `src/env-info.ts`. Per-request data lives in locals or `res.locals`.
- [ ] `infra/` has no 12-digit account IDs and no Region literals; use `AWS::AccountId`, `AWS::Region`, `AWS::Partition`.
- [ ] Nothing in `test/` and no verify command calls the `aws` CLI or creates an AWS SDK client. The flight never calls AWS.
- [ ] Pairing invariant (`test/infra.test.ts`): the revision's `AUTH_ENDPOINT_IAM`/`AUTH_ENDPOINT_JWT` name the `IamAuth`/`ApplicationManaged` endpoints; exactly one function, one revision, two endpoints.
- [ ] Every SPEC section 5 tunable has exactly one home with its default: a key in `src/config.ts` or a parameter in `infra/app.yaml`.
- [ ] Tests are written in the same task as the code they cover.

## Commands

- Install: `npm ci`
- Typecheck: `npm run typecheck` (`tsc --noEmit`)
- Lint: `npm run lint` (`eslint . --max-warnings 0`)
- Test: `npm test` (`vitest run`); one file: `npx vitest run <file>`
- Build: `npm run build` (`scripts/build.sh` → `dist/index.js` CJS bundle + `dist/app.zip`, prints sha256)
- Template lint: `cfn-lint infra/*.yaml` (exits non-zero on warnings too)
- Manual only (call AWS, never run by a task): `npm run dev`, `npm run deploy`, `npm run create-test-user -- <email>`, `npm run smoke:iam`, `npm run smoke:jwt -- <token>`, `npm run teardown`

## Module map

| Path | Responsibility |
|---|---|
| `src/server.ts` | Entry point: `loadConfig()` → `createJwtVerifier()` → `createApp()` → listen; JSON `listening` line; SIGTERM → exit 0 within 1 s |
| `src/app.ts` | `createApp(config, deps)`: request counting, auth on every route, routes, `notFoundHandler`, `errorHandler` |
| `src/config.ts` | Only reader of `process.env`; typed, deeply frozen `Config`; throws on bad input |
| `src/env-info.ts` | `envId`, `startedAt`, `recordRequest()`, `getRequestCount()` |
| `src/auth/types.ts` | `AuthMode`, `AuthContext`, `AuthEndpoints`, `CognitoSettings`, `VerifiedToken`, `JwtVerifier` (types only) |
| `src/auth/index.ts` | `authMiddleware(endpoints, verifier)`: endpoint name → `iam` / `jwt` / 401 |
| `src/auth/jwt-verifier.ts` | `createJwtVerifier(settings)` over `CognitoJwtVerifier` (`tokenUse: "access"`) |
| `src/routes/{health,whoami,stream}.ts` | `healthHandler`, `whoamiHandler`, `createStreamHandler(settings)` |
| `infra/artifacts.yaml` | Private SSE-S3 bucket for zips; exports `BucketName` |
| `infra/app.yaml` | Role, Cognito pool + client, WebFunction, revision, endpoints `iam`/`public`, outputs |
| `scripts/env.sh` | Sourced: `AWS_REGION` (default us-west-2), `STACK_NAME` (default `lwf`), `ARTIFACTS_STACK_NAME`, `ROOT`, `stack_output` |
| `scripts/build.sh` | esbuild CJS bundle → zip with `index.js` at root → sha256 |
| `scripts/deploy.sh`, `scripts/teardown.sh` | Build, upload `app-<sha256>.zip`, deploy both stacks / delete both stacks |
| `scripts/create-test-user.sh`, `scripts/smoke-jwt.sh`, `scripts/smoke-iam.ts` | Manual smoke-test tooling |
| `test/` | vitest + supertest; reads `infra/` and `scripts/` as files only |

Boundaries: `src/` never imports from `scripts/`, `infra/` or `test/`; `scripts/` never imports from `src/`. Runtime imports follow the SPEC section 4 table; `import type` of `src/auth/types.ts` and `src/config.ts` is allowed from any `src/` module.

## Constraints

Each line marked (kukulu.json: id) is enforced by `kukulu_verify` from `docs/kukulu.json`.

- No `process.env` outside `src/config.ts` in `src/`, `test/`, `scripts/`, `vitest.config.ts`, `eslint.config.js` (kukulu.json: `process-env-only-in-config`).
- No `lambda-web-endpoint-name` in `src/` outside `src/auth/index.ts` (kukulu.json: `endpoint-header-only-in-auth`).
- No auth bypass flag or `'none'`/`'off'`/`'skip'`/`'disabled'` mode string in `src/` (kukulu.json: `no-auth-bypass-mode`).
- No `aws-jwt-verify` import or mock outside `src/auth/jwt-verifier.ts` (kukulu.json: `jwt-lib-only-in-adapter`).
- No top-level `let`/`var` or top-level `Map`/`Set`/`Array` instance in `src/` outside `src/env-info.ts` (kukulu.json: `no-module-level-mutable-state`). Top-level object/array literals that get mutated: reviewer checks by reading.
- No `X-Forwarded-Host` and no `trust proxy` in `src/` (kukulu.json: `no-forwarded-host`).
- No `import.meta` in `src/` (kukulu.json: `no-import-meta-in-src`). No top-level `await` in `src/`: reviewer checks by reading, and esbuild's CJS build fails on it.
- Stream defaults (`5` ticks, `500` ms) only in `src/config.ts` (kukulu.json: `stream-tunables-only-in-config`).
- Listen default `127.0.0.1:3000` only in `src/config.ts` (kukulu.json: `listen-default-only-in-config`).
- No 12-digit numbers in `infra/` (kukulu.json: `infra-no-account-id`).
- No Region literals in `infra/` (kukulu.json: `infra-no-region-literal`).
- `TimeoutSeconds`, `MaxConcurrencyPerEnvironment`, `MaxEnvironments`, `RateLimit`, `ApplicationLogLevel` get values only from `infra/app.yaml` parameter defaults; Resources use `!Ref` (kukulu.json: `infra-tunables-are-parameters`).
- No AWS SDK import, SDK client or `aws` CLI call in `test/` or `scripts/build.sh` (kukulu.json: `tests-and-build-never-call-aws`).
- The deployed bundle is CommonJS (`--format=cjs`) and the zip holds only `index.js`: checked by `test/bundle.test.ts`.
- Relative imports use the `.ts` extension; type-only imports use `import type`; no `enum`, `namespace` or parameter properties (`erasableSyntaxOnly`): enforced by `tsc`.

## Task protocols

### Phase-end protocol

Used by P1-06, P2-05 and P3-04. Make no code changes. Run `git push -u origin HEAD`. Append a progress-log entry that starts `Manual check: NOT VERIFIED (human)` followed by the exact checklist from the task's Verification section. Never run the manual checks yourself (they need a browser, a terminal session left running, or AWS) and never mark them as passed. Later tasks never depend on a manual check.

### No-AWS rule

No task runs `npm run deploy`, `npm run teardown`, `npm run create-test-user`, `npm run smoke:iam`, `npm run smoke:jwt`, or any `aws` command. Tests that spawn a child process use `process.execPath` with a literal `env` object, or inherit the environment (no `env` option) when they run `bash`/`unzip`; they never mention `process.env`. Loopback HTTP to `127.0.0.1` in tests is allowed.

## Commit template

```
<ID>: <title>

Goal: <one sentence from the task>
Tests: <test files and test names added or changed>
Interpretation: <any reading of SPEC/PLAN you had to choose, or "none">
Measurement: <only for tuning tasks; none in this flight>
Manual check: <NOT VERIFIED (human) + list, for phase-end tasks; otherwise "n/a">
```

SPEC.md wins over PLAN.md, which wins over code comments.
