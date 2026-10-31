# Lambda Web Functions Hello World — Specification

Version: 0.2 Status: draft

The Kūkulu planner reads this file in full and derives the build plan from it. Any number that is a guess is marked `⚠️ ASSUMPTION` and has a config key.

## 1. Overview

A TypeScript Express 5 app deployed as **two AWS Lambda Web Functions defined with AWS SAM**, both built from the same source:

- **`iam`**: endpoint `AuthType: IamAuth`. Lambda checks SigV4 signatures before a request reaches Express, so the app does no auth.
- **`public`**: endpoint `AuthType: ApplicationManaged`. The app verifies Cognito access tokens itself with `aws-jwt-verify`.

Each function learns its auth mode from one env var, `AUTH_MODE`, set in the template. This is a learning reference, a hello world to build more complex things from. It is done when every section 7 command passes and a human has deployed the stack and smoke-tested both functions.

**This flight converts an existing build.** Flight `init-setup` (archived in `docs/flights/init-setup/`) built version 0.1: one Web Function with two endpoints in plain CloudFormation, with auth chosen per request from the `lambda-web-endpoint-name` header. This flight:

- replaces `infra/` and the hand-written build, deploy and teardown scripts with a SAM template and the SAM CLI
- splits the app into two functions
- removes all endpoint-header routing

Keep everything else in the existing code and tests that this spec doesn't change: config loading, env-info, the routes, the SIGTERM handling and the JWT verifier adapter with its offline tests. Delete what it replaces; don't leave dead code.

### Platform facts this spec relies on

Lambda Web Functions launched in October 2026. Each fact below comes from the AWS docs. Don't "correct" them from older knowledge of Lambda Event Functions, function URLs or API Gateway.

- **SAM resource.** One `AWS::Serverless::WebFunction` generates an `AWS::Lambda::WebFunction`, one `AWS::Lambda::WebFunctionRevision` (logical id `<Id>Revision`, with `UpdateReplacePolicy: Retain` set by SAM), and **exactly one** `AWS::Lambda::WebFunctionEndpoint` (logical id `<Id>Endpoint`). One function can't have two endpoints in SAM, which is why this design uses two functions.
  - Properties used here: `Runtime` (`nodejs24.x`), `AuthType` (`IamAuth` | `ApplicationManaged`, required), `CodeUri`, `EntryPoint`, `EndpointName` (default `prod`), `EndpointType` (default `HomeRegion`), `EnvironmentVariables` (map), `FunctionName`, `Timeout` (3–900, default 30), `MaxConcurrencyPerEnvironment`, `LoggingConfig` (map), `ScalingConfig` (map, e.g. `MaxEnvironments`), `ThrottleConfig` (map, e.g. `RateLimit`), `Tags`.
  - `AutoDeploymentMode` defaults to `LatestRevision`, which routes 100% of traffic to the revision each deployment creates.
  - If `ExecutionRoleArn` is omitted, SAM creates a role `<Id>Role` with `AWSLambdaBasicExecutionRole`.
  - `Ref` on the SAM resource returns the function ARN. The endpoint host name is `!GetAtt <Id>Endpoint.DomainName`, a host name without a scheme.
- **SAM CLI build.** With `CodeUri` a local directory and `Metadata: {BuildMethod: esbuild}`, `sam build` bundles `EntryPoint` with esbuild into `.aws-sam/build/<Id>/` and rewrites `EntryPoint` to the bundled file (`src/server.ts` → `server.js`). The build is always a zip for `x86_64`. Verified locally with SAM CLI 1.170.0:
  - `sam build` runs offline apart from npm.
  - It needs `esbuild` on `PATH`. This project keeps esbuild as a `devDependency` and runs `sam build` through npm scripts (section 7).
  - With `BuildProperties: {Format: cjs}` it produces a single CommonJS `server.js` and no `package.json`.
- **SAM CLI deploy.** For a Web Function with local code, `sam deploy` uploads to a **per-stack code bucket**, not the CLI's shared managed bucket. On first deploy it creates a stack `<stack-name>-<hash>-WebFunctionCode` whose bucket meets Lambda's requirements: versioning on, SSE-S3, public access blocked, HTTPS only, and a policy letting `lambda.amazonaws.com` call `s3:GetObject` and `s3:GetObjectVersion` for this account's revisions. This requires `--resolve-s3` or `resolve_s3 = true`. `sam delete` deletes the app stack, then empties and deletes the code bucket stack. `sam local` does not run Web Functions; run the server with Node instead.
- **Runtime contract.**
  - The server must listen on the `host:port` in the `AWS_LAMBDA_HTTP_ENDPOINT` env var **within 10 s** of start.
  - On scale-down Lambda sends `SIGTERM`, and the process has **1 s** before it's killed.
  - One environment serves many requests at once (default 64), so per-request state must never live in module scope.
  - Lambda does **not** check that the server came up, so an `Active` endpoint can still fail every request.
