# Lambda Web Functions Hello World — Specification

Version: 0.1 Status: draft

The Kūkulu planner reads this file in full and derives the build plan from it. Any number that is a guess is marked `⚠️ ASSUMPTION` and has a config key.

## 1. Overview

A TypeScript Express 5 app deployed as **one AWS Lambda Web Function with two endpoints**, defined in plain CloudFormation. The `iam` endpoint uses `IamAuth` (Lambda checks SigV4 signatures). The `public` endpoint uses `ApplicationManaged`, and the app verifies Cognito JWTs itself. This is a learning reference, a hello world to build more complex things from. It is done when every section 7 command passes and a human has deployed the stack and smoke-tested both endpoints.

### Platform facts this spec relies on

Lambda Web Functions launched in October 2026. Each fact below comes from the AWS docs. Don't "correct" them from older knowledge of Lambda Event Functions, function URLs or API Gateway.

- **Resources.** `AWS::Lambda::WebFunction` (properties: `FunctionName` (required), `Tags`. `Ref` returns the ARN) is a container for revisions and endpoints.
  `AWS::Lambda::WebFunctionRevision` is an immutable code + config snapshot: `FunctionName`, `BuildConfig` (`CodeConfig.S3Object {Bucket, Key}`, `RuntimeConfig.Runtime: nodejs24.x`), and `ServiceConfig` (`ExecutionRoleArn` (required), `EnvironmentVariables`, `TimeoutSeconds`, `MaxConcurrencyPerEnvironment`, `TelemetryConfig.LoggingConfig {ApplicationLogLevel, SystemLogLevel}`). **Every revision property is create-only**, so any change replaces the revision. `GetAtt`: `RevisionId`, `RevisionArn`.
  `AWS::Lambda::WebFunctionEndpoint` exposes the function over HTTPS: `FunctionName`, `EndpointName`, `EndpointType` (`HomeRegion`), `AuthType` (`IamAuth` | `ApplicationManaged`), `RevisionWeights: [{RevisionId, Weight}]`, `ScalingConfig.MaxEnvironments` (≥ 2), `ThrottleConfig.RateLimit` (100–1000 in steps of 100). `GetAtt DomainName` is a host name without a scheme.
- **Runtime contract.** The server must listen on the `host:port` in the `AWS_LAMBDA_HTTP_ENDPOINT` env var **within 10 s** of start. The runtime loads `index.js` at the zip root. On scale-down Lambda sends `SIGTERM`, and the process has **1 s** before it's killed. One environment serves many requests at once (default 64), so per-request state must never live in module scope. Lambda does **not** check that the server came up, so an `Active` endpoint can still fail every request.
- **Request headers.** Lambda adds `lambda-web-request-id` and `lambda-web-endpoint-name` (the name of the endpoint that received the request). It **strips any client-sent header beginning with `lambda-web-`**, so the endpoint name can't be forged. On `IamAuth` endpoints it validates the signature, removes `Authorization`, and forwards **no caller identity**. On `ApplicationManaged` endpoints `Authorization` is forwarded as is. `X-Forwarded-Host` is forwarded unvalidated, so never use it.
- **IamAuth calls** must be SigV4-signed with service name `lambda` and the endpoint's Region, and **must include an `X-Amz-Content-SHA256` header** (the payload hash, or `UNSIGNED-PAYLOAD`). Without it Lambda returns 403.
- **Execution role.** Trust principal `lambda.amazonaws.com`. Attach managed policy `arn:aws:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole`. The default log group is `/aws/lambda/web/<function-name>`.
- **Region.** The default is `us-west-2`, where all three resource types are available. `cfn-lint` ≥ 1.58 knows these resource types.

## 2. Goals and non-goals

