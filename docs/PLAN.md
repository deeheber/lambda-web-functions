# Lambda Web Functions Hello World build plan

Derived from docs/SPEC.md v0.2 on 2026-10-31. SPEC.md wins over this file.

This flight converts the 0.1 build (archived in `docs/flights/init-setup/`) to two SAM Web Functions. Every task edits existing code; read the current file before changing it, keep what SPEC does not change, and delete what it replaces.

## Decisions

- Phases → SPEC section 8 defines three phases; task ids follow them (`P1-xx` App, `P2-xx` SAM template and build, `P3-xx` Smoke tests and docs). There is no phase 0, because the package already exists.
- Parallel streams → none; the plan is fully serial and `docs/kukulu.json` has no `parallel` block. SPEC section 4 names `src/app.ts`, `src/config.ts`, `package.json` and `template.yaml` as shared wiring, almost every task touches one of them, and the plan has only nine tasks. If streams are ever added, the setup command is `npm ci`.
- Base branch → `docs/kukulu.json` `baseBranch` is `flight/sam`, the branch this plan was written on. The operator starts every flight from a working branch so all changes reach `main` through a PR.
- ⚠️ ASSUMPTION tuning → no tuning tasks. SPEC section 5 says so explicitly. Each ⚠️ value keeps exactly one home: `STREAM_TICKS`/`STREAM_INTERVAL_MS` defaults (`5`, `500`) in `src/config.ts`, `MaxEnvironments` (`2`) and `RateLimit` (`100`) as `template.yaml` parameter defaults. `docs/kukulu.json` constraints enforce it.
- Where the `auth` union type lives → `src/config.ts` exports `AuthConfig = { readonly mode: 'iam' } | { readonly mode: 'jwt'; readonly cognito: { readonly userPoolId: string; readonly clientId: string } }` and `Config['auth']` is `AuthConfig`. `src/auth/index.ts` takes it with `import type { AuthConfig } from '../config.ts'` (SPEC section 4 allows `src/config` types there). `AuthMode`, `AuthContext`, `CognitoSettings`, `VerifiedToken`, `JwtVerifier` and `Jwks` stay in `src/auth/types.ts`; `AuthEndpoints` is deleted.
- Missing verifier in `jwt` mode → `authMiddleware(auth, verifier?)` throws `Error` synchronously when `auth.mode === 'jwt'` and `verifier` is `undefined`, so `createApp` throws and the process never serves. Fails closed instead of 401-ing at request time.
- `createApp(config, deps)` → `deps` stays a required parameter of type `AppDeps = { readonly verifier?: JwtVerifier }`. The `iam` server passes `{}`.
- `AUTH_MODE` parsing → exact, case-sensitive match against `iam` and `jwt`, no trimming. An empty string counts as unset and throws `AUTH_MODE is required`; any other value throws an error naming `AUTH_MODE` and the bad value.
- Cognito vars in `iam` mode → not read, not validated, not present in the returned config. `config.auth` is exactly `{ mode: 'iam' }`.
- `/whoami` body → keys in this order: `authMode`, `subject`, `envId`, `startedAt`, `requestCount`. `endpoint` is removed.
- `jwt` `/health` exemption → `req.path === '/health'` exactly; `subject` is `null` there. Every `jwt` 401 carries `WWW-Authenticate: Bearer`; `iam` mode never returns 401.
- `requestCount` semantics → unchanged from 0.1: incremented once per request (rejected ones included) before auth, stored in `res.locals.requestCount`, which `/whoami` reports.
- `src/server.ts` → builds the verifier only when `config.auth.mode === 'jwt'`; the listening line becomes `{"msg":"listening", host, port, envId, authMode}`; `SHUTDOWN_DEADLINE_MS = 500` and the SIGTERM handling stay as they are.
- Local dev scripts → `dev` and `dev:public` each run the same esbuild CJS bundle to `dist/index.js` and write `dist/package.json` `{"type":"commonjs"}`, as 0.1's `dev` did. `dev` sets only `AUTH_MODE=iam`, so its `127.0.0.1:3000` comes from the `src/config.ts` default. `dev:public` sets `AUTH_MODE=jwt AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:3001 COGNITO_USER_POOL_ID=us-west-2_000000000 COGNITO_CLIENT_ID=local`.
- `EndpointType` → set explicitly to `HomeRegion` on both functions, so the template states SPEC section 2's goal and `test/template.test.ts` can assert it. `AutoDeploymentMode` is omitted (its default `LatestRevision` is what SPEC wants) and no `RevisionWeights` appear.
- `npm run build` switches to `sam build` in P2-01, the task that creates `template.yaml`, together with the `.aws-sam/` entries in `.gitignore` and `eslint.config.js`, so the `from: P2-01` verify command exercises the real SAM build from the first task that has a template. `cfn-lint template.yaml` runs as `extraVerify` for any task touching `template.yaml`, also `from: P2-01`.
- `test/bundle.test.ts` → always runs `npm run build` in `beforeAll` (no reuse of a possibly stale `.aws-sam/`), then copies each function's `server.js` into a fresh `mkdtemp` directory before running it (SPEC section 7).
- Deletions → `infra/`, `scripts/build.sh`, `scripts/deploy.sh`, `scripts/teardown.sh` and `test/infra.test.ts` are deleted together in P2-02, when `deploy`/`teardown` move to the SAM CLI. Until then the 0.1 files keep passing their tests.
- Shared script helper → keep `scripts/env.sh` as the "small shared helper for reading stack outputs" SPEC section 4 allows. P2-02 drops `ARTIFACTS_STACK_NAME`; P3-01 makes it read `stack_name` and `region` from `samconfig.toml`'s `[default.global.parameters]`, so the scripts always target the stack and Region `sam deploy` used, and a shell-wide `AWS_REGION` cannot point them elsewhere.
- `AUTH_MODE=none` fails at startup → besides the Phase 1 manual check, `test/server.test.ts` proves it offline.
- README defaults → README's configuration tables may repeat the section 5 defaults as documentation; principle 8's "one home" applies to code, scripts, `package.json`, `samconfig.toml` and `template.yaml`, which the constraints scan.
- `CLAUDE.md` → its shared sections described 0.1 (endpoint-header routing, `infra/`, the pairing invariant) and would mislead every task, so the planner rewrote Principles, Commands, Module map, Constraints and Task protocols for 0.2 and added a `## Flight sam-two-functions notes` section. The module map already shows the target state, including `createJwtVerifier(settings, jwks?)` and `Jwks`; P3-02 confirms it against the finished code and fixes any drift, which satisfies SPEC section 8's Phase 3 item.