- **Auth types.**
  - On `IamAuth` endpoints Lambda validates the SigV4 signature, removes `Authorization`, and forwards **no caller identity**. Calls must be signed with service name `lambda` and the endpoint's Region, and **must include an `X-Amz-Content-SHA256` header**; without it Lambda returns 403.
  - On `ApplicationManaged` endpoints Lambda checks nothing and forwards `Authorization` as is.
  - `X-Forwarded-Host` is forwarded unvalidated, so never use it.
- **Logs.** The default log group is `/aws/lambda/web/<function-name>`.
- **Region.** The default is `us-west-2`.
- **Template linting gap (verified).** Neither `cfn-lint` 1.58.0 nor `sam validate --lint` (SAM CLI 1.170.0) reports an invalid `AuthType` on an `AWS::Serverless::WebFunction`. Template correctness for this resource type is enforced by `test/template.test.ts` (principle 7), not by the linters.

## 2. Goals and non-goals

- Goal: two SAM Web Functions, `iam` (`IamAuth`) and `public` (`ApplicationManaged`). Each has one `HomeRegion` endpoint that routes 100% of traffic to the latest revision.
- Goal: the auth mode comes only from `AUTH_MODE` (`iam` | `jwt`), required, and **fails closed**: `loadConfig()` throws at startup on a missing or unknown value, so a misconfigured function never serves a request.
- Goal: `/health`, `/whoami` and `/stream` routes as defined in section 6.
- Goal: make Web Function behavior visible. `/stream` shows native HTTP streaming. `/whoami` shows environment reuse (`envId`, `requestCount`). A `SIGTERM` handler covers shutdown.
- Goal: cost caps for experimenting. `MaxEnvironments` and `RateLimit` are template parameters applied to both functions.
- Goal: a `sam build` → `sam deploy` → smoke test → `sam delete` loop, plus a README a newcomer can follow.
- Non-goal: **the flight never calls AWS.** No task deploys, creates users or runs smoke tests, and no test touches AWS or creates an AWS SDK client. Those are manual checks for the human. (`sam build` downloading npm packages is allowed.)
- Non-goal: reading `lambda-web-endpoint-name` or any other `lambda-web-*` header for auth or routing.
- Non-goal: a Cognito identity pool, a custom authorizer, or any auth outside the Express app.
- Non-goal: canary or blue/green deploys (`AutoDeploymentMode: Disabled` + `RevisionWeights`). Tracked in issue #1.
- Non-goal: `MultiRegion` or `PerRegion` endpoints. Tracked in issue #2.
- Non-goal: VPC access (egress network connector). Tracked in issue #3.
- Non-goal: CloudFront, origin access control, WAF or a custom domain. Tracked in issue #4.
- Non-goal: KMS customer-managed keys, CI/CD pipelines, custom log groups or log retention, API Gateway, CDK, `sam sync`.
- Non-goal: a frontend or any HTML pages. Only JSON and SSE responses.

## 3. Engineering principles

Each of these is checkable by grep or by a named test. A violation is a review blocker.

1. `process.env` appears only in `src/config.ts`. (grep: `process\.env` outside that file.)
2. `AUTH_MODE` accepts exactly `iam` and `jwt`. There is no "auth disabled", `none`, `off`, `skip` or default mode anywhere. `test/config.test.ts` covers missing → throws, unknown value (including `none`, `IAM`, empty) → throws, `jwt` without Cognito values → throws. `test/auth.test.ts` covers:
   - `iam` mode: allowed without a token, with `subject = null`
   - `jwt` mode: no token → 401, invalid token → 401, valid token → 200 with `subject` set, and `/health` allowed without a token