- Goal: one Web Function, one revision, and two `HomeRegion` endpoints (`iam` and `public`), each routing 100% of traffic to that revision.
- Goal: per-request auth chosen from `lambda-web-endpoint-name`. **It fails closed**: a missing or unknown endpoint name returns 401.
- Goal: `/health`, `/whoami` and `/stream` routes as defined in section 6.
- Goal: make Web Function behavior visible. `/stream` shows native HTTP streaming. `/whoami` shows environment reuse (`envId`, `requestCount`). A `SIGTERM` handler covers shutdown.
- Goal: cost caps for experimenting. `MaxEnvironments` and `RateLimit` are stack parameters applied to both endpoints.
- Goal: a scripted build → upload → deploy → smoke test → teardown loop, plus a README a newcomer can follow.
- Non-goal: **the flight never calls AWS.** No task deploys, creates users or runs smoke tests, and no test touches the network or an AWS SDK client. Those are manual checks for the human.
- Non-goal: canary or blue/green deploys (two `RevisionWeights`). Tracked in issue #1.
- Non-goal: `MultiRegion` or `PerRegion` endpoints. Tracked in issue #2.
- Non-goal: VPC access (egress network connector). Tracked in issue #3.
- Non-goal: CloudFront, origin access control, WAF or a custom domain. Tracked in issue #4.
- Non-goal: KMS customer-managed keys, CI/CD pipelines, custom log groups or log retention, API Gateway, SAM, CDK.
- Non-goal: a frontend or any HTML pages. Only JSON and SSE responses.

## 3. Engineering principles

Each of these is checkable by grep or by a named test. A violation is a review blocker.

1. `process.env` appears only in `src/config.ts`. (grep: `process\.env` outside that file.)
2. `lambda-web-endpoint-name` is read only in `src/auth/index.ts`. A missing header or an unknown endpoint name gets **401**. There is no "auth disabled", `none`, `off` or `skip` mode anywhere. `test/auth.test.ts` covers: no header → 401, unknown name → 401, `iam` → allowed without a token, `public` with no or invalid token → 401, `public` with a valid token → 200.
3. Only `src/auth/jwt-verifier.ts` imports `aws-jwt-verify`. The app gets its verifier through `createApp(config, deps)`, so tests pass a fake and never fetch a JWKS.
4. The only module-level mutable state in `src/` is in `src/env-info.ts` (`requestCount`). Route handlers keep per-request data in local variables or `res.locals`.
5. Under `infra/`: no 12-digit account IDs (grep `[0-9]{12}`) and no Region literals (grep `(us|eu|ap|sa|ca|me|af|il|mx)-[a-z]+-[0-9]`). Use `AWS::AccountId` and `AWS::Region`.
6. No section 7 command and no file under `test/` invokes the `aws` CLI or creates an AWS SDK client.
7. **Pairing invariant** (`test/infra.test.ts`): parse `infra/app.yaml` with the `yaml` npm package (`parse(text, { logLevel: 'error' })`). Verified: it returns short-form tags such as `!Ref X` as plain values (`"X"`), and `logLevel: 'error'` silences its unresolved-tag warnings. Assert that:
   - the revision's `AUTH_ENDPOINT_IAM` value equals the `EndpointName` of an endpoint resource with `AuthType: IamAuth`;
   - the revision's `AUTH_ENDPOINT_JWT` value equals the `EndpointName` of an endpoint resource with `AuthType: ApplicationManaged`;
   - there are exactly two endpoint resources, one `WebFunction` and one `WebFunctionRevision`.
8. Every tunable listed in section 5 is a key in `src/config.ts` or a parameter in `infra/app.yaml`, with the default given there. Literal values for these tunables appear nowhere else.

## 4. Architecture

A single npm package at the repo root. Source is ESM TypeScript with `strict` and `erasableSyntaxOnly: true` (so `tsc` rejects `enum`, `namespace` and parameter properties, which Node's native type stripping can't run in `scripts/*.ts`). The **deployed bundle is CommonJS** (see `scripts/build.sh`).