## Conventions

- One task, one commit, title `<ID>: <title>`, body per the commit template in CLAUDE.md.
- Verify after every task: `npm run typecheck`, `npm run lint`, `npm test`; from P2-01 also `npm run build`. `cfn-lint template.yaml` runs as `extraVerify` on `template.yaml` from P2-01.
- No task calls AWS, runs `npm run deploy`/`teardown`/`create-test-user`/`smoke:*`, or starts `npm run dev`/`dev:public` (they never exit). Every AWS or long-running check is a manual check in a phase-end task.
- Phase-end tasks (P1-03, P2-03, P3-03) follow the phase-end protocol in CLAUDE.md.

## Phase 1 — App

### P1-01: Switch auth to AUTH_MODE across config, middleware, app and server

**Goal:** Replace endpoint-header auth with the `AUTH_MODE` discriminated union in `src/config.ts`, simplify the auth middleware, drop `endpoint` from `/whoami`, build the JWT verifier only in `jwt` mode, and update every test that loads config or starts the server.
**Files touched:** `src/config.ts`, `src/auth/types.ts`, `src/auth/index.ts`, `src/app.ts`, `src/routes/whoami.ts`, `src/server.ts`, `test/config.test.ts`, `test/auth.test.ts`, `test/app.test.ts`, `test/stream.test.ts`, `test/server.test.ts`, `test/bundle.test.ts`
**Design constraints:**
- SPEC sections 1 (Runtime contract, Auth types), 2 (fail-closed goal, non-goal on `lambda-web-*` headers), 3 (principles 1, 2, 3, 4, 5, 8), 4 (rows for `src/server.ts`, `src/app.ts`, `src/config.ts`, `src/auth/index.ts`), 5 (App config), 6 (Interfaces).
- This task must be atomic: changing `Config` breaks every caller, so typecheck and tests only pass when all twelve files change together. Non-test code stays well under 400 lines.
- `src/config.ts` (the only file allowed to contain `process.env`, constraint `process-env-only-in-config`):
  - Export `type Env` (unchanged), `type AuthConfig = { readonly mode: 'iam' } | { readonly mode: 'jwt'; readonly cognito: { readonly userPoolId: string; readonly clientId: string } }`, and `interface Config { readonly listen: { readonly host: string; readonly port: number }; readonly auth: AuthConfig; readonly stream: { readonly ticks: number; readonly intervalMs: number } }`. `loadConfig(env: Env = process.env): Config` keeps its signature.
  - Remove `AUTH_ENDPOINT_IAM`, `AUTH_ENDPOINT_JWT`, `iamEndpointName`, `jwtEndpointName` and the "must differ" check entirely.
  - `AUTH_MODE` is required (empty string = unset → throw `AUTH_MODE is required`). It must equal `iam` or `jwt` exactly (case-sensitive, no trimming); anything else throws an `Error` whose message contains `AUTH_MODE` and the received value. There is no default mode and no `none`/`off`/`skip`/`disabled` value (constraint `no-auth-bypass-mode`).
  - `iam` → `auth` is `{ mode: 'iam' }`; `COGNITO_*` are not read. `jwt` → `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID` are both required (throw naming the missing var); `auth` is `{ mode: 'jwt', cognito: { userPoolId, clientId } }`.
  - Keep the listen and stream parsing, the `DEFAULT_LISTEN`, `DEFAULT_STREAM_TICKS`, `DEFAULT_STREAM_INTERVAL_MS` constants and the `⚠️ ASSUMPTION` comment exactly as they are (constraints `stream-tunables-only-in-config`, `listen-default-only-in-config`).
  - Freeze every level: the config, `listen`, `auth`, `auth.cognito` (jwt only) and `stream`.
- `src/auth/types.ts`: `AuthContext` becomes `{ readonly authMode: AuthMode; readonly subject: string | null }` (no `endpoint`). Delete `AuthEndpoints`. Keep `AuthMode`, `CognitoSettings`, `VerifiedToken`, `JwtVerifier`, `Jwks` unchanged. Types only.
- `src/auth/index.ts`: `export function authMiddleware(auth: AuthConfig, verifier?: JwtVerifier): RequestHandler`, importing `AuthConfig` with `import type` from `../config.ts` and the rest from `./types.ts`. It imports nothing else at runtime.
  - When `auth.mode === 'jwt'` and `verifier` is `undefined`, throw an `Error` immediately (at construction, not per request).
  - `iam` → set `res.locals.auth = { authMode: 'iam', subject: null }` and call `next()`. Never call the verifier.
  - `jwt` → if `req.path === '/health'`, set `{ authMode: 'jwt', subject: null }` and `next()`. Otherwise require `Authorization` matching `/^Bearer\s+(\S+)$/i`; missing or malformed → 401 `{"error":"unauthorized"}` with `WWW-Authenticate: Bearer`, without calling the verifier; `verifier.verify(token)` rejecting → the same 401; success → `{ authMode: 'jwt', subject: sub }` and `next()`. Call `next()` outside the `try` so downstream errors are not turned into 401.
  - Read no request header except `Authorization`. The string `lambda-web-` must not appear anywhere in `src/`, comments included (constraint `no-lambda-web-prefix`).