3. `lambda-web-` appears nowhere in `src/` or `template.yaml` (grep, case-insensitive).
4. Only `src/auth/jwt-verifier.ts` imports `aws-jwt-verify`. The app gets its verifier through `createApp(config, deps)`, so tests pass a fake. The adapter's own tests use an injected JWKS and never fetch one (keep the existing offline tests).
5. The only module-level mutable state in `src/` is in `src/env-info.ts` (`requestCount`). Route handlers keep per-request data in local variables or `res.locals`.
6. In `template.yaml`: no 12-digit account IDs (grep `[0-9]{12}`) and no Region literals (grep `(us|eu|ap|sa|ca|me|af|il|mx)-[a-z]+-[0-9]`). Use `AWS::AccountId` and `AWS::Region`. (`samconfig.toml` may name the default Region.)
7. **Template invariant** (`test/template.test.ts`): parse `template.yaml` with the `yaml` npm package (`parse(text, { logLevel: 'error' })`, which returns short-form tags such as `!Ref X` as plain values). Assert that:
   - there are exactly two `AWS::Serverless::WebFunction` resources and no `AWS::Lambda::WebFunction*` resources;
   - the function with `AuthType: IamAuth` has `EnvironmentVariables.AUTH_MODE: iam` and no Cognito env vars;
   - the function with `AuthType: ApplicationManaged` has `EnvironmentVariables.AUTH_MODE: jwt` plus `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID`;
   - both use `Runtime: nodejs24.x`, `EntryPoint: src/server.ts`, `Metadata.BuildMethod: esbuild` with `BuildProperties.Format: cjs`, and take `ScalingConfig.MaxEnvironments` and `ThrottleConfig.RateLimit` from the parameters.
   This test is the main guard against shipping an open public endpoint, because the linters don't check these resources (section 1).
8. Every tunable listed in section 5 is a key in `src/config.ts` or a parameter in `template.yaml`, with the default given there. Literal values for these tunables appear nowhere else.
9. No section 7 command and no file under `test/` invokes the `aws` CLI, `sam deploy`, `sam delete`, or creates an AWS SDK client.

## 4. Architecture

A single npm package at the repo root. Source is ESM TypeScript with `strict` and `erasableSyntaxOnly: true`. The **deployed bundle is CommonJS**, produced by `sam build` (`Format: cjs`).

| Path | Responsibility | May import |
|---|---|---|
| `src/server.ts` | Entry point for both functions. `loadConfig()` → `createApp()` → listen on `AWS_LAMBDA_HTTP_ENDPOINT` (local default `127.0.0.1:3000`). On `SIGTERM`, close the server and exit within 1 s. Builds a JWT verifier only when `config.auth.mode === 'jwt'` | `src/*` |
| `src/app.ts` | `createApp(config, deps)`: Express app, `requestCount` increment, auth middleware on all routes, routes, 404 and 500 handlers | `src/config`, `src/auth`, `src/routes`, `src/env-info` |
| `src/config.ts` | The only reader of `process.env`. Returns a typed, frozen `Config` with `auth` as a discriminated union: `{mode: 'iam'}` or `{mode: 'jwt', cognito: {userPoolId, clientId}}`. Throws on missing or invalid values | — |
| `src/env-info.ts` | `envId` (UUID generated at module load), `startedAt` (ISO string), `requestCount` | — |
| `src/auth/index.ts` | `authMiddleware(auth, verifier?)`: `iam` → pass through, `subject = null`. `jwt` → `/health` passes; everything else needs a valid Bearer access token, `subject = sub`. Sets `res.locals.auth = {authMode, subject}` | `src/auth/types`, `src/config` (types) |
| `src/auth/jwt-verifier.ts` | Unchanged adapter: `createJwtVerifier(settings, jwks?)` builds a `CognitoJwtVerifier` (`tokenUse: "access"`, `clientId`) behind a `JwtVerifier` interface | `aws-jwt-verify`, `src/auth/types` |
| `src/routes/{health,whoami,stream}.ts` | One route each | `src/env-info`, `src/config` (types) |
| `template.yaml` | SAM template at the repo root: Cognito user pool + app client, `IamFunction` and `PublicFunction` (`AWS::Serverless::WebFunction`), parameters, outputs | — |
| `samconfig.toml` | `version = 0.1`. `[default.global.parameters]`: `stack_name = "lwf"`, `region = "us-west-2"`, so `sam deploy` and `sam delete` both pick them up. `[default.deploy.parameters]`: `resolve_s3 = true`, `capabilities = "CAPABILITY_IAM"`, `confirm_changeset = false` | — |
| `scripts/create-test-user.sh` | `admin-create-user` + `admin-set-user-password --permanent`, then `initiate-auth USER_PASSWORD_AUTH`. Prints an access token. Reads stack outputs from the `lwf` stack | — |
| `scripts/smoke-iam.ts` | Run with `node`. Signs GET `/health`, `/whoami` and `/stream` against `IamEndpointUrl` with `@smithy/signature-v4` + `@aws-crypto/sha256-js` + the default credential chain, **including `X-Amz-Content-SHA256`**. Also checks that an unsigned GET returns 403. Exits non-zero on any mismatch | — |
| `scripts/smoke-jwt.sh` | Against `PublicEndpointUrl`: `/health` → 200, `/whoami` without a token → 401, with a token → 200 and `subject` set, `/stream` with a token → at least one event, numbered from 1 | — |
| `test/` | vitest + supertest app tests, `auth.test.ts`, `config.test.ts`, `jwt-verifier.test.ts`, `template.test.ts`, `bundle.test.ts`, README test | `src/*`, `template.yaml` (read as a file) |