| Path | Responsibility | May import |
|---|---|---|
| `src/server.ts` | Entry point. `loadConfig()` → `createApp()` → listen on `AWS_LAMBDA_HTTP_ENDPOINT` (local default `127.0.0.1:3000`). On `SIGTERM`, close the server and exit within 1 s. | `src/*` |
| `src/app.ts` | `createApp(config, deps)`: Express app, `requestCount` increment, auth middleware on all routes, routes, 404 and 500 handlers | `src/config`, `src/auth`, `src/routes`, `src/env-info` |
| `src/config.ts` | The only reader of `process.env`. Returns a typed, frozen `Config`. Throws on missing required values | — |
| `src/env-info.ts` | `envId` (UUID generated at module load), `startedAt` (ISO string), `requestCount` | — |
| `src/auth/index.ts` | `authMiddleware(config, verifier)`: endpoint name → `iam` (pass through, `subject = null`) / `jwt` (verify Bearer access token, `subject = sub`) / else 401. Sets `res.locals.auth = {endpoint, authMode, subject}` | `src/auth/types` |
| `src/auth/jwt-verifier.ts` | Adapter that builds a `CognitoJwtVerifier` (`tokenUse: "access"`, `clientId`) behind a `JwtVerifier` interface | `aws-jwt-verify` |
| `src/routes/{health,whoami,stream}.ts` | One route each | `src/env-info`, `src/config` (types) |
| `infra/artifacts.yaml` | Private S3 bucket for deployment zips (SSE-S3, block all public access, no versioning). Exports the bucket name | — |
| `infra/app.yaml` | Execution role, Cognito user pool + app client, `WebFunction`, `WebFunctionRevision`, endpoints `iam` and `public`, outputs | — |
| `scripts/build.sh` | esbuild bundles `src/server.ts` → `dist/index.js` with `--bundle --platform=node --target=node24 --format=cjs`. **It must be CJS**: the zip contains only `index.js` and no `package.json`, so Lambda would not load an ESM bundle. `npm run dev` still works locally either way, so nothing before the phase 3 smoke test would catch this. Zips it so `index.js` is at the zip root. Prints the zip's sha256 | — |
| `scripts/deploy.sh` | `AWS_REGION` defaults to `us-west-2`. Deploys `infra/artifacts.yaml`, uploads the zip as `app-<sha256>.zip`, then deploys `infra/app.yaml` with `CodeBucket`/`CodeKey`. Prints the stack outputs | — |
| `scripts/create-test-user.sh` | `admin-create-user` + `admin-set-user-password --permanent`, then `initiate-auth USER_PASSWORD_AUTH`. Prints an access token | — |
| `scripts/smoke-iam.ts` | Run with `node` (Node 24 strips types natively). Signs GET `/health`, `/whoami` and `/stream` against `IamEndpointUrl` with `@smithy/signature-v4` + `@aws-crypto/sha256-js` + the default credential chain, **including `X-Amz-Content-SHA256`**. Also checks that an unsigned GET returns 403. Exits non-zero on any mismatch | — |
| `scripts/smoke-jwt.sh` | Against `PublicEndpointUrl`: `/health` → 200, `/whoami` without a token → 401, with a token → 200 and `subject` set, `/stream` with a token → N events | — |
| `scripts/teardown.sh` | Deletes the app stack, empties the bucket, deletes the artifacts stack | — |
| `test/` | vitest + supertest app tests, `auth.test.ts`, `config.test.ts`, `infra.test.ts` | `src/*`, `infra/*` (read as files) |

Boundaries: `src/` never imports from `scripts/`, `infra/` or `test/`. `scripts/` never imports from `src/`.

`infra/app.yaml` details:
- Function name `!Sub ${AWS::StackName}-hello`. The revision and both endpoints use `FunctionName: !Ref HelloFunction`.
- The revision has `UpdateReplacePolicy: Retain`, the same choice SAM makes. When a code change replaces the revision, an endpoint may still route to the old one, and Lambda won't delete a revision that's serving traffic. Deleting the function deletes all its revisions.
- Both endpoints: `EndpointType: HomeRegion`, `RevisionWeights: [{RevisionId: !GetAtt HelloRevision.RevisionId, Weight: 100}]`, plus `ScalingConfig`/`ThrottleConfig` from parameters.
- Cognito: a user pool with email as username, and an app client with **no secret** and `ExplicitAuthFlows: [ALLOW_USER_PASSWORD_AUTH, ALLOW_REFRESH_TOKEN_AUTH]`.
- Outputs: `FunctionName`, `IamEndpointUrl` and `PublicEndpointUrl` (`!Sub "https://${Endpoint.DomainName}"`), `UserPoolId`, `UserPoolClientId`.