- `src/app.ts`: `export interface AppDeps { readonly verifier?: JwtVerifier }`; `createApp(config: Config, deps: AppDeps): Express` passes `config.auth` and `deps.verifier` to `authMiddleware`. Everything else (request-count middleware before auth, routes, `notFoundHandler`, `errorHandler`, `x-powered-by` disabled) stays.
- `src/routes/whoami.ts`: respond with `{ authMode, subject, envId, startedAt, requestCount }` in that key order; no `endpoint`.
- `src/server.ts`: `loadConfig()` → `const verifier = config.auth.mode === 'jwt' ? createJwtVerifier(config.auth.cognito) : undefined` → `createApp(config, { verifier })` → listen. The listening line is `JSON.stringify({ msg: 'listening', host, port, envId, authMode: config.auth.mode })`. Leave `SHUTDOWN_DEADLINE_MS` and the SIGTERM handler unchanged. No top-level `await`, no `import.meta` (constraint `no-import-meta-in-src`).
- Do not touch `src/env-info.ts`, `src/routes/health.ts`, `src/routes/stream.ts` or `src/auth/jwt-verifier.ts` (constraint `jwt-lib-only-in-adapter`; `no-module-level-mutable-state`).
- Tests pass plain env objects to `loadConfig`; child processes use `process.execPath` with a literal `env` object (No-AWS rule in CLAUDE.md). No test sends a `lambda-web-endpoint-name` header except the one auth test below that proves it is ignored.
- `test/bundle.test.ts` still builds with `scripts/build.sh` in this task; change only its child `env` to `{ AWS_LAMBDA_HTTP_ENDPOINT: '127.0.0.1:0', AUTH_MODE: 'iam' }` and drop the endpoint header from its `/health` request. P2-02 rewrites the file.
**Acceptance tests:**
- `test/config.test.ts`, `describe('loadConfig')`:
  - `applies defaults when optional values are unset` (`{ AUTH_MODE: 'iam' }` → listen `127.0.0.1`/`3000`, stream `5`/`500`, auth `{ mode: 'iam' }`)
  - `parses iam mode and ignores Cognito values` (auth toEqual `{ mode: 'iam' }` even with both `COGNITO_*` set)
  - `parses jwt mode with Cognito values`
  - `throws when AUTH_MODE is missing or empty`
  - `throws on an unknown AUTH_MODE: %s` (`it.each` over `'none'`, `'off'`, `'skip'`, `'disabled'`, `'IAM'`, `'JWT'`, `' iam'`, `'both'`; each throws with `AUTH_MODE` in the message)
  - `throws in jwt mode when %s is missing` (`it.each` over `COGNITO_USER_POOL_ID`, `COGNITO_CLIENT_ID`; also the empty-string case)
  - kept from 0.1, with the new base env: `treats an empty string as unset`, `throws when STREAM_TICKS is not a number`, `throws when STREAM_TICKS is zero`, `throws when STREAM_INTERVAL_MS is not a number`, `parses host and port from AWS_LAMBDA_HTTP_ENDPOINT`, `throws when AWS_LAMBDA_HTTP_ENDPOINT has no valid port`
  - `returns a deeply frozen object` (iam: config, listen, auth, stream; jwt: also `auth.cognito`)
  - delete `throws when the two endpoint names are equal`
- `test/auth.test.ts`, `describe('authMiddleware')`:
  - `iam mode allows a request without a token and sets subject null` (body `{ authMode: 'iam', subject: null }`)
  - `iam mode does not call the verifier`
  - `iam mode works without a verifier`
  - `jwt mode returns 401 with WWW-Authenticate when the token is missing`
  - `jwt mode returns 401 on an invalid token`
  - `jwt mode returns 401 on a non-Bearer Authorization header` (verifier not called)
  - `jwt mode returns 200 with a valid token and sets subject to sub` (body `{ authMode: 'jwt', subject: 'user-123' }`)
  - `jwt mode allows /health without a token`
  - `jwt mode ignores a lambda-web-endpoint-name header` (header `iam`, no token → 401)
  - `throws at construction in jwt mode without a verifier`
  - `does not turn downstream errors into 401`
- `test/app.test.ts`, `describe('createApp')`: `GET /health returns 200 status ok in iam mode`, `GET /health returns 200 in jwt mode without a token`, `GET /whoami in iam mode returns the documented shape with subject null` (keys exactly `['authMode', 'subject', 'envId', 'startedAt', 'requestCount']`), `GET /whoami in jwt mode with a valid token returns authMode jwt and the subject`, `GET /whoami in jwt mode without a token returns 401`, `requestCount rises by one per request`, `unknown path returns 404 not_found in iam mode`, `unknown path in jwt mode without a token returns 401`, `JSON responses use Content-Type application/json`, `throws in jwt mode without a verifier`; `describe('errorHandler')` unchanged.
- `test/stream.test.ts`, `describe('GET /stream')`: the three existing tests in `iam` mode without any endpoint header, and `requires a token in jwt mode` (replaces `requires a token on the public endpoint`).
- `test/server.test.ts`, `describe('server entry point')`: `logs one JSON listening line with host, port, envId and authMode` (`authMode: 'iam'`), `logs authMode jwt when started in jwt mode` (pool `us-west-2_000000000`, client `local`), `serves /health on the logged port`, `starts in iam mode even with a malformed COGNITO_USER_POOL_ID` (proves the verifier is not built), `exits non-zero in jwt mode with a malformed COGNITO_USER_POOL_ID` (proves it is built at startup), `exits 0 within 1 s of SIGTERM`, `exits 0 within 1 s of SIGTERM while a /stream response is open`, `exits non-zero when AUTH_MODE is missing`, `exits non-zero when AUTH_MODE is none`, `exits non-zero in jwt mode without Cognito values`.
- `test/bundle.test.ts`: the existing four tests pass with the new env.
**Out of scope:** `package.json` (the `dev` script is fixed in P1-02 and may be broken until then), `README.md`, `scripts/`, `infra/`, any template, `src/auth/jwt-verifier.ts`, `src/env-info.ts`, `src/routes/health.ts`, `src/routes/stream.ts`.
**Verification:** `npm run typecheck && npm run lint && npm test`. `grep -rni 'lambda-web-' src/` prints nothing. `grep -rn 'AUTH_ENDPOINT\|EndpointName\|AuthEndpoints' src/ test/ --include=*.ts | grep -v infra.test.ts` prints nothing.
**Depends on:** none

### P1-02: Add dev and dev:public scripts