**Delete:**
- `infra/` (both templates)
- `scripts/build.sh`, `scripts/deploy.sh`, `scripts/teardown.sh`
- `test/infra.test.ts`
- any `scripts/env.sh` helper the remaining scripts no longer need

The smoke and test-user scripts may keep a small shared helper for reading stack outputs.

Boundaries: `src/` never imports from `scripts/` or `test/`. `scripts/` never imports from `src/`.

`template.yaml` details:
- `Transform: AWS::Serverless-2016-10-31`.
- `IamFunction`:
  - `FunctionName: !Sub ${AWS::StackName}-iam`, `EndpointName: iam`, `AuthType: IamAuth`
  - `EnvironmentVariables: {AUTH_MODE: iam}`
- `PublicFunction`:
  - `FunctionName: !Sub ${AWS::StackName}-public`, `EndpointName: public`, `AuthType: ApplicationManaged`
  - `EnvironmentVariables: {AUTH_MODE: jwt, COGNITO_USER_POOL_ID: !Ref UserPool, COGNITO_CLIENT_ID: !Ref UserPoolClient}`
- Both functions:
  - `Runtime: nodejs24.x`, `CodeUri: ./`, `EntryPoint: src/server.ts`
  - `Timeout`, `MaxConcurrencyPerEnvironment`, `LoggingConfig.ApplicationLogLevel`, `ScalingConfig.MaxEnvironments` and `ThrottleConfig.RateLimit`, each from parameters
  - `Metadata: {BuildMethod: esbuild, BuildProperties: {Format: cjs, Target: node24, EntryPoints: [src/server.ts]}}`. Verified with SAM CLI 1.170.0: `npm run build` succeeds with exactly these keys and writes `.aws-sam/build/<Id>/server.js`.
  - No `ExecutionRoleArn`; let SAM generate each role.
  - Don't put Web Function properties in `Globals` unless `sam build` accepts them there.
- Cognito: a user pool with email as username, and an app client with **no secret** and `ExplicitAuthFlows: [ALLOW_USER_PASSWORD_AUTH, ALLOW_REFRESH_TOKEN_AUTH]`.
- Outputs:
  - `IamEndpointUrl` and `PublicEndpointUrl` (`!Sub "https://${IamFunctionEndpoint.DomainName}"` and the `PublicFunctionEndpoint` equivalent)
  - `IamFunctionName` and `PublicFunctionName` (the `!Sub` names, not `Ref`, which returns an ARN)
  - `UserPoolId`, `UserPoolClientId`
- `.gitignore` adds `.aws-sam/`, **and `eslint.config.js` adds `.aws-sam/` to its `ignores`**. Verified: after one `npm run build`, `npm run lint` reports 1,280 errors from the minified bundle in `.aws-sam/build/` unless it's ignored. `samconfig.toml` is committed.

Shared wiring, which the plan should keep in serial tasks: `src/app.ts`, `src/config.ts`, `package.json`, `template.yaml`.

## 5. Data and configuration

App config (`src/config.ts`). Env var → key → default:

| Env var | Key | Default | Notes |
|---|---|---|---|
| `AWS_LAMBDA_HTTP_ENDPOINT` | `listen.host`, `listen.port` | `127.0.0.1:3000` | Set by Lambda. The default is for local dev only |
| `AUTH_MODE` | `auth.mode` | — (required) | `iam` or `jwt`. Anything else throws |
| `COGNITO_USER_POOL_ID` | `auth.cognito.userPoolId` | — (required when `jwt`) | Ignored when `iam` |
| `COGNITO_CLIENT_ID` | `auth.cognito.clientId` | — (required when `jwt`) | Ignored when `iam` |
| `STREAM_TICKS` | `stream.ticks` | `5` | ⚠️ ASSUMPTION |
| `STREAM_INTERVAL_MS` | `stream.intervalMs` | `500` | ⚠️ ASSUMPTION |