Shared wiring, which the plan should keep in serial tasks: `src/app.ts` (route registration), `package.json` (scripts and deps), `infra/app.yaml`.

## 5. Data and configuration

App config (`src/config.ts`). Env var → key → default:

| Env var | Key | Default | Notes |
|---|---|---|---|
| `AWS_LAMBDA_HTTP_ENDPOINT` | `listen.host`, `listen.port` | `127.0.0.1:3000` | Set by Lambda. The default is for local dev only |
| `AUTH_ENDPOINT_IAM` | `auth.iamEndpointName` | — (required) | `iam` in the template |
| `AUTH_ENDPOINT_JWT` | `auth.jwtEndpointName` | — (required) | `public` in the template. Must differ from the IAM name |
| `COGNITO_USER_POOL_ID` | `auth.cognito.userPoolId` | — (required) | |
| `COGNITO_CLIENT_ID` | `auth.cognito.clientId` | — (required) | |
| `STREAM_TICKS` | `stream.ticks` | `5` | ⚠️ ASSUMPTION |
| `STREAM_INTERVAL_MS` | `stream.intervalMs` | `500` | ⚠️ ASSUMPTION |

`loadConfig()` throws if a required value is missing, if the two endpoint names are equal, or if a number fails to parse (`test/config.test.ts`). For local dev, `npm run dev` sets `AUTH_ENDPOINT_IAM=iam`, `AUTH_ENDPOINT_JWT=public`, `COGNITO_USER_POOL_ID=us-west-2_000000000` and `COGNITO_CLIENT_ID=local`. The pool ID must be well-formed (`<region>_<id>`), because `CognitoJwtVerifier.create()` throws on a bad pool ID at startup (verified). The `public` path then 401s every token, which is expected locally.

Stack parameters (`infra/app.yaml`):

| Parameter | Default | Notes |
|---|---|---|
| `CodeBucket` | — | From the artifacts stack |
| `CodeKey` | — | `app-<sha256>.zip`. A new key means a new revision |
| `TimeoutSeconds` | `30` | 3–900 |
| `MaxConcurrencyPerEnvironment` | `64` | 1–128 |
| `MaxEnvironments` | `2` | ⚠️ ASSUMPTION. Cost cap for experimenting. Minimum 2 |
| `RateLimit` | `100` | ⚠️ ASSUMPTION. Requests/s per endpoint. Allowed: 100–1000 in steps of 100 |
| `ApplicationLogLevel` | `INFO` | `TRACE`…`FATAL` |

No tuning tasks are needed for the ⚠️ values in this flight. They only matter once deployed, and the human adjusts them.

## 6. Interfaces

HTTP, identical on both endpoints. All JSON responses use `Content-Type: application/json`.

Auth middleware (runs before every route, including 404):
- `lambda-web-endpoint-name` = `config.auth.iamEndpointName` → `authMode: "iam"`, `subject: null`, continue.
- `lambda-web-endpoint-name` = `config.auth.jwtEndpointName` → `authMode: "jwt"`. Routes other than `/health` require `Authorization: Bearer <Cognito access token>`. A missing or invalid token gets 401 `{"error":"unauthorized"}` with `WWW-Authenticate: Bearer`. On success, `subject` = the token's `sub`.
- Missing or any other value → 401 `{"error":"unauthorized"}`.