**Goal:** Make `npm run dev` run the `iam` mode on `127.0.0.1:3000` and add `npm run dev:public` running the `jwt` mode on `127.0.0.1:3001`, both from the esbuild CJS bundle, and document them.
**Files touched:** `package.json`, `README.md`, `test/scripts.test.ts`
**Design constraints:**
- SPEC sections 3 (principle 8), 5 (Local dev), 7 (Commands).
- `dev`: `esbuild src/server.ts --bundle --platform=node --target=node24 --format=cjs --outfile=dist/index.js && printf '{"type":"commonjs"}' > dist/package.json && AUTH_MODE=iam node dist/index.js`. It sets no `AWS_LAMBDA_HTTP_ENDPOINT` and no `COGNITO_*`; the `127.0.0.1:3000` default comes from `src/config.ts` (constraint `dev-script-uses-listen-default`: `package.json` never contains `3000`).
- `dev:public`: the same esbuild and `printf` steps, then `AUTH_MODE=jwt AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:3001 COGNITO_USER_POOL_ID=us-west-2_000000000 COGNITO_CLIENT_ID=local node dist/index.js`. The pool id must stay well formed, because `CognitoJwtVerifier.create()` throws at startup on a bad one.
- Neither script sets `STREAM_TICKS` or `STREAM_INTERVAL_MS` (constraint `stream-tunables-only-in-config`). No `AUTH_ENDPOINT_*` anywhere in `package.json` or `README.md` after this task (constraint `no-endpoint-name-config` becomes active now).
- Leave every other `package.json` script unchanged.
- `README.md` (minimal; P3-02 rewrites the whole file): replace the "Local development" section with `npm run dev` and `npm run dev:public` and these curls, none sending a `lambda-web-*` header: `curl -i localhost:3000/whoami` (200, `authMode: iam`), `curl -N localhost:3000/stream` (ticks one at a time), `curl -i localhost:3001/whoami` (401, `WWW-Authenticate: Bearer`), `curl -i localhost:3001/health` (200); note that the local `public` server rejects every token. In the "Configuration reference" app-config table, replace the `AUTH_ENDPOINT_IAM` and `AUTH_ENDPOINT_JWT` rows with one `AUTH_MODE` row (`auth.mode`, required, `iam` or `jwt`, anything else fails at startup) and mark the two `COGNITO_*` rows "required when `jwt`". `test/readme.test.ts` requires every npm script name to appear as `npm run <name>`.
**Acceptance tests:** `test/scripts.test.ts`, inside `describe('scripts')`:
- `dev bundles src/server.ts as CJS and runs it in iam mode` (contains `--format=cjs`, `dist/package.json`, `AUTH_MODE=iam`, `node dist/index.js`; does not contain `AWS_LAMBDA_HTTP_ENDPOINT` or `COGNITO_`)
- `dev:public runs jwt mode on 127.0.0.1:3001 with a well-formed local pool id` (contains `--format=cjs`, `AUTH_MODE=jwt`, `AWS_LAMBDA_HTTP_ENDPOINT=127.0.0.1:3001`, `COGNITO_USER_POOL_ID=us-west-2_000000000`, `COGNITO_CLIENT_ID=local`)
- `test/readme.test.ts` `documents every npm script` passes unchanged.
**Out of scope:** running `npm run dev` or `npm run dev:public` (they never exit; that is the Phase 1 manual check); `build`, `deploy`, `teardown`, `smoke:*` scripts; the rest of the README.
**Verification:** `npm run typecheck && npm run lint && npm test`. Bundle once without running it: `npx esbuild src/server.ts --bundle --platform=node --target=node24 --format=cjs --outfile=dist/index.js` exits 0.
**Depends on:** P1-01

### P1-03: Phase 1 end: push and list manual checks

**Goal:** Push the branch and record the Phase 1 manual checks as NOT VERIFIED for a human.
**Files touched:** `docs/PROGRESS.md` (log entry only)
**Design constraints:** Follow the phase-end protocol in CLAUDE.md. SPEC section 8, Phase 1. Make no code changes.
**Acceptance tests:** none (no code). The existing suite still passes.
**Out of scope:** running the manual checks, any code or test change.
**Verification:** `npm run typecheck && npm run lint && npm test`; `git push -u origin HEAD` succeeds. Manual check (human, NOT VERIFIED):
- `npm run dev`, then `curl localhost:3000/whoami` → 200 with `authMode: iam`, `subject: null`.
- `curl -N localhost:3000/stream` → ticks arrive one at a time.
- `npm run dev:public`, then `curl -i localhost:3001/whoami` → 401 with `WWW-Authenticate: Bearer`; `curl -i localhost:3001/health` → 200.
- Starting with `AUTH_MODE=none` fails at startup.
**Depends on:** P1-02

## Phase 2 — SAM template and build

### P2-01: Add the SAM template, samconfig and sam build

**Goal:** Create `template.yaml` with Cognito and the two Web Functions, `samconfig.toml`, switch `npm run build` to `sam build`, ignore `.aws-sam/`, and add `test/template.test.ts` as the template invariant.
**Files touched:** `template.yaml`, `samconfig.toml`, `.gitignore`, `eslint.config.js`, `package.json`, `test/template.test.ts`, `test/scripts.test.ts`
**Design constraints:**
- SPEC sections 1 (Platform facts: SAM resource, SAM CLI build, Template linting gap), 2, 3 (principles 2, 3, 6, 7, 8, 9), 4 (`template.yaml` details, `samconfig.toml` row, `.gitignore`/`eslint.config.js` note), 5 (Template parameters), 7 (Commands).
- `template.yaml` at the repo root. Exactly this structure (verified with cfn-lint 1.58.0 during planning):
  - `AWSTemplateFormatVersion: "2010-09-09"`, `Transform: AWS::Serverless-2016-10-31`, a one-line `Description`. No `Globals` section.
  - Parameters: `TimeoutSeconds` (Number, Default 30, MinValue 3, MaxValue 900), `MaxConcurrencyPerEnvironment` (Number, Default 64, MinValue 1, MaxValue 128), `MaxEnvironments` (Number, Default 2, MinValue 2, Description mentions ASSUMPTION / cost cap per function), `RateLimit` (Number, Default 100, AllowedValues `[100, 200, 300, 400, 500, 600, 700, 800, 900, 1000]`, Description mentions ASSUMPTION / requests per second per endpoint), `ApplicationLogLevel` (String, Default INFO, AllowedValues `[TRACE, DEBUG, INFO, WARN, ERROR, FATAL]`). No `CodeBucket`/`CodeKey`.
  - `UserPool` (`AWS::Cognito::UserPool`): `UsernameAttributes: [email]`, `AutoVerifiedAttributes: [email]`.
  - `UserPoolClient` (`AWS::Cognito::UserPoolClient`): `UserPoolId: !Ref UserPool`, `GenerateSecret: false`, `ExplicitAuthFlows: [ALLOW_USER_PASSWORD_AUTH, ALLOW_REFRESH_TOKEN_AUTH]`.
  - `IamFunction` (`AWS::Serverless::WebFunction`): `FunctionName: !Sub ${AWS::StackName}-iam`, `EndpointName: iam`, `EndpointType: HomeRegion`, `AuthType: IamAuth`, `EnvironmentVariables: {AUTH_MODE: iam}` and nothing else.
  - `PublicFunction` (`AWS::Serverless::WebFunction`): `FunctionName: !Sub ${AWS::StackName}-public`, `EndpointName: public`, `EndpointType: HomeRegion`, `AuthType: ApplicationManaged`, `EnvironmentVariables: {AUTH_MODE: jwt, COGNITO_USER_POOL_ID: !Ref UserPool, COGNITO_CLIENT_ID: !Ref UserPoolClient}`.
  - Both functions, written out on each (not in `Globals`): `Runtime: nodejs24.x`, `CodeUri: ./`, `EntryPoint: src/server.ts`, `Timeout: !Ref TimeoutSeconds`, `MaxConcurrencyPerEnvironment: !Ref MaxConcurrencyPerEnvironment`, `LoggingConfig: {ApplicationLogLevel: !Ref ApplicationLogLevel}`, `ScalingConfig: {MaxEnvironments: !Ref MaxEnvironments}`, `ThrottleConfig: {RateLimit: !Ref RateLimit}`, and resource-level `Metadata: {BuildMethod: esbuild, BuildProperties: {Format: cjs, Target: node24, EntryPoints: [src/server.ts]}}`. No `ExecutionRoleArn`, no `AutoDeploymentMode`, no `RevisionWeights`.
  - Outputs: `IamEndpointUrl` = `!Sub "https://${IamFunctionEndpoint.DomainName}"`, `PublicEndpointUrl` = `!Sub "https://${PublicFunctionEndpoint.DomainName}"`, `IamFunctionName` = `!Sub ${AWS::StackName}-iam`, `PublicFunctionName` = `!Sub ${AWS::StackName}-public`, `UserPoolId` = `!Ref UserPool`, `UserPoolClientId` = `!Ref UserPoolClient`.
  - No 12-digit numbers, no Region literals, no `lambda-web-` text, every `AUTH_MODE` is literally `iam` or `jwt`, and the five tunables appear only as parameter `Default`s with `!Ref` in Resources (constraints `template-no-account-id`, `template-no-region-literal`, `no-lambda-web-prefix`, `template-auth-mode-iam-or-jwt`, `template-tunables-are-parameters`; the last one also scans `samconfig.toml`, `package.json` and `scripts/`, so write no `MaxEnvironments=…`-style text there).