`AUTH_ENDPOINT_IAM` and `AUTH_ENDPOINT_JWT` are removed.

Local dev:
- `npm run dev` runs the `iam` mode on `127.0.0.1:3000`.
- `npm run dev:public` runs the `jwt` mode on `127.0.0.1:3001`, with `COGNITO_USER_POOL_ID=us-west-2_000000000` and `COGNITO_CLIENT_ID=local`. The pool ID must be well-formed, because `CognitoJwtVerifier.create()` throws on a bad pool ID at startup. The `public` server then 401s every token, which is expected locally.
- Both bundle with esbuild (CJS) and run the bundle with Node. Keep the existing `dist/package.json` `{"type":"commonjs"}` trick or an equivalent, since the root package is `"type": "module"`.

Template parameters (`template.yaml`):

| Parameter | Default | Notes |
|---|---|---|
| `TimeoutSeconds` | `30` | 3–900 |
| `MaxConcurrencyPerEnvironment` | `64` | 1–128 |
| `MaxEnvironments` | `2` | ⚠️ ASSUMPTION. Cost cap for experimenting, per function. Minimum 2 |
| `RateLimit` | `100` | ⚠️ ASSUMPTION. Requests/s per endpoint. Allowed: 100–1000 in steps of 100 |
| `ApplicationLogLevel` | `INFO` | `TRACE`…`FATAL` |

`CodeBucket` and `CodeKey` are removed; the SAM CLI handles code upload. No tuning tasks are needed for the ⚠️ values in this flight.

## 6. Interfaces

HTTP, the same routes on both functions. All JSON responses use `Content-Type: application/json`.

Auth middleware (runs before every route, including 404):
- `iam` mode → `authMode: "iam"`, `subject: null`, continue. Lambda has already rejected unsigned requests.
- `jwt` mode → `authMode: "jwt"`. Routes other than `/health` require `Authorization: Bearer <Cognito access token>`. A missing or invalid token gets 401 `{"error":"unauthorized"}` with `WWW-Authenticate: Bearer`. On success, `subject` = the token's `sub`.

Routes:
- `GET /health` → 200 `{"status":"ok"}`.
- `GET /whoami` → 200 `{"authMode": "iam"|"jwt", "subject": string|null, "envId": string, "startedAt": string, "requestCount": number}`. The `endpoint` field is removed.
- `GET /stream` → 200, `Content-Type: text/event-stream`, `Cache-Control: no-cache`. Writes `stream.ticks` events `data: {"tick":n}\n\n` (n = 1..ticks), one every `stream.intervalMs`, using `res.write`, then ends. If the client disconnects, it stops early and clears its timer.
- Any other path → 404 `{"error":"not_found"}`.
- Unhandled error → 500 `{"error":"internal"}`. Stack traces are logged, never sent in the response.

Process:
- `SIGTERM` → `server.close()` and `process.exit(0)` within 1 s (a hard `setTimeout(...).unref()` fallback).
- Startup logs one JSON line `{"msg":"listening", host, port, envId, authMode}`.

## 7. Commands

The repo already has `package.json`, so verify commands that exist today apply from the first task. Give `npm run build` (now `sam build`) and the template lint `from:` the task that creates `template.yaml`.

- install (`parallel.setup`): `npm ci`
- typecheck: `npm run typecheck` (`tsc --noEmit`)
- lint: `npm run lint` (`eslint . --max-warnings 0`)
- test: `npm test` (`vitest run`, no watch mode)
- build: `npm run build` (`sam build`). It must exit non-zero on failure. **esbuild stays a `devDependency`; nothing is installed globally.** Verified with SAM CLI 1.170.0: a bare `sam build` fails with "Cannot find esbuild" even with esbuild in `devDependencies`, but `npm run build` succeeds, because npm puts `node_modules/.bin` on `PATH` for scripts. Every `sam build` invocation therefore goes through an npm script (`build`, `deploy`, and the bundle test calling `npm run build`), and the README tells users to run the npm scripts, not `sam build` directly.
- template lint: `cfn-lint template.yaml`
- targeted test (`mutation.targeted`): `npx vitest run {filter}`