Routes:
- `GET /health` → 200 `{"status":"ok"}`. Needs a known endpoint name but no token.
- `GET /whoami` → 200 `{"endpoint": string, "authMode": "iam"|"jwt", "subject": string|null, "envId": string, "startedAt": string, "requestCount": number}`.
- `GET /stream` → 200, `Content-Type: text/event-stream`, `Cache-Control: no-cache`. Writes `stream.ticks` events `data: {"tick":n}\n\n` (n = 1..ticks), one every `stream.intervalMs`, using `res.write`, then ends. If the client disconnects, it stops early and clears its timer.
- Any other path → 404 `{"error":"not_found"}`.
- Unhandled error → 500 `{"error":"internal"}`. Stack traces are logged, never sent in the response.

Process:
- `SIGTERM` → `server.close()` and `process.exit(0)` within 1 s (a hard `setTimeout(...).unref()` fallback).
- Startup logs one JSON line `{"msg":"listening", host, port, envId}`.

## 7. Commands

The repo starts empty, so the planner gives **every verify command `from:` the phase 1 scaffold task** (the task that creates `package.json`). `cfn-lint` gets `from:` the first task that creates `infra/*.yaml`.

- install (`parallel.setup`): `npm ci`
- typecheck: `npm run typecheck` (`tsc --noEmit`)
- lint: `npm run lint` (`eslint . --max-warnings 0`)
- test: `npm test` (`vitest run`, no watch mode)
- build: `npm run build` (`scripts/build.sh`; it must exit non-zero if esbuild or zip fails, so use `set -euo pipefail`)
- template lint: `cfn-lint infra/*.yaml`
- targeted test (`mutation.targeted`): `npx vitest run {filter}`

Manual only. These are never in verify, because they call AWS:
- `npm run dev`: bundles with esbuild to `dist/index.js` (no zip), then runs `node dist/index.js` with the local env values from section 5 set in the npm script
- `npm run deploy` · `npm run create-test-user -- <email>` · `npm run smoke:iam` · `npm run smoke:jwt -- <token>` · `npm run teardown`

## 8. Phases

### Phase 1: App and tests
Scaffold (package.json, tsconfig, eslint config, vitest, .gitignore for `node_modules`, `dist`, `*.zip`), config, env-info, auth middleware + JWT verifier adapter, three routes, server with SIGTERM handling, and the unit tests from section 3.
**Manual check:** `npm run dev`, then `curl -H 'lambda-web-endpoint-name: iam' localhost:3000/whoami` (200), the same with `public` and no token (401), no header at all (401), and `curl -N -H 'lambda-web-endpoint-name: iam' localhost:3000/stream` (ticks arrive one at a time).

### Phase 2: Infrastructure and build
`infra/artifacts.yaml`, `infra/app.yaml`, `scripts/build.sh`, `scripts/deploy.sh`, `scripts/teardown.sh`, and `test/infra.test.ts`.
**Manual check:** `npm run deploy` succeeds in us-west-2. In the Lambda console, the function shows one revision and two `Active` endpoints, `iam` (IAM auth) and `public`.

### Phase 3: Smoke tests and docs
`scripts/create-test-user.sh`, `scripts/smoke-iam.ts`, `scripts/smoke-jwt.sh`, and `README.md` (what this is, prerequisites: Node 24, AWS CLI v2, cfn-lint, credentials; deploy, test, teardown; cost notes; links to issues #1–#4).
**Manual check:** both smoke scripts pass. Calling `/whoami` several times on each endpoint shows a shared `envId` and a rising `requestCount` (same environments behind both endpoints). Logs appear in `/aws/lambda/web/<function-name>`. `npm run teardown` removes both stacks.

## 9. Open questions

None blocking.

- Decided: one function with two endpoints, not two functions. `lambda-web-endpoint-name` can't be forged, so one revision can serve both auth modes safely as long as it fails closed.
- Decided: on the `iam` path `subject` is always `null`. The docs confirm Lambda forwards no caller identity to the app.
- Future experiments are tracked as GitHub issues #1 (canary), #2 (MultiRegion), #3 (VPC connector) and #4 (CloudFront + OAC, custom domain). Don't build any of them in this flight.

## Appendix: mockups and fixtures

None. Section 6 is the complete contract.