- `samconfig.toml` (committed): `version = 0.1`; `[default.global.parameters]` with `stack_name = "lwf"` and `region = "us-west-2"`; `[default.deploy.parameters]` with `resolve_s3 = true`, `capabilities = "CAPABILITY_IAM"`, `confirm_changeset = false`. No `parameter_overrides`.
- `.gitignore`: add `.aws-sam/`. `eslint.config.js`: add `'.aws-sam/'` to the `ignores` array. Both are required in this task: the `npm run build` verify runs right after it, and without the ignore `npm run lint` reports ~1,280 errors from the minified bundle.
- `package.json`: `"build": "sam build"`. Nothing else changes; `esbuild` stays in `devDependencies` and nothing is installed globally (constraint `no-global-install`). Never run bare `sam build` from a shell: it fails with "Cannot find esbuild" because only npm puts `node_modules/.bin` on `PATH`. Always `npm run build`.
- `test/template.test.ts` reads `template.yaml` as a file and parses it with `parse(text, { logLevel: 'error' })` from the `yaml` package. That turns short-form tags into plain scalars: `!Ref MaxEnvironments` → `'MaxEnvironments'`, `!Ref UserPool` → `'UserPool'`, `!Sub ${AWS::StackName}-iam` → `'${AWS::StackName}-iam'`, `!Sub "https://${IamFunctionEndpoint.DomainName}"` → `'https://${IamFunctionEndpoint.DomainName}'`. Type the template as `Record<string, unknown>`-based interfaces (ESLint forbids `any`); find functions by `Type`, never by logical id alone, so the invariant holds whatever the ids are. The test never calls AWS (constraint `tests-never-call-aws`).
**Acceptance tests:**
- `test/template.test.ts`, `describe('template.yaml')`:
  - `uses the SAM transform and no Globals section`
  - `has exactly two AWS::Serverless::WebFunction resources and no AWS::Lambda::WebFunction* resources`
  - `the IamAuth function sets AUTH_MODE iam and no Cognito env vars` (exactly one function has `AuthType: IamAuth`; its `EnvironmentVariables` toEqual `{ AUTH_MODE: 'iam' }`; `EndpointName` `iam`; `FunctionName` `'${AWS::StackName}-iam'`)
  - `the ApplicationManaged function sets AUTH_MODE jwt and both Cognito env vars` (toEqual `{ AUTH_MODE: 'jwt', COGNITO_USER_POOL_ID: 'UserPool', COGNITO_CLIENT_ID: 'UserPoolClient' }`; `EndpointName` `public`; `FunctionName` `'${AWS::StackName}-public'`)
  - `every function's AUTH_MODE matches its AuthType` (loop over all WebFunctions: `IamAuth` ⇔ `iam`, `ApplicationManaged` ⇔ `jwt`, no other `AuthType`)
  - `both functions use nodejs24.x, src/server.ts and the esbuild CJS build` (`Runtime`, `CodeUri: './'`, `EntryPoint`, `Metadata` toEqual `{ BuildMethod: 'esbuild', BuildProperties: { Format: 'cjs', Target: 'node24', EntryPoints: ['src/server.ts'] } }`)
  - `both functions take their tunables from the parameters` (`Timeout: 'TimeoutSeconds'`, `MaxConcurrencyPerEnvironment: 'MaxConcurrencyPerEnvironment'`, `LoggingConfig` toEqual `{ ApplicationLogLevel: 'ApplicationLogLevel' }`, `ScalingConfig` toEqual `{ MaxEnvironments: 'MaxEnvironments' }`, `ThrottleConfig` toEqual `{ RateLimit: 'RateLimit' }`)
  - `both functions have a HomeRegion endpoint, the latest revision and a SAM-generated role` (`EndpointType: 'HomeRegion'`; no `ExecutionRoleArn`, `AutoDeploymentMode` or `RevisionWeights`)
  - `parameters have the SPEC defaults and ranges` (as section 5; no `CodeBucket`/`CodeKey`)
  - `the user pool uses email as username and the client has no secret` (`UsernameAttributes` `['email']`, `GenerateSecret` `false`, `ExplicitAuthFlows` toEqual `['ALLOW_USER_PASSWORD_AUTH', 'ALLOW_REFRESH_TOKEN_AUTH']`)
  - `outputs the endpoint URLs, function names and Cognito ids` (exact keys and the parsed values above)
  - `contains no account IDs, Region literals or lambda-web- text` (raw-text regexes `/[0-9]{12}/`, `/(us|eu|ap|sa|ca|me|af|il|mx)-[a-z]+-[0-9]/`, `/lambda-web-/i`)