`test/bundle.test.ts` must prove the artifact that will actually be deployed works. Run `npm run build` (or reuse a fresh `.aws-sam/build`), then **copy `.aws-sam/build/IamFunction/server.js` into a fresh temp directory** and start it there with Node, `AUTH_MODE=iam` and `AWS_LAMBDA_HTTP_ENDPOINT` set to a free port. The copy is required. Run in place, Node finds the repo's root `package.json` (`"type": "module"`) and loads the CJS bundle as ESM, which crashes with `require is not defined` (verified). A temp directory with no `package.json` mirrors the Lambda zip root, where the same file starts fine (verified: `/health` 200, `SIGTERM` exit 0). Assert:
- `/health` returns 200
- `SIGTERM` exits 0 within 1 s
- the build directory holds the single bundled `server.js` and no `package.json`

Manual only. These are never in verify, because they call AWS:
- `npm run deploy` (`sam build && sam deploy`)
- `npm run create-test-user -- <email>`
- `npm run smoke:iam`
- `npm run smoke:jwt -- <token>`
- `npm run teardown` (`sam delete --no-prompts`)

## 8. Phases

### Phase 1: App
`AUTH_MODE` config with the discriminated `auth` union, simplified auth middleware, removal of every `lambda-web-endpoint-name` read and the endpoint-name config, `/whoami` without `endpoint`, `src/server.ts` building the verifier only in `jwt` mode, `dev` and `dev:public` scripts, and updated unit tests from section 3.
**Manual check:** `npm run dev`, then `curl localhost:3000/whoami` (200, `authMode: iam`) and `curl -N localhost:3000/stream` (ticks arrive one at a time). Run `npm run dev:public`, then `curl localhost:3001/whoami` (401 with `WWW-Authenticate: Bearer`) and `curl localhost:3001/health` (200). Starting with `AUTH_MODE=none` fails at startup.

### Phase 2: SAM template and build
`template.yaml`, `samconfig.toml`, `.gitignore` update, `package.json` scripts (`build`, `deploy`, `teardown`), deletion of `infra/` and the old build, deploy and teardown scripts, `test/template.test.ts`, and the reworked `test/bundle.test.ts`.
**Manual check:** `npm run deploy` succeeds in us-west-2. The Lambda console shows two functions, `lwf-iam` (one `Active` endpoint `iam`, IAM auth) and `lwf-public` (one `Active` endpoint `public`), each with one revision.

### Phase 3: Smoke tests and docs
Update `scripts/create-test-user.sh`, `scripts/smoke-iam.ts` and `scripts/smoke-jwt.sh` for the new outputs and stack. Rewrite `README.md`:
- what this is, and why there are two functions
- prerequisites: Node 24, AWS CLI v2, SAM CLI ≥ 1.170, cfn-lint, credentials
- deploy, test and teardown
- cost notes
- links to issues #1–#4

Update `CLAUDE.md`'s module map, including the `createJwtVerifier(settings, jwks?)` signature and the `Jwks` type.
**Manual check:**
- Both smoke scripts pass.
- Calling `/whoami` several times on each function shows `requestCount` rising across calls that return the same `envId`; a different `envId` with a lower count means another environment served the call, which is fine. The two functions have different `envId`s, since they don't share environments.
- Logs appear in `/aws/lambda/web/lwf-iam` and `/aws/lambda/web/lwf-public`.
- `npm run teardown` removes the app stack and its code bucket stack.

## 9. Open questions

None blocking.

- Decided (reverses 0.1): two functions, not one function with two endpoints. SAM generates one endpoint per Web Function, and splitting removes the endpoint-header routing, its pairing test and the related constraints. The cost is two sets of environments instead of one shared set.
- Decided: one source tree and one entry point for both functions, with the mode from `AUTH_MODE`. Misconfiguration is guarded by fail-closed config parsing and the template invariant test.
- Decided: keep Cognito + `aws-jwt-verify` in-app for the public function. Web Functions have no built-in JWT or Cognito authorizer; `ApplicationManaged` leaves auth to the app by design.
- Decided: on the `iam` function `subject` is always `null`. Lambda forwards no caller identity to the app.
- Found in 0.1: `infra/artifacts.yaml` created the code bucket **without versioning and without a bucket policy for Lambda**, both of which the AWS docs require for Web Function code. The 0.1 stack would likely have failed at revision creation. The SAM CLI's per-stack code bucket meets both requirements, so this flight removes the problem instead of patching it.
- Future experiments are tracked as GitHub issues #1 (canary), #2 (MultiRegion), #3 (VPC connector) and #4 (CloudFront + OAC, custom domain). Don't build any of them in this flight.

## Appendix: mockups and fixtures

None. Section 6 is the complete contract.