- `test/template.test.ts`, `describe('samconfig.toml')`: `sets the stack name, Region and deploy options` (text contains `version = 0.1`, `stack_name = "lwf"`, `region = "us-west-2"`, `resolve_s3 = true`, `capabilities = "CAPABILITY_IAM"`, `confirm_changeset = false`).
- `test/scripts.test.ts`: `build runs sam build` (`pkg.scripts.build === 'sam build'`), `esbuild is a devDependency, not a dependency`.
**Out of scope:** `deploy`/`teardown` scripts, deleting `infra/` or the 0.1 scripts, `test/bundle.test.ts` (it still runs `scripts/build.sh` and passes), README, any `sam deploy`/`sam delete`.
**Verification:** `npm run typecheck && npm run lint && npm test && npm run build && cfn-lint template.yaml`. After the build: `ls .aws-sam/build/IamFunction .aws-sam/build/PublicFunction` each show `server.js`; `npm run lint` still passes; `git status --short` shows no `.aws-sam/` entry.
**Depends on:** none

### P2-02: Wire deploy and teardown to the SAM CLI and delete the 0.1 build

**Goal:** Point `npm run deploy` and `npm run teardown` at the SAM CLI, delete `infra/`, the hand-written build/deploy/teardown scripts and `test/infra.test.ts`, and rework `test/bundle.test.ts` to prove the `sam build` artifact runs.
**Files touched:** `package.json`, `infra/` (delete), `scripts/build.sh` (delete), `scripts/deploy.sh` (delete), `scripts/teardown.sh` (delete), `test/infra.test.ts` (delete), `scripts/env.sh`, `.gitignore`, `test/bundle.test.ts`, `test/scripts.test.ts`
**Design constraints:**
- SPEC sections 1 (SAM CLI build, SAM CLI deploy, Runtime contract), 3 (principle 9), 4 (Delete list), 7 (build, bundle test, manual-only commands).
- `package.json`: `"deploy": "sam build && sam deploy"`, `"teardown": "sam delete --no-prompts"`. `build` stays `sam build`. Do not run either script (No-AWS rule in CLAUDE.md). No section 7 command (`typecheck`, `lint`, `test`, `build`) may contain `aws`, `sam deploy`, `sam delete` or `sam sync` (constraint `section7-commands-never-call-aws`).
- Delete `infra/artifacts.yaml`, `infra/app.yaml` (and the `infra/` directory), `scripts/build.sh`, `scripts/deploy.sh`, `scripts/teardown.sh`, `test/infra.test.ts`. Leave no reference to them in `package.json`, `scripts/` or `test/`.
- `scripts/env.sh`: delete the `ARTIFACTS_STACK_NAME` line (its only user, `teardown.sh`, is gone) and update the header comment to say it is sourced by `create-test-user.sh`, `smoke-jwt.sh` and the `smoke:iam` npm script. P3-01 reworks the rest of this file.
- `.gitignore`: remove `*.zip` (nothing produces zips any more); keep `dist/` (the dev scripts write there) and `.aws-sam/`.
- `test/bundle.test.ts`, rewritten as `describe('npm run build (sam build)')`:
  - `beforeAll` (timeout 300_000 ms): `spawnSync('npm', ['run', 'build'], { cwd: root, encoding: 'utf8' })`, inheriting the environment (no `env` option, never `process.env`). Never spawn `sam` directly (constraint `tests-never-call-aws`).
  - For each function, copy `.aws-sam/build/<Id>/server.js` into a fresh `mkdtempSync(join(tmpdir(), 'lwf-bundle-'))` directory and run it there with `spawn(process.execPath, [copy], { env: { … literal … } })`. Run in place it crashes (`require is not defined`), because Node finds the root `package.json` with `"type": "module"`. Remove temp dirs in `afterAll`; kill leftover children in `afterEach`.
  - Read the port from the JSON `listening` line (start with `AWS_LAMBDA_HTTP_ENDPOINT: '127.0.0.1:0'`).
- `test/scripts.test.ts`: replace `package.json wires deploy and teardown to the scripts` with the SAM wiring test below; the "set -euo pipefail" test keeps excluding `env.sh`; everything else stays.
**Acceptance tests:**
- `test/bundle.test.ts`, `describe('npm run build (sam build)')`:
  - `exits 0`
  - `writes only server.js to each function's build directory` (`readdirSync('.aws-sam/build/IamFunction')` and `PublicFunction` each equal `['server.js']`; no `package.json`)
  - `emits a CommonJS bundle` (no line of `server.js` starts with `import ` or `export `)
  - `the IamFunction bundle, copied to a temp dir, serves /health and exits 0 within 1 s of SIGTERM` (env `{ AWS_LAMBDA_HTTP_ENDPOINT: '127.0.0.1:0', AUTH_MODE: 'iam' }`)
  - `the PublicFunction bundle, copied to a temp dir, starts in jwt mode and returns 401 on /whoami without a token` (env adds `AUTH_MODE: 'jwt'`, `COGNITO_USER_POOL_ID: 'us-west-2_000000000'`, `COGNITO_CLIENT_ID: 'local'`; `/health` 200, `/whoami` 401)
- `test/scripts.test.ts`: `package.json wires build, deploy and teardown to the SAM CLI` (exact strings above), `the 0.1 infra and build scripts are gone` (`existsSync` false for `infra`, `scripts/build.sh`, `scripts/deploy.sh`, `scripts/teardown.sh`), `env.sh no longer defines ARTIFACTS_STACK_NAME`.
**Out of scope:** `scripts/create-test-user.sh`, `scripts/smoke-jwt.sh`, `scripts/smoke-iam.ts`, the `smoke:*` and `create-test-user` npm scripts, README, running `npm run deploy` or `npm run teardown`.
**Verification:** `npm run typecheck && npm run lint && npm test && npm run build && cfn-lint template.yaml`. `git ls-files infra scripts/build.sh scripts/deploy.sh scripts/teardown.sh test/infra.test.ts` prints nothing.
**Depends on:** P1-01, P2-01

### P2-03: Phase 2 end: push and list manual checks

**Goal:** Push the branch and record the Phase 2 manual checks as NOT VERIFIED for a human.
**Files touched:** `docs/PROGRESS.md` (log entry only)
**Design constraints:** Follow the phase-end protocol in CLAUDE.md. SPEC section 8, Phase 2. Make no code changes.
**Acceptance tests:** none (no code). The existing suite still passes.
**Out of scope:** running the manual checks, `npm run deploy`, any AWS call, any code or test change.
**Verification:** `npm run typecheck && npm run lint && npm test && npm run build`; `git push -u origin HEAD` succeeds. Manual check (human, NOT VERIFIED):
- `npm run deploy` succeeds in us-west-2.
- The Lambda console shows two functions: `lwf-iam` with one `Active` endpoint `iam` (IAM auth) and `lwf-public` with one `Active` endpoint `public`, each with one revision.
- The first deploy created a code bucket stack named `lwf-<hash>-WebFunctionCode`.
**Depends on:** P2-02

## Phase 3 — Smoke tests and docs

### P3-01: Update the smoke and test-user scripts for the SAM stack

**Goal:** Bring `scripts/create-test-user.sh`, `scripts/smoke-iam.ts`, `scripts/smoke-jwt.sh` and the shared `scripts/env.sh` in line with the SAM stack, its outputs and the `/whoami` shape without `endpoint`.
**Files touched:** `scripts/env.sh`, `scripts/create-test-user.sh`, `scripts/smoke-iam.ts`, `scripts/smoke-jwt.sh`, `package.json`, `test/scripts.test.ts`
**Design constraints:**
- SPEC sections 1 (Auth types: SigV4 with service `lambda`, `X-Amz-Content-SHA256`), 3 (principles 1, 8, 9), 4 (rows for the three scripts; the shared-helper note), 6 (Routes), 7 (manual-only commands).
- `scripts/env.sh` (sourced, not run; no `set -euo pipefail`): derive `STACK_NAME` and `AWS_REGION` from `samconfig.toml`'s `[default.global.parameters]` (`stack_name = "…"`, `region = "…"`) by reading the file next to the repo root (locate it from `${BASH_SOURCE[0]}`, not the caller's cwd), and `export AWS_REGION`. These values win over any `AWS_REGION` already in the caller's shell, so the scripts always target the stack and Region `sam deploy` used. Fail with a clear message if either value cannot be read. Keep `stack_output <stack-name> <output-key>`. Remove anything no remaining script uses.
- Output names are unchanged: `IamEndpointUrl`, `PublicEndpointUrl`, `UserPoolId`, `UserPoolClientId`. `IamFunctionName`/`PublicFunctionName` are available but not needed.
- `scripts/smoke-iam.ts`: keep `node scripts/smoke-iam.ts <IamEndpointUrl> <region>` (argv only, never `process.env`, constraint `process-env-only-in-config`), SigV4 with `service: 'lambda'`, the endpoint's Region, `@smithy/signature-v4` + `@aws-crypto/sha256-js` + the default credential chain, and the `x-amz-content-sha256` header. Remove the `endpoint` field and its check; signed `/whoami` must return 200 with `authMode === 'iam'`, `subject === null`, a string `envId` and a number `requestCount`. Keep the `/health`, `/stream` (at least one event, ticks numbered from 1) and unsigned-`/health`-is-403 checks.
- `scripts/smoke-jwt.sh`: against `PublicEndpointUrl`: `/health` → 200, `/whoami` without a token → 401, with a token → 200 with `authMode` `jwt` and non-empty `subject`, `/stream` with a token → at least one event numbered from 1. Change only what differs from this.
- `scripts/create-test-user.sh`: `admin-create-user` + `admin-set-user-password --permanent`, then `initiate-auth USER_PASSWORD_AUTH`; prints only the access token on stdout. Change only what differs from this.
- `package.json`: keep `create-test-user`, `smoke:jwt` and `smoke:iam` (which sources `scripts/env.sh` and passes `IamEndpointUrl` and `$AWS_REGION` to `node scripts/smoke-iam.ts`); adjust only if `env.sh` changes require it.
- No script, npm script or test runs these against AWS (No-AWS rule in CLAUDE.md). Sourcing `env.sh` must not call AWS (it only defines `stack_output`). Do not assert stream tick counts (constraint `stream-tunables-only-in-config`).
**Acceptance tests:** `test/scripts.test.ts`, inside `describe('scripts')`:
- kept: `every shell script parses with bash -n`, `every runnable shell script starts with set -euo pipefail`, `create-test-user.sh prints usage and exits 2 without an email`, `smoke-jwt.sh prints usage and exits 2 without a token`, `smoke-iam.ts prints usage and exits 2 without arguments`, `smoke-iam.ts signs for service lambda and sets x-amz-content-sha256`, `package.json wires create-test-user and smoke:jwt to the scripts`, `package.json wires smoke:iam through env.sh`
- `env.sh takes the stack name and Region from samconfig.toml` (`spawnSync('bash', ['-c', 'source scripts/env.sh && printf "%s %s" "$STACK_NAME" "$AWS_REGION"'], { cwd: root, encoding: 'utf8' })` prints `lwf us-west-2`)
- `smoke-iam.ts no longer reads an endpoint field` (file text does not match `/\.endpoint\b/`)
- `no script references infra/ or the artifacts stack` (no file in `scripts/` contains `infra/`, `artifacts` or `ARTIFACTS_STACK_NAME`)
**Out of scope:** README, CLAUDE.md, running any script against AWS, `template.yaml`, `src/`.
**Verification:** `npm run typecheck && npm run lint && npm test && npm run build`. `bash -n scripts/*.sh` exits 0.
**Depends on:** P2-02

### P3-02: Rewrite the README and confirm the CLAUDE.md module map

**Goal:** Rewrite `README.md` for the two-function SAM version and confirm the `CLAUDE.md` module map matches the finished code.
**Files touched:** `README.md`, `test/readme.test.ts`, `CLAUDE.md` (module map only, if it drifted)
**Design constraints:**
- SPEC sections 1, 2, 4, 5, 6, 7, 8 (Phase 3 list), 9.
- README must cover, in this order: what this is and why there are two functions (SAM generates one endpoint per Web Function; `iam` is `IamAuth`, `public` is `ApplicationManaged`; the mode comes from `AUTH_MODE`); routes (section 6, no `endpoint` field); prerequisites (Node 24, AWS CLI v2, SAM CLI 1.170 or newer, cfn-lint, AWS credentials); local development (`npm run dev`, `npm run dev:public`, the curls from P1-02); checks (`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `cfn-lint template.yaml`, none of which call AWS); a note to always build through `npm run build` / `npm run deploy` and never run `sam build` directly, because esbuild is a devDependency found only through npm's `PATH`; deploy (`npm run deploy`; first deploy creates the `lwf-<hash>-WebFunctionCode` code bucket stack; `samconfig.toml` holds stack `lwf` and Region `us-west-2`); test the deployment (`npm run smoke:iam`, `npm run create-test-user -- <email>`, `npm run smoke:jwt -- <token>`; `IamAuth` calls need SigV4 for service `lambda` and an `X-Amz-Content-SHA256` header, else 403); environment reuse per function (stable `envId`, rising `requestCount`, different `envId`s across the two functions); logs in `/aws/lambda/web/lwf-iam` and `/aws/lambda/web/lwf-public`; teardown (`npm run teardown` deletes the app stack, then empties and deletes the code bucket stack); configuration reference (section 5 tables); cost notes (`MaxEnvironments` and `RateLimit` apply per function, two sets of environments); links to issues #1–#4 as `https://github.com/deeheber/lambda-web-functions/issues/<n>`.
- Remove the 0.1 "Don't deploy this version yet" warning and every mention of `lambda-web-endpoint-name`, `infra/`, `AUTH_ENDPOINT_*`, the artifacts stack, `dist/app.zip` and `scripts/build.sh`. Never suggest a global npm install (constraint `no-global-install`).
- `CLAUDE.md`: compare the `## Module map` table with the code on disk (including `createJwtVerifier(settings, jwks?)`, the `Jwks` type, `AuthConfig` in `src/config.ts`, `scripts/env.sh`) and fix only rows that are wrong. Do not edit any other `CLAUDE.md` section. If nothing drifted, leave the file untouched and say so in the commit's Interpretation line.
**Acceptance tests:** `test/readme.test.ts`, `describe('README.md')`:
- kept: `documents every npm script`, `links issues 1 to 4`
- `lists the prerequisites` (contains `Node 24`, `AWS CLI v2`, `SAM CLI`, `1.170`, `cfn-lint`)
- `explains the two functions and AUTH_MODE` (contains `IamAuth`, `ApplicationManaged`, `AUTH_MODE`)
- `names the template lint command and the log groups` (contains `cfn-lint template.yaml`, `/aws/lambda/web/lwf-iam`, `/aws/lambda/web/lwf-public`)
- `has no 0.1 leftovers` (does not contain `lambda-web-endpoint-name`, `infra/`, `AUTH_ENDPOINT`, `artifacts`, `app.zip`, `Don't deploy this version`)
**Out of scope:** `src/`, `scripts/`, `template.yaml`, `package.json`, any `CLAUDE.md` section other than the module map.
**Verification:** `npm run typecheck && npm run lint && npm test && npm run build`.
**Depends on:** none

### P3-03: Phase 3 end: push and list manual checks

**Goal:** Push the branch and record the Phase 3 manual checks as NOT VERIFIED for a human.
**Files touched:** `docs/PROGRESS.md` (log entry only)
**Design constraints:** Follow the phase-end protocol in CLAUDE.md. SPEC section 8, Phase 3. Make no code changes.
**Acceptance tests:** none (no code). The existing suite still passes.
**Out of scope:** running the manual checks, any AWS call, any code or test change.
**Verification:** `npm run typecheck && npm run lint && npm test && npm run build`; `git push -u origin HEAD` succeeds. Manual check (human, NOT VERIFIED):
- `npm run smoke:iam` exits 0; `TOKEN=$(npm run --silent create-test-user -- <email>)` prints a token; `npm run smoke:jwt -- "$TOKEN"` exits 0.
- Calling `/whoami` several times on each function shows a stable `envId` and a rising `requestCount` within that function, and the two functions have different `envId`s.
- Logs appear in `/aws/lambda/web/lwf-iam` and `/aws/lambda/web/lwf-public`.
- `npm run teardown` removes the app stack and its code bucket stack.
**Depends on:** P3-02

## Spec issues

- `CLAUDE.md` update timing (section 8, Phase 3): SPEC schedules the module-map update for Phase 3, but the existing `CLAUDE.md` described 0.1 throughout and the implementer reads it before every task. Resolution: the planner rewrote the shared sections for 0.2 now; P3-02 only confirms the module map.
- `test/readme.test.ts` (section 8): it requires every npm script to be documented, so adding `dev:public` in Phase 1 forces a README edit in P1-02, before the Phase 3 rewrite. Resolution: P1-02 makes a minimal README edit.
- Region and stack name in two places (section 4): `samconfig.toml` names `lwf`/`us-west-2`, and 0.1's `scripts/env.sh` repeated both as defaults overridable by `AWS_REGION`, which could point the scripts at a different Region than `sam deploy`. Resolution: P3-01 makes `env.sh` read both from `samconfig.toml`.
- `AUTH_MODE=none` manual check (section 8, Phase 1): it is checkable offline. Resolution: `test/server.test.ts` covers it in P1-01; the manual check stays in the list.
- `EndpointType` (sections 1, 2): SPEC lists the property and wants `HomeRegion` but does not say whether to set it. Resolution: set it explicitly; it is the default either way. As SPEC section 1 notes, neither linter validates it (an invalid value also passes cfn-lint 1.58.0, checked during planning), so `test/template.test.ts` asserts it.
- `Timeout` vs `TimeoutSeconds` (sections 4, 5): the SAM property is `Timeout`, the parameter is `TimeoutSeconds`. Resolution: `Timeout: !Ref TimeoutSeconds`; the tunables constraint covers both names.
- `yaml` short-form tags (section 3, principle 7): `parse(text, { logLevel: 'error' })` turns `!Ref MaxEnvironments` into the string `'MaxEnvironments'`, so the template test cannot tell a `!Ref` from the same literal word. Resolution: the `template-tunables-are-parameters` constraint catches numeric and uppercase literals; a literal string equal to the parameter name would still slip through, and the reviewer checks by reading.
- `parallel.setup` (section 7) names `npm ci`, but this plan uses no streams, so `docs/kukulu.json` has no `parallel` block.
- `npm test` now runs `sam build` (section 7, bundle test): every verify builds twice (once in the bundle test, once as `npm run build`), and `npm test` needs the SAM CLI and npm network access. Accepted as SPEC requires; the bundle test's `beforeAll` has a 300 s timeout.
- SAM CLI telemetry (section 2, "the flight never calls AWS"): `sam build` may send anonymous usage telemetry unless `SAM_CLI_TELEMETRY=0` is set. SPEC allows `sam build`'s npm downloads but does not mention telemetry. Resolution: no change in this flight; the operator can opt out in their shell.
