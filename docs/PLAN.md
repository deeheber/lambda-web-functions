# Lambda Web Functions Hello World build plan

Derived from docs/SPEC.md v0.1 on 2026-10-31. SPEC.md wins over this file.

## Decisions

- Phases → SPEC section 8 defines three phases; task ids follow them (`P1-xx` App and tests, `P2-xx` Infrastructure and build, `P3-xx` Smoke tests and docs). There is no phase 0.
- One function or two? → One function, two endpoints (SPEC section 9, decided). `lambda-web-endpoint-name` cannot be forged and auth fails closed.
- `subject` on the `iam` path → always `null` (SPEC section 9, decided). Lambda forwards no caller identity.
- ⚠️ ASSUMPTION tuning → no tuning tasks. SPEC section 5 says the values only matter once deployed and the human adjusts them. Each value still lives in exactly one place (`src/config.ts` or an `infra/app.yaml` parameter) and `docs/kukulu.json` constraints enforce it.
- Parallel streams → none; the plan is fully serial and `docs/kukulu.json` has no `parallel` block. Most tasks edit the shared wiring SPEC section 4 names (`package.json`, `src/app.ts`, `infra/app.yaml`), and the rest are small. If streams are ever added, the setup command is `npm ci`.
- `npm run dev` runs a CJS bundle inside a `"type": "module"` package → both the `dev` script and `scripts/build.sh` write `dist/package.json` containing `{"type":"commonjs"}` next to `dist/index.js`. Without it Node treats `dist/index.js` as ESM and the CJS bundle crashes. The zip still contains only `index.js`.
- Relative import style → every relative import in `src/`, `test/` and `scripts/` uses the `.ts` extension (`import { loadConfig } from './config.ts'`), with `allowImportingTsExtensions` + `noEmit` in tsconfig. This lets Node 24 run `src/server.ts` directly (used by `test/server.test.ts`), and esbuild and vitest resolve it unchanged.
- How tests avoid `process.env` → `loadConfig(env = process.env)` takes the env object as a parameter, so tests pass plain objects. Tests that spawn a child process pass `process.execPath` as the command and a literal `env` object, and inherit the environment (no `env` option) when they run `bash`.
- Auth module imports → SPEC section 4 lets `src/auth/index.ts` import only `src/auth/types`, so `authMiddleware` takes the `AuthEndpoints` shape (`{ iamEndpointName, jwtEndpointName }`) defined in `src/auth/types.ts` and `createApp` passes `config.auth`. Type-only imports (`import type`) of `src/auth/types.ts` and `src/config.ts` are allowed from any `src/` module because they are erased at build time; runtime imports follow the SPEC table.
- `requestCount` semantics → incremented once for every request, including rejected ones, by a middleware that runs before auth. The new value is stored in `res.locals.requestCount` and `/whoami` reports that value, so concurrent requests never read each other's count.
- `WWW-Authenticate: Bearer` → sent only on 401s from the jwt endpoint (missing or invalid token). A 401 for a missing or unknown endpoint name has no `WWW-Authenticate` header.
- `/stream` timing → the first event is written `stream.intervalMs` after the request starts (a `setInterval` timer), then one per interval; the timer is cleared on the last tick and on `res.on('close')`.
- Number parsing in `loadConfig` → a number must match `/^\d+$/`. `stream.ticks` ≥ 1, `stream.intervalMs` ≥ 0, port 0–65535 (0 lets tests bind an ephemeral port). An empty string counts as unset.
- Unhandled-error test → `src/app.ts` exports `errorHandler` and `notFoundHandler` so tests mount them on a throwaway Express app with a throwing route; production code has no test-only route or flag.
- SIGTERM deadline → a named constant `SHUTDOWN_DEADLINE_MS = 500` in `src/server.ts`. It is half the platform's 1 s limit, leaving margin for timer jitter and process exit so the 1 s tests do not flake; it is not a SPEC section 5 tunable.
- Script inputs → shared `scripts/env.sh` (sourced, not run) sets `AWS_REGION` (default `us-west-2`), `STACK_NAME` (default `lwf`), `ARTIFACTS_STACK_NAME` (default `${STACK_NAME}-artifacts`), `ROOT`, and a `stack_output <stack> <key>` function. `scripts/smoke-iam.ts` takes the endpoint URL and Region as argv, never `process.env`; the `smoke:iam` npm script resolves both through `env.sh`.
- `scripts/build.sh` output dir → optional first argument (default `<repo>/dist`), so `test/bundle.test.ts` can build into a temp dir. `scripts/deploy.sh` always runs `build.sh` first so a stale zip is never uploaded.
- Revision deletion policy → `DeletionPolicy: Delete` next to `UpdateReplacePolicy: Retain` on the revision. cfn-lint 1.58 warns W3011 (exit 4) when `UpdateReplacePolicy` is set alone; `Delete` keeps SPEC's "deleting the function deletes all its revisions" behaviour. Checked against cfn-lint 1.58.0 during planning.
- Smoke-test tick count → the smoke scripts do not know `STREAM_TICKS`, and principle 8 forbids repeating the default, so they assert at least one event with ticks numbered consecutively from 1.

## Conventions

- One task, one commit, title `<ID>: <title>`, body per the commit template in CLAUDE.md.
- Every verify command in `docs/kukulu.json` is gated with `from: P1-01`; `npm run build` with `from: P2-03`; `cfn-lint infra/*.yaml` runs as `extraVerify` on `infra/` with `from: P2-01`.
- No task calls AWS. Every AWS-touching check is a manual check in a phase-end task.

## Phase 1 — App and tests

### P1-01: Scaffold the package and typed config loader

**Goal:** Create the npm package, TypeScript/ESLint/vitest tooling and `src/config.ts` with its tests, so `npm run typecheck`, `npm run lint` and `npm test` all pass from a fresh `npm ci`.
**Files touched:** `package.json`, `package-lock.json`, `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `.gitignore`, `src/config.ts`, `test/config.test.ts`
**Design constraints:**
- SPEC sections 3 (principles 1 and 8), 4 (Architecture), 5 (App config), 7 (Commands).
- `package.json`: `"name": "lambda-web-functions-hello"`, `"private": true`, `"type": "module"`, `"engines": { "node": ">=24" }`. Scripts exactly: `"typecheck": "tsc --noEmit"`, `"lint": "eslint . --max-warnings 0"`, `"test": "vitest run"`. Later tasks add `dev`, `build`, `deploy`, `teardown`, `create-test-user`, `smoke:iam`, `smoke:jwt`; do not add them now.
- Install with `npm install` (this commits `package-lock.json`, which `npm ci` needs; never list it in `.gitignore`). Dependencies: `express@^5`, `aws-jwt-verify`. Dev dependencies: `typescript@^5.8` (needs ≥ 5.8 for `erasableSyntaxOnly`), `@types/node@^24`, `@types/express@^5`, `eslint@^9`, `@eslint/js@^9`, `typescript-eslint@^8`, `vitest`, `supertest`, `@types/supertest`, `esbuild`, `yaml@^2`. Install them all now so later tasks only edit `scripts`.
- `tsconfig.json` compilerOptions: `target` and `lib` `ES2024`, `module` and `moduleResolution` `NodeNext`, `strict: true`, `erasableSyntaxOnly: true`, `verbatimModuleSyntax: true`, `allowImportingTsExtensions: true`, `noEmit: true`, `types: ["node"]`, `skipLibCheck: true`, `esModuleInterop: true`. `include`: `["src", "test", "scripts", "vitest.config.ts"]`. Relative imports always use the `.ts` extension; type-only imports use `import type`.
- `eslint.config.js` (flat config, ESM): ignores `dist/`, `node_modules/`, `coverage/`; extends `@eslint/js` recommended and `typescript-eslint` recommended (not the type-checked variant); sets `@typescript-eslint/no-unused-vars` to `['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }]` so the 4-argument Express error handler can name its unused `_next`.
- `vitest.config.ts`: `defineConfig` from `vitest/config`, `test.include: ['test/**/*.test.ts']`, `test.environment: 'node'`. Never watch mode.
- `.gitignore`: `node_modules/`, `dist/`, `*.zip`, `coverage/`.
- `src/config.ts` is the ONLY file in the repo that may contain `process.env` (constraint `process-env-only-in-config`). Export:
  - `export type Env = Readonly<Record<string, string | undefined>>;`
  - `export interface Config { readonly listen: { readonly host: string; readonly port: number }; readonly auth: { readonly iamEndpointName: string; readonly jwtEndpointName: string; readonly cognito: { readonly userPoolId: string; readonly clientId: string } }; readonly stream: { readonly ticks: number; readonly intervalMs: number } }`
  - `export function loadConfig(env: Env = process.env): Config`
- Env var → key mapping and defaults exactly as SPEC section 5: `AWS_LAMBDA_HTTP_ENDPOINT` → `listen` (default `127.0.0.1:3000`), `AUTH_ENDPOINT_IAM` → `auth.iamEndpointName` (required), `AUTH_ENDPOINT_JWT` → `auth.jwtEndpointName` (required), `COGNITO_USER_POOL_ID` → `auth.cognito.userPoolId` (required), `COGNITO_CLIENT_ID` → `auth.cognito.clientId` (required), `STREAM_TICKS` → `stream.ticks` (default `5`, ⚠️ ASSUMPTION), `STREAM_INTERVAL_MS` → `stream.intervalMs` (default `500`, ⚠️ ASSUMPTION). Keep the three defaults as named constants in `src/config.ts` (`DEFAULT_LISTEN`, `DEFAULT_STREAM_TICKS`, `DEFAULT_STREAM_INTERVAL_MS`); these literals appear nowhere else in `src/` or `scripts/` (constraints `stream-tunables-only-in-config`, `listen-default-only-in-config`).
- Parsing rules: an empty string counts as unset. `AWS_LAMBDA_HTTP_ENDPOINT` is split at the LAST `:`; the host is the part before it with surrounding `[` `]` removed (IPv6) and must be non-empty; the port must match `/^\d+$/` and be 0–65535. `STREAM_TICKS` must match `/^\d+$/` and be ≥ 1; `STREAM_INTERVAL_MS` must match `/^\d+$/`. Throw an `Error` whose message names the env var when a required value is missing, when a number fails these rules, or when `AUTH_ENDPOINT_IAM === AUTH_ENDPOINT_JWT`.
- The returned object and every nested object are frozen (`Object.freeze` at each level).
- No module-level `let`/`var` (constraint `no-module-level-mutable-state`).
**Acceptance tests:** `test/config.test.ts`, inside `describe('loadConfig')`:
- `applies defaults when optional values are unset` (listen `127.0.0.1`/`3000`, ticks `5`, intervalMs `500`)
- `throws when %s is missing` (an `it.each` over the four required vars)
- `treats an empty string as unset`
- `throws when the two endpoint names are equal`
- `throws when STREAM_TICKS is not a number` (`'abc'`, `'5x'`, `'-1'`, `'1.5'`)
- `throws when STREAM_TICKS is zero`
- `throws when STREAM_INTERVAL_MS is not a number`
- `parses host and port from AWS_LAMBDA_HTTP_ENDPOINT` (`'0.0.0.0:8080'` → host `0.0.0.0`, port `8080`; `'[::1]:9000'` → host `::1`)
- `throws when AWS_LAMBDA_HTTP_ENDPOINT has no valid port` (`'localhost'`, `'localhost:abc'`, `'localhost:70000'`)
- `returns a deeply frozen object`
Every test passes an explicit env object; no test reads or writes `process.env`.
**Out of scope:** any other `src/` module; `dev`/`build` scripts; esbuild invocation; infra; README.
**Verification:** `npm ci && npm run typecheck && npm run lint && npm test`.
**Depends on:** none

### P1-02: Add env-info and the Cognito JWT verifier adapter

**Goal:** Create `src/env-info.ts`, the shared auth types in `src/auth/types.ts`, and the `aws-jwt-verify` adapter in `src/auth/jwt-verifier.ts`, with tests that never touch the network.
**Files touched:** `src/env-info.ts`, `src/auth/types.ts`, `src/auth/jwt-verifier.ts`, `test/env-info.test.ts`, `test/jwt-verifier.test.ts`
**Design constraints:**
- SPEC sections 1 (Runtime contract: per-request state never in module scope), 3 (principles 3 and 4), 4 (Architecture table rows for these files).
- `src/env-info.ts` is the ONLY module in `src/` allowed module-level mutable state. Export `envId: string` (`randomUUID()` from `node:crypto`, generated at module load), `startedAt: string` (`new Date().toISOString()` at module load), `recordRequest(): number` (increments the module-level `requestCount` and returns the new value) and `getRequestCount(): number`. Do not export `requestCount` itself (ESM bindings are not assignable from importers). It imports nothing from `src/`.
- `src/auth/types.ts` holds types only (no runtime code):
  - `export type AuthMode = 'iam' | 'jwt';`
  - `export interface AuthContext { readonly endpoint: string; readonly authMode: AuthMode; readonly subject: string | null }`
  - `export interface AuthEndpoints { readonly iamEndpointName: string; readonly jwtEndpointName: string }`
  - `export interface CognitoSettings { readonly userPoolId: string; readonly clientId: string }`
  - `export interface VerifiedToken { readonly sub: string }`
  - `export interface JwtVerifier { verify(token: string): Promise<VerifiedToken> }` (resolves for a valid access token, rejects otherwise)
- `src/auth/jwt-verifier.ts` is the ONLY file that imports `aws-jwt-verify` (constraint `jwt-lib-only-in-adapter`). Export `createJwtVerifier(settings: CognitoSettings): JwtVerifier`, built on `CognitoJwtVerifier.create({ userPoolId, tokenUse: 'access', clientId })`; `verify` awaits the inner verifier and returns `{ sub: payload.sub }`. Never call `hydrate()` or anything else that fetches the JWKS eagerly. It may `import type` from `./types.ts` only.
- No `process.env` (use nothing from the environment here).
- Tests never fetch a JWKS: in `test/jwt-verifier.test.ts`, replace `globalThis.fetch` with a `vi.fn()` that rejects (restore it afterwards) and assert it was not called. Tests must not import or mock `aws-jwt-verify` directly.
**Acceptance tests:**
- `test/env-info.test.ts`: `envId is a UUID`, `startedAt is an ISO timestamp`, `recordRequest increments and returns the new count` (assert relative to `getRequestCount()` before the call, not an absolute number).
- `test/jwt-verifier.test.ts`: `throws at creation for a malformed user pool id` (`'not-a-pool'`), `creates a verifier for a well-formed pool id` (`'us-west-2_000000000'`, client `'local'`), `rejects a malformed token without fetching a JWKS` (`verify('not-a-jwt')` rejects; the stubbed fetch was never called).
**Out of scope:** the auth middleware (P1-03), `src/app.ts`, routes, server.
**Verification:** `npm run typecheck && npm run lint && npm test`.
**Depends on:** P1-01

### P1-03: Add the fail-closed auth middleware

**Goal:** Implement `authMiddleware` in `src/auth/index.ts`, which picks the auth mode per request from `lambda-web-endpoint-name` and returns 401 for anything it does not recognise.
**Files touched:** `src/auth/index.ts`, `test/auth.test.ts`
**Design constraints:**
- SPEC sections 1 (Request headers), 2 (fail closed), 3 (principle 2), 6 (Auth middleware).
- `src/auth/index.ts` is the ONLY file in `src/` that mentions `lambda-web-endpoint-name` (constraint `endpoint-header-only-in-auth`). It may import from `./types.ts` and the `express` package only (not `src/config.ts`; SPEC section 4 table).
- Signature: `export function authMiddleware(endpoints: AuthEndpoints, verifier: JwtVerifier): RequestHandler` (types from `src/auth/types.ts`: `AuthEndpoints = { iamEndpointName, jwtEndpointName }`, `JwtVerifier = { verify(token): Promise<{ sub }> }`, `AuthContext = { endpoint, authMode: 'iam' | 'jwt', subject: string | null }`). `createApp` will pass `config.auth`, which has this shape.
- Behaviour, comparing the header value with `===` (case-sensitive, exact):
  - equals `endpoints.iamEndpointName` → `res.locals.auth = { endpoint, authMode: 'iam', subject: null }`, `next()`. The verifier is never called.
  - equals `endpoints.jwtEndpointName` → if `req.path === '/health'`, set `res.locals.auth = { endpoint, authMode: 'jwt', subject: null }` and `next()`. Otherwise read `Authorization`, match `/^Bearer\s+(\S+)$/i`; no match → 401. Else `await verifier.verify(token)`; rejection (for any reason, including a JWKS fetch failure) → 401; success → `res.locals.auth = { endpoint, authMode: 'jwt', subject: sub }`, then `next()`. Call `next()` OUTSIDE the try/catch around `verify`, so an error thrown by a later handler is not turned into a 401.
  - missing, empty, or any other value → 401.
- Every 401 body is exactly `{"error":"unauthorized"}` (via `res.status(401).json(...)`). Only the two jwt-endpoint 401s (no/invalid token) also set `WWW-Authenticate: Bearer`.
- No "disabled", `none`, `off` or `skip` mode, flag or env var anywhere (constraint `no-auth-bypass-mode`). Never read `X-Forwarded-Host` (constraint `no-forwarded-host`).
- No module-level mutable state; per-request values live in locals or `res.locals`.
- Tests build a throwaway Express app inside the test: `app.use(authMiddleware({ iamEndpointName: 'iam', jwtEndpointName: 'public' }, fakeVerifier))`, `GET /health` → `{status:'ok'}`, `GET /probe` → `res.json(res.locals.auth)`, and `GET /boom` that throws after auth. The fake verifier resolves `{ sub: 'user-123' }` for `'good-token'` and rejects for anything else, and counts its calls. Use `supertest`.
**Acceptance tests:** `test/auth.test.ts`, inside `describe('authMiddleware')`:
- `returns 401 when the endpoint header is missing`
- `returns 401 for an unknown endpoint name`
- `matches endpoint names exactly` (`'IAM'` and `'iam '` → 401)
- `allows the iam endpoint without a token and sets subject null`
- `does not call the verifier on the iam endpoint`
- `returns 401 with WWW-Authenticate on public without a token`
- `returns 401 on public with an invalid token`
- `returns 401 on public with a non-Bearer Authorization header` (`'Basic abc'`)
- `returns 200 on public with a valid token and sets subject to sub`
- `allows /health on public without a token`
- `does not turn downstream errors into 401` (`/boom` with a valid token → 500)
**Out of scope:** `src/app.ts`, routes, request counting, server.
**Verification:** `npm run typecheck && npm run lint && npm test`.
**Depends on:** P1-02

### P1-04: Add createApp with the health, whoami and stream routes

**Goal:** Implement `createApp(config, deps)` in `src/app.ts` and the three route modules, with request counting, auth on every route, 404 and 500 handlers.
**Files touched:** `src/app.ts`, `src/routes/health.ts`, `src/routes/whoami.ts`, `src/routes/stream.ts`, `test/app.test.ts`, `test/stream.test.ts`
**Design constraints:**
- SPEC sections 1 (Runtime contract), 2 (goals), 3 (principles 2, 4, 8), 4 (Architecture), 6 (Interfaces: routes, JSON content type, 404, 500).
- `src/app.ts` exports `interface AppDeps { readonly verifier: JwtVerifier }` and `createApp(config: Config, deps: AppDeps): Express`. Middleware order: `app.disable('x-powered-by')`; a counting middleware that sets `res.locals.requestCount = recordRequest()` (from `src/env-info.ts`) and calls `next()`; `authMiddleware(config.auth, deps.verifier)` (from `src/auth/index.ts`); `GET /health`, `GET /whoami`, `GET /stream`; `notFoundHandler`; `errorHandler`. Auth runs before every route including 404. Never enable `trust proxy` (constraint `no-forwarded-host`).
- `src/app.ts` also exports `notFoundHandler` (404 `{"error":"not_found"}`) and `errorHandler(err, _req, res, _next)` (4 arguments): log the error with `console.error` (the stack when it is an `Error`), then 500 `{"error":"internal"}`; never put the stack or message in the response; if `res.headersSent`, just `res.end()`.
- All JSON responses go through `res.json` (`Content-Type: application/json`).
- `src/routes/health.ts` exports `healthHandler: RequestHandler` → 200 `{"status":"ok"}`.
- `src/routes/whoami.ts` exports `whoamiHandler: RequestHandler` → 200 `{ endpoint, authMode, subject, envId, startedAt, requestCount }` in that key order. `endpoint`, `authMode`, `subject` come from `res.locals.auth` (cast to `AuthContext`, `import type` from `src/auth/types.ts`); `requestCount` from `res.locals.requestCount` (NOT `getRequestCount()`, so concurrent requests never read each other's count); `envId`, `startedAt` from `src/env-info.ts`.
- `src/routes/stream.ts` exports `createStreamHandler(settings: Config['stream']): RequestHandler` (`import type { Config }` from `src/config.ts`). It sets status 200, `Content-Type: text/event-stream`, `Cache-Control: no-cache`, calls `res.flushHeaders()`, then starts a `setInterval` with `settings.intervalMs`; each tick writes `data: {"tick":n}\n\n` with `res.write` (n = 1..`settings.ticks`); on the last tick it calls `clearInterval` then `res.end()`. `res.on('close', ...)` calls `clearInterval` so a client disconnect stops it early. The tick counter is a local variable inside the handler, never module scope. No literal tick count or interval anywhere (constraint `stream-tunables-only-in-config`).
- No `process.env`, no `lambda-web-endpoint-name` (not even in a comment: constraint `endpoint-header-only-in-auth` is case-insensitive and scans comments), no module-level `let`/`var` in these files.
- Tests build config with `loadConfig({ AUTH_ENDPOINT_IAM: 'iam', AUTH_ENDPOINT_JWT: 'public', COGNITO_USER_POOL_ID: 'us-west-2_000000000', COGNITO_CLIENT_ID: 'local', STREAM_TICKS: '3', STREAM_INTERVAL_MS: '5' })` (or a larger interval where a test says so) and a fake verifier (`'good-token'` → `{ sub: 'user-123' }`, else reject). Use `supertest`; for chunk-timing and disconnect tests use `app.listen(0, '127.0.0.1')` and `node:http` `request`, closing the server afterwards.
**Acceptance tests:**
- `test/app.test.ts`, inside `describe('createApp')`: `GET /health returns 200 status ok on the iam endpoint`, `GET /health returns 200 on the public endpoint without a token`, `GET /health returns 401 without an endpoint header`, `GET /whoami on iam returns the documented shape with subject null`, `GET /whoami on public with a valid token returns authMode jwt and the subject`, `GET /whoami on public without a token returns 401`, `requestCount rises by one per request`, `unknown path returns 404 not_found on a known endpoint`, `unknown path without an endpoint header returns 401`, `JSON responses use Content-Type application/json`; inside `describe('errorHandler')`: `returns 500 internal and never sends the stack` (throwaway Express app with a throwing route, `notFoundHandler` and `errorHandler`; spy `console.error` and assert it was called; assert the body is exactly `{"error":"internal"}`).
- `test/stream.test.ts`, inside `describe('GET /stream')`: `streams stream.ticks events then ends` (body is exactly `data: {"tick":1}\n\ndata: {"tick":2}\n\ndata: {"tick":3}\n\n`; content type starts with `text/event-stream`; `cache-control` is `no-cache`), `delivers ticks as separate chunks over time` (ticks 3, interval 40 ms: at least 2 `data` chunks and at least 40 ms between first and last), `stops and clears its timer when the client disconnects` (ticks 1000, interval 10 ms; spy `globalThis.clearInterval`; destroy the request after the first chunk; within 1 s the spy was called and the server's open connection count drops to 0), `requires a token on the public endpoint` (401).
**Out of scope:** `src/server.ts`, listening, SIGTERM, `npm run dev`, esbuild.
**Verification:** `npm run typecheck && npm run lint && npm test`.
**Depends on:** P1-03

### P1-05: Add the server entry point with SIGTERM handling and npm run dev

**Goal:** Implement `src/server.ts` (load config, build the verifier and app, listen on `AWS_LAMBDA_HTTP_ENDPOINT`, exit within 1 s of SIGTERM) and the `dev` npm script.
**Files touched:** `src/server.ts`, `package.json`, `test/server.test.ts`
**Design constraints:**
- SPEC sections 1 (Runtime contract: listen within 10 s, SIGTERM 1 s), 4 (`src/server.ts` row, `scripts/build.sh` row: CJS), 6 (Process), 7 (`npm run dev`).
- `src/server.ts`, top to bottom with no exported API: `const config = loadConfig();` (no argument; only `src/config.ts` touches `process.env`), `createJwtVerifier(config.auth.cognito)`, `createApp(config, { verifier })`, `const server = app.listen(config.listen.port, config.listen.host, (err) => …)`. In the callback: on `err`, `console.error` it and `process.exit(1)`; otherwise log exactly one line `console.log(JSON.stringify({ msg: 'listening', host: config.listen.host, port, envId }))` where `port` is the actually bound port from `server.address()` (so port 0 logs the real port).
- `process.on('SIGTERM', ...)`: first `setTimeout(() => process.exit(0), SHUTDOWN_DEADLINE_MS).unref()`, then `server.close(() => process.exit(0))` and `server.closeIdleConnections()`. `const SHUTDOWN_DEADLINE_MS = 500;` is a named constant in this file (half the platform's 1 s limit, not a section 5 tunable).
- The bundle is CommonJS: no `import.meta` (constraint `no-import-meta-in-src`) and no top-level `await` anywhere in `src/`. Do not guard startup with an "is main module" check; the file starts the server when loaded.
- `package.json` adds exactly one script (keep the others): `"dev": "esbuild src/server.ts --bundle --platform=node --target=node24 --format=cjs --outfile=dist/index.js && printf '{\"type\":\"commonjs\"}' > dist/package.json && AUTH_ENDPOINT_IAM=iam AUTH_ENDPOINT_JWT=public COGNITO_USER_POOL_ID=us-west-2_000000000 COGNITO_CLIENT_ID=local node dist/index.js"`. The `dist/package.json` write is required: the root package is `"type": "module"`, so without it Node loads the CJS bundle as ESM and crashes. Do not set `AWS_LAMBDA_HTTP_ENDPOINT` or any stream value in the script (defaults live in `src/config.ts`).
- `test/server.test.ts` runs the real entry point with Node 24's native type stripping: `spawn(process.execPath, ['src/server.ts'], { cwd: <repo root>, env: { AWS_LAMBDA_HTTP_ENDPOINT: '127.0.0.1:0', AUTH_ENDPOINT_IAM: 'iam', AUTH_ENDPOINT_JWT: 'public', COGNITO_USER_POOL_ID: 'us-west-2_000000000', COGNITO_CLIENT_ID: 'local' } })`. The env is a literal object (no `process.env`). Read stdout line by line, parse the first line that is JSON with `msg === 'listening'`, ignore stderr (Node may print an experimental warning). Make requests with `node:http` to `127.0.0.1:<port>`. Always kill the child in `afterEach`. Per-test timeout 15 s.
**Acceptance tests:** `test/server.test.ts`, inside `describe('server entry point')`:
- `logs one JSON listening line with host, port and envId`
- `serves /health on the logged port` (header `lambda-web-endpoint-name: iam` → 200 `{"status":"ok"}`)
- `exits 0 within 1 s of SIGTERM`
- `exits 0 within 1 s of SIGTERM while a /stream response is open` (open `/stream` on the iam endpoint, wait for the first chunk, send SIGTERM, assert exit code 0 and under 1000 ms)
- `exits non-zero when a required env var is missing` (omit `AUTH_ENDPOINT_JWT`)
**Out of scope:** `scripts/build.sh`, the zip, the `build` script, infra.
**Verification:** `npm run typecheck && npm run lint && npm test`; then `npm run dev` starts and logs the listening line (stop it with Ctrl-C; do not leave it running).
**Depends on:** P1-04

### P1-06: Push phase 1 and list the manual checks

**Goal:** Push the branch and record the phase 1 manual checks a human must run.
**Files touched:** `docs/PROGRESS.md`
**Design constraints:** SPEC section 8, Phase 1 manual check. Follow the phase-end protocol in CLAUDE.md.
**Acceptance tests:** none (no code changes).
**Out of scope:** running `npm run dev` checks yourself and recording them as passed; any code change.
**Verification:** `git push -u origin HEAD` succeeds. The progress log entry says `Manual check: NOT VERIFIED (human)` and lists:
- `npm run dev`, then `curl -i -H 'lambda-web-endpoint-name: iam' localhost:3000/whoami` → 200 with `authMode: "iam"`, `subject: null`.
- `curl -i -H 'lambda-web-endpoint-name: public' localhost:3000/whoami` (no token) → 401 with `WWW-Authenticate: Bearer`.
- `curl -i localhost:3000/whoami` (no header) → 401.
- `curl -N -H 'lambda-web-endpoint-name: iam' localhost:3000/stream` → ticks arrive one at a time, then the response ends.
**Depends on:** none

## Phase 2 — Infrastructure and build

### P2-01: Add the artifacts bucket template

**Goal:** Create `infra/artifacts.yaml` (a private S3 bucket for deployment zips) and the first `test/infra.test.ts` checks for it.
**Files touched:** `infra/artifacts.yaml`, `test/infra.test.ts`
**Design constraints:**
- SPEC sections 3 (principles 5, 6, 7), 4 (`infra/artifacts.yaml` row).
- One resource `ArtifactsBucket` (`AWS::S3::Bucket`): `BucketEncryption` with `SSEAlgorithm: AES256` (SSE-S3); `PublicAccessBlockConfiguration` with all four flags `true`; `OwnershipControls` `BucketOwnerEnforced`; no `VersioningConfiguration`; no `BucketName` (let CloudFormation name it). No bucket policy.
- Output `BucketName` with `Value: !Ref ArtifactsBucket` and `Export: { Name: !Sub "${AWS::StackName}-BucketName" }`.
- No 12-digit numbers and no Region literals (constraints `infra-no-account-id`, `infra-no-region-literal`).
- `cfn-lint infra/*.yaml` must exit 0: it exits non-zero on warnings too, so fix every warning.
- `test/infra.test.ts` reads templates with `readFileSync` and parses them with `parse(text, { logLevel: 'error' })` from the `yaml` package (short-form tags such as `!Ref X` come back as plain strings like `"X"`). It never calls AWS or imports an AWS SDK (constraint `tests-and-build-never-call-aws`). Put this task's tests in `describe('infra/artifacts.yaml')`; P2-02 adds a sibling `describe` for `infra/app.yaml`.
**Acceptance tests:** `test/infra.test.ts`, inside `describe('infra/artifacts.yaml')`: `defines exactly one S3 bucket`, `blocks all public access`, `encrypts with SSE-S3 and has no versioning`, `exports the bucket name`.
**Out of scope:** `infra/app.yaml`, scripts, any AWS call.
**Verification:** `cfn-lint infra/*.yaml` (runs via extraVerify on `infra/`); `npm run typecheck && npm run lint && npm test`.
**Depends on:** P1-01

### P2-02: Add the app template and the pairing invariant test

**Goal:** Create `infra/app.yaml` (execution role, Cognito pool and client, WebFunction, one revision, `iam` and `public` endpoints, outputs) and the SPEC principle 7 pairing invariant tests.
**Files touched:** `infra/app.yaml`, `test/infra.test.ts`
**Design constraints:**
- SPEC sections 1 (Platform facts: resource properties, execution role), 2 (goals), 3 (principles 5, 7, 8), 4 (`infra/app.yaml` details), 5 (Stack parameters).
- Parameters (exact names, types, defaults): `CodeBucket` (String), `CodeKey` (String), `TimeoutSeconds` (Number, Default 30, MinValue 3, MaxValue 900), `MaxConcurrencyPerEnvironment` (Number, Default 64, MinValue 1, MaxValue 128), `MaxEnvironments` (Number, Default 2, MinValue 2; ⚠️ ASSUMPTION), `RateLimit` (Number, Default 100, AllowedValues 100, 200, … 1000; ⚠️ ASSUMPTION), `ApplicationLogLevel` (String, Default INFO, AllowedValues TRACE, DEBUG, INFO, WARN, ERROR, FATAL). These defaults appear ONLY under `Parameters`; every use in `Resources` is `!Ref <Param>` (constraint `infra-tunables-are-parameters`). Do not write `Key: value` text for these names inside `Description` strings.
- `ExecutionRole` (`AWS::IAM::Role`, no `RoleName`): trust principal `lambda.amazonaws.com`, `ManagedPolicyArns: [!Sub "arn:${AWS::Partition}:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole"]`.
- `UserPool` (`AWS::Cognito::UserPool`): `UsernameAttributes: [email]`, `AutoVerifiedAttributes: [email]`. `UserPoolClient` (`AWS::Cognito::UserPoolClient`): `UserPoolId: !Ref UserPool`, `GenerateSecret: false`, `ExplicitAuthFlows: [ALLOW_USER_PASSWORD_AUTH, ALLOW_REFRESH_TOKEN_AUTH]`.
- `HelloFunction` (`AWS::Lambda::WebFunction`): `FunctionName: !Sub "${AWS::StackName}-hello"`.
- `HelloRevision` (`AWS::Lambda::WebFunctionRevision`): `DeletionPolicy: Delete` AND `UpdateReplacePolicy: Retain` (both; cfn-lint W3011 fails with only the second). `FunctionName: !Ref HelloFunction`; `BuildConfig.CodeConfig.S3Object: { Bucket: !Ref CodeBucket, Key: !Ref CodeKey }`; `BuildConfig.RuntimeConfig.Runtime: nodejs24.x`; `ServiceConfig`: `ExecutionRoleArn: !GetAtt ExecutionRole.Arn`, `TimeoutSeconds: !Ref TimeoutSeconds`, `MaxConcurrencyPerEnvironment: !Ref MaxConcurrencyPerEnvironment`, `TelemetryConfig.LoggingConfig.ApplicationLogLevel: !Ref ApplicationLogLevel` (omit `SystemLogLevel`), and `EnvironmentVariables` as a map: `AUTH_ENDPOINT_IAM: iam`, `AUTH_ENDPOINT_JWT: public`, `COGNITO_USER_POOL_ID: !Ref UserPool`, `COGNITO_CLIENT_ID: !Ref UserPoolClient`. Do not set `STREAM_TICKS` or `STREAM_INTERVAL_MS` (their defaults live in `src/config.ts`).
- `IamEndpoint` and `PublicEndpoint` (`AWS::Lambda::WebFunctionEndpoint`): `FunctionName: !Ref HelloFunction`, `EndpointName` `iam` / `public`, `EndpointType: HomeRegion`, `AuthType` `IamAuth` / `ApplicationManaged`, `RevisionWeights: [{ RevisionId: !GetAtt HelloRevision.RevisionId, Weight: 100 }]`, `ScalingConfig: { MaxEnvironments: !Ref MaxEnvironments }`, `ThrottleConfig: { RateLimit: !Ref RateLimit }`.
- Outputs: `FunctionName` (`!Ref HelloFunction`), `IamEndpointUrl` (`!Sub "https://${IamEndpoint.DomainName}"`), `PublicEndpointUrl` (`!Sub "https://${PublicEndpoint.DomainName}"`), `UserPoolId` (`!Ref UserPool`), `UserPoolClientId` (`!Ref UserPoolClient`).
- No 12-digit numbers and no Region literals; use `AWS::AccountId`, `AWS::Region`, `AWS::Partition`. `cfn-lint infra/*.yaml` exits 0 (no warnings).
- Pairing invariant (SPEC principle 7) in `test/infra.test.ts`, parsed with `parse(text, { logLevel: 'error' })`. Find resources by `Type`, never by logical id. Keep the existing `describe('infra/artifacts.yaml')` block.
**Acceptance tests:** `test/infra.test.ts`, inside `describe('infra/app.yaml')`:
- `has exactly one WebFunction, one WebFunctionRevision and two endpoints`
- `AUTH_ENDPOINT_IAM names an IamAuth endpoint`
- `AUTH_ENDPOINT_JWT names an ApplicationManaged endpoint`
- `both endpoints are HomeRegion and send 100% to the revision` (one `RevisionWeights` entry, `RevisionId` `HelloRevision.RevisionId`, `Weight` 100)
- `both endpoints take MaxEnvironments and RateLimit from parameters`
- `the revision runs nodejs24.x from CodeBucket/CodeKey and is retained on replacement`
- `parameters have the SPEC defaults and ranges`
- `outputs the function name, both endpoint URLs and the Cognito ids`
- `the user pool client has no secret and allows USER_PASSWORD_AUTH`
**Out of scope:** scripts, build, any AWS call, canary weights, MultiRegion, VPC, CloudFront (SPEC section 2 non-goals).
**Verification:** `cfn-lint infra/*.yaml`; `npm run typecheck && npm run lint && npm test`.
**Depends on:** P2-01

### P2-03: Add the CJS bundle and zip build script

**Goal:** Create `scripts/build.sh` and the `build` npm script, which bundle `src/server.ts` into a CommonJS `index.js`, zip it at the zip root and print its sha256, with a test that runs the real bundle.
**Files touched:** `scripts/build.sh`, `package.json`, `test/bundle.test.ts`
**Design constraints:**
- SPEC sections 1 (Runtime contract: `index.js` at the zip root, listen on `AWS_LAMBDA_HTTP_ENDPOINT`, SIGTERM), 3 (principle 6), 4 (`scripts/build.sh` row), 7 (build command).
- `scripts/build.sh`: `#!/usr/bin/env bash` then `set -euo pipefail`. `ROOT` = repo root from the script's own location (`"$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"`). Output dir = optional first argument, default `"$ROOT/dist"`; create it and make it absolute. Remove any old `index.js`/`app.zip` there. Run `"$ROOT/node_modules/.bin/esbuild" "$ROOT/src/server.ts" --bundle --platform=node --target=node24 --format=cjs --outfile="$OUT_DIR/index.js"`. Write `$OUT_DIR/package.json` containing `{"type":"commonjs"}` (for local `node dist/index.js`; it is NOT zipped). Zip with `(cd "$OUT_DIR" && zip -q -X app.zip index.js)` so the zip contains only `index.js` at its root. Print `zip: <path>` and `sha256: <hex>` using `shasum -a 256` (works on macOS and Linux). Any failure exits non-zero.
- The script never calls `aws` (constraint `tests-and-build-never-call-aws` covers `scripts/build.sh`).
- `package.json` adds `"build": "bash scripts/build.sh"`; keep every other script.
- `test/bundle.test.ts`: in `beforeAll` (timeout 120 s), create a temp dir with `mkdtempSync(join(tmpdir(), 'lwf-build-'))` and run `spawnSync('bash', ['scripts/build.sh', tmp], { cwd: <repo root>, encoding: 'utf8' })` without an `env` option (inherits PATH; no `process.env` in the test). List the zip with `spawnSync('unzip', ['-Z1', zip])`, and extract it with `unzip -q <zip> -d <second temp dir>` that has no `package.json`, mimicking Lambda. Start the extracted bundle with `spawn(process.execPath, [join(extracted, 'index.js')], { env: { AWS_LAMBDA_HTTP_ENDPOINT: '127.0.0.1:0', AUTH_ENDPOINT_IAM: 'iam', AUTH_ENDPOINT_JWT: 'public', COGNITO_USER_POOL_ID: 'us-west-2_000000000', COGNITO_CLIENT_ID: 'local' } })`, read the `listening` JSON line, request with `node:http`, kill the child in `afterEach`. Remove temp dirs in `afterAll`.
**Acceptance tests:** `test/bundle.test.ts`, inside `describe('scripts/build.sh')`:
- `exits 0 and writes app.zip containing only index.js at the root`
- `prints the sha256 of the zip` (matches `/sha256: [0-9a-f]{64}/` and equals `createHash('sha256')` of the file)
- `emits a CommonJS bundle` (`index.js` has no line matching `/^(import|export)\s/`)
- `the unzipped bundle listens, serves /health and exits 0 within 1 s of SIGTERM`
**Out of scope:** deploy, upload, teardown; changing the `dev` script; any AWS call.
**Verification:** `npm run build` (prints the zip path and sha256; `unzip -Z1 dist/app.zip` lists only `index.js`); `npm run typecheck && npm run lint && npm test`.
**Depends on:** P1-05

### P2-04: Add the deploy and teardown scripts

**Goal:** Create `scripts/env.sh`, `scripts/deploy.sh` and `scripts/teardown.sh` plus their npm scripts, with offline tests that only parse and inspect them.
**Files touched:** `scripts/env.sh`, `scripts/deploy.sh`, `scripts/teardown.sh`, `package.json`, `test/scripts.test.ts`
**Design constraints:**
- SPEC sections 2 (non-goal: the flight never calls AWS), 3 (principles 6, 8), 4 (`scripts/deploy.sh`, `scripts/teardown.sh` rows), 7 (manual-only commands).
- `scripts/env.sh` is sourced, not run (no shebang requirement, no `set -euo pipefail`): `export AWS_REGION="${AWS_REGION:-us-west-2}"`, `STACK_NAME="${STACK_NAME:-lwf}"`, `ARTIFACTS_STACK_NAME="${ARTIFACTS_STACK_NAME:-${STACK_NAME}-artifacts}"`, `ROOT` (repo root from `${BASH_SOURCE[0]}`), and `stack_output() { aws cloudformation describe-stacks --stack-name "$1" --query "Stacks[0].Outputs[?OutputKey=='$2'].OutputValue" --output text; }`.
- `scripts/deploy.sh` (`#!/usr/bin/env bash`, `set -euo pipefail`, sources `env.sh`): runs `bash "$ROOT/scripts/build.sh"`; `aws cloudformation deploy` the artifacts stack from `infra/artifacts.yaml` with `--no-fail-on-empty-changeset`; reads `BucketName` with `stack_output`; computes the zip sha256 with `shasum -a 256`; uploads `dist/app.zip` to `s3://<bucket>/app-<sha256>.zip`; `aws cloudformation deploy` the app stack from `infra/app.yaml` with `--capabilities CAPABILITY_IAM --no-fail-on-empty-changeset --parameter-overrides "CodeBucket=$BUCKET" "CodeKey=$KEY" "$@"` (extra `Name=Value` args from `npm run deploy -- MaxEnvironments=4` pass through); prints the app stack outputs as a table. It never hard-codes a value for `TimeoutSeconds`, `MaxConcurrencyPerEnvironment`, `MaxEnvironments`, `RateLimit` or `ApplicationLogLevel` (constraint `infra-tunables-are-parameters`).
- `scripts/teardown.sh` (`#!/usr/bin/env bash`, `set -euo pipefail`, sources `env.sh`): delete the app stack and wait for `stack-delete-complete`; read the bucket name (tolerate a missing artifacts stack); `aws s3 rm "s3://$BUCKET" --recursive`; delete the artifacts stack and wait. Print what it removed.
- `package.json` adds `"deploy": "bash scripts/deploy.sh"` and `"teardown": "bash scripts/teardown.sh"`; keep every other script.
- `test/scripts.test.ts` never runs `deploy.sh`/`teardown.sh` and never mentions AWS CLI commands or SDK packages (constraint `tests-and-build-never-call-aws`); it only runs `spawnSync('bash', ['-n', file])` and reads files as text.
**Acceptance tests:** `test/scripts.test.ts`, inside `describe('scripts')`: `every shell script parses with bash -n` (every `scripts/*.sh`), `every runnable shell script starts with set -euo pipefail` (every `scripts/*.sh` except `env.sh`, within its first 5 lines), `package.json wires deploy and teardown to the scripts`.
**Out of scope:** running any of these scripts; Cognito users; smoke tests; README.
**Verification:** `bash -n scripts/*.sh`; `npm run typecheck && npm run lint && npm test`. Do NOT run `npm run deploy` or `npm run teardown`.
**Depends on:** P1-01

### P2-05: Push phase 2 and list the manual checks

**Goal:** Push the branch and record the phase 2 manual checks a human must run.
**Files touched:** `docs/PROGRESS.md`
**Design constraints:** SPEC section 8, Phase 2 manual check. Follow the phase-end protocol in CLAUDE.md.
**Acceptance tests:** none (no code changes).
**Out of scope:** running `npm run deploy` or any AWS command; any code change.
**Verification:** `git push -u origin HEAD` succeeds. The progress log entry says `Manual check: NOT VERIFIED (human)` and lists:
- `npm run deploy` succeeds in us-west-2 (AWS credentials set; `cfn-lint` ≥ 1.58 installed).
- In the Lambda console the function `lwf-hello` shows one revision and two `Active` endpoints: `iam` (IAM auth) and `public` (application managed).
**Depends on:** none

## Phase 3 — Smoke tests and docs

### P3-01: Add the test-user and JWT smoke scripts

**Goal:** Create `scripts/create-test-user.sh` and `scripts/smoke-jwt.sh` plus their npm scripts.
**Files touched:** `scripts/create-test-user.sh`, `scripts/smoke-jwt.sh`, `package.json`, `test/scripts.test.ts`
**Design constraints:**
- SPEC sections 2, 4 (`scripts/create-test-user.sh`, `scripts/smoke-jwt.sh` rows), 6 (Interfaces), 7 (manual-only commands).
- Both scripts: `#!/usr/bin/env bash`, `set -euo pipefail`, `source "$(dirname "${BASH_SOURCE[0]}")/env.sh"` (provides `AWS_REGION`, `STACK_NAME`, `stack_output <stack> <key>`).
- `create-test-user.sh <email>`: no argument → usage on stderr, exit 2. Pool and client ids from `stack_output "$STACK_NAME" UserPoolId` / `UserPoolClientId`. Password = `$TEST_USER_PASSWORD` if set, else generated as `"Aa1!$(openssl rand -hex 12)"` (meets the default Cognito policy). `aws cognito-idp admin-create-user --message-action SUPPRESS --user-attributes Name=email,Value=<email> Name=email_verified,Value=true` (if the user already exists, continue), then `admin-set-user-password --permanent`, then `initiate-auth --auth-flow USER_PASSWORD_AUTH --client-id … --auth-parameters USERNAME=…,PASSWORD=… --query AuthenticationResult.AccessToken --output text`. Only the access token goes to stdout; every other message goes to stderr.
- `smoke-jwt.sh <token>`: no argument → usage on stderr, exit 2. Base URL from `stack_output "$STACK_NAME" PublicEndpointUrl`. Checks with `curl -sS` (and `-N` for the stream): `/health` with no token → 200 and `{"status":"ok"}`; `/whoami` with no token → 401; `/whoami` with `Authorization: Bearer <token>` → 200, `authMode` `jwt`, `subject` a non-empty string; `/stream` with the token → 200, `content-type` starting `text/event-stream`, at least one `data: {"tick":n}` line with n = 1, 2, … consecutive. Parse JSON with `node -e` (no `jq` dependency). Print `PASS`/`FAIL <check>` per check; exit 1 if any failed. Never hard-code a tick count (constraint `stream-tunables-only-in-config`), and do not name a shell variable `ticks` or `intervalMs` (that constraint scans `scripts/` and `ticks=0` matches it); use `expected` or `n`.
- `package.json` adds `"create-test-user": "bash scripts/create-test-user.sh"` and `"smoke:jwt": "bash scripts/smoke-jwt.sh"`; keep every other script.
- Extend `test/scripts.test.ts`; it still never runs these scripts against AWS and never names AWS CLI commands.
**Acceptance tests:** `test/scripts.test.ts`, inside `describe('scripts')`: the existing tests now cover the two new files (bash -n and `set -euo pipefail`), plus `package.json wires create-test-user and smoke:jwt to the scripts`, `create-test-user.sh prints usage and exits 2 without an email`, `smoke-jwt.sh prints usage and exits 2 without a token` (the usage check must run before `env.sh` calls anything; run with `spawnSync('bash', [file])`, inherited env).
**Out of scope:** `scripts/smoke-iam.ts` (P3-02); README; running against AWS.
**Verification:** `bash -n scripts/*.sh`; `npm run typecheck && npm run lint && npm test`.
**Depends on:** P2-04

### P3-02: Add the SigV4 IAM smoke script

**Goal:** Create `scripts/smoke-iam.ts`, run directly by Node 24, which signs requests to the `iam` endpoint and checks every route plus the unsigned 403, and wire `npm run smoke:iam`.
**Files touched:** `scripts/smoke-iam.ts`, `package.json`, `package-lock.json`, `test/scripts.test.ts`
**Design constraints:**
- SPEC sections 1 (IamAuth calls: service `lambda`, the endpoint's Region, `X-Amz-Content-SHA256` required), 3 (principles 1, 6), 4 (`scripts/smoke-iam.ts` row), 6 (Interfaces).
- Add dependencies with `npm install --save-dev @smithy/signature-v4 @aws-crypto/sha256-js @aws-sdk/credential-provider-node` (commit the lockfile).
- Usage: `node scripts/smoke-iam.ts <IamEndpointUrl> <region>`. Missing or non-`https://` URL, or missing region → usage on stderr, exit 2, before any signing or credential lookup. The script reads NO `process.env` (constraint `process-env-only-in-config`); inputs come from `process.argv`.
- Runs under Node's native type stripping: only erasable syntax (no `enum`, `namespace`, parameter properties), `import type` for type-only imports, no imports from `src/` (SPEC section 4 boundary). Top-level `await` is fine here (ESM script, not bundled).
- Signing: `new SignatureV4({ service: 'lambda', region, credentials: defaultProvider(), sha256: Sha256 })` (`Sha256` from `@aws-crypto/sha256-js`, `defaultProvider` from `@aws-sdk/credential-provider-node`). Request object: `{ method: 'GET', protocol: 'https:', hostname, path, query: {}, headers: { host: hostname, 'x-amz-content-sha256': 'UNSIGNED-PAYLOAD' } }`. Set `x-amz-content-sha256` BEFORE signing (the signer does not add it; Lambda returns 403 without it). Send with global `fetch(url + path, { headers })`, passing the signed headers minus `host` (fetch sets the same Host from the URL).
- Checks: signed `/health` → 200 `{"status":"ok"}`; signed `/whoami` → 200 with `endpoint` `iam`, `authMode` `iam`, `subject` `null`; signed `/stream` → 200, content type starting `text/event-stream`, at least one `data: {"tick":n}` line with n consecutive from 1 (never a hard-coded count; do not name a variable `ticks` or `intervalMs`, because constraint `stream-tunables-only-in-config` scans `scripts/` and `let ticks = 0;` matches it; use `expected` or `n`); unsigned `GET /health` → 403. Print `PASS`/`FAIL <check>` per check; exit 1 if any failed.
- `package.json` adds `"smoke:iam": "bash -c 'source scripts/env.sh && node scripts/smoke-iam.ts \"$(stack_output \"$STACK_NAME\" IamEndpointUrl)\" \"$AWS_REGION\"'"`; keep every other script.
- `test/scripts.test.ts` may run `spawnSync(process.execPath, ['scripts/smoke-iam.ts'], { env: {} })` (no args, so it exits 2 before touching credentials or the network) and may read the file as text. It must not import `@aws-sdk/*` or create a client.
**Acceptance tests:** `test/scripts.test.ts`, inside `describe('scripts')`: `smoke-iam.ts prints usage and exits 2 without arguments` (this also proves Node can run the file), `smoke-iam.ts signs for service lambda and sets x-amz-content-sha256` (text checks for `service: 'lambda'` and `x-amz-content-sha256`), `package.json wires smoke:iam through env.sh`.
**Out of scope:** running the script against AWS; README.
**Verification:** `node scripts/smoke-iam.ts` prints usage and exits 2; `npm run typecheck && npm run lint && npm test`.
**Depends on:** P2-04

### P3-03: Write the README

**Goal:** Write `README.md` so a newcomer can understand, run locally, deploy, smoke-test and tear down the project.
**Files touched:** `README.md`, `test/readme.test.ts`
**Design constraints:**
- SPEC sections 1 (Overview and platform facts), 2 (goals, non-goals, issues #1–#4), 5 (config and parameters), 7 (commands), 8 (Phase 3 README contents).
- Sections, in order: what this is (one Web Function, one revision, endpoints `iam` (IamAuth, SigV4) and `public` (ApplicationManaged, Cognito JWT), fail-closed auth from `lambda-web-endpoint-name`); routes (`/health`, `/whoami`, `/stream`, with what `envId`/`requestCount` show); prerequisites (Node 24, AWS CLI v2, cfn-lint ≥ 1.58, AWS credentials; default Region us-west-2, override with `AWS_REGION`; stack name `STACK_NAME`, default `lwf`); local development (`npm ci`, `npm run dev`, the four curl checks from the phase 1 manual check); checks (`npm run typecheck`, `npm run lint`, `npm test`, `npm run build`, `cfn-lint infra/*.yaml`); deploy (`npm run deploy`, passing parameter overrides as `npm run deploy -- MaxEnvironments=4`); test (`npm run create-test-user -- <email>`, `npm run smoke:iam`, `npm run smoke:jwt -- <token>`, why IamAuth calls need `X-Amz-Content-SHA256`); observing environment reuse and logs in `/aws/lambda/web/<function-name>`; teardown (`npm run teardown`); configuration reference (both SPEC section 5 tables; mark `STREAM_TICKS`, `STREAM_INTERVAL_MS`, `MaxEnvironments`, `RateLimit` as starting guesses); cost notes (`MaxEnvironments` and `RateLimit` are cost caps applied to both endpoints, tear down when done); future experiments linking `https://github.com/deeheber/lambda-web-functions/issues/1` (canary), `/2` (MultiRegion), `/3` (VPC connector), `/4` (CloudFront + OAC, custom domain).
- Docs only state facts SPEC states; do not invent platform behaviour.
- `test/readme.test.ts` reads `README.md` and `package.json` as text only.
**Acceptance tests:** `test/readme.test.ts`, inside `describe('README.md')`: `documents every npm script` (every key of `package.json` `scripts` appears as `npm run <name>` or `npm test`), `links issues 1 to 4`, `lists the prerequisites` (Node 24, AWS CLI v2, cfn-lint).
**Out of scope:** any change to code, scripts or templates.
**Verification:** `npm run typecheck && npm run lint && npm test`.
**Depends on:** none

### P3-04: Push phase 3 and list the manual checks

**Goal:** Push the branch and record the phase 3 manual checks a human must run.
**Files touched:** `docs/PROGRESS.md`
**Design constraints:** SPEC section 8, Phase 3 manual check. Follow the phase-end protocol in CLAUDE.md.
**Acceptance tests:** none (no code changes).
**Out of scope:** running any smoke script, deploy or teardown; any code change.
**Verification:** `git push -u origin HEAD` succeeds. The progress log entry says `Manual check: NOT VERIFIED (human)` and lists:
- After `npm run deploy`: `npm run create-test-user -- <email>` prints an access token.
- `npm run smoke:iam` and `npm run smoke:jwt -- <token>` both exit 0.
- Calling `/whoami` several times on each endpoint shows a shared `envId` and a rising `requestCount` (the same environments serve both endpoints).
- Logs appear in `/aws/lambda/web/lwf-hello`.
- `npm run teardown` removes both stacks.
**Depends on:** none

## Spec issues

- CJS bundle vs ESM package (SPEC sections 4 and 7): with `"type": "module"` at the root, `node dist/index.js` (as `npm run dev` runs it) would load the CJS bundle as ESM and crash. Resolved by writing `dist/package.json` `{"type":"commonjs"}` in both `dev` and `build.sh`; the zip still holds only `index.js`.
- Import permissions table (SPEC section 4): `src/auth/jwt-verifier.ts` may import only `aws-jwt-verify`, yet it implements the `JwtVerifier` interface from `src/auth/types.ts`; `src/routes/whoami.ts` needs `AuthContext`. Resolved by allowing type-only imports of `src/auth/types.ts` and `src/config.ts` from any `src/` module (erased at build time).
- Principle 1 vs scripts (SPEC sections 3 and 4): scripts need a Region and stack outputs, and `npm run smoke:iam` takes no arguments. Resolved by `scripts/env.sh` (shell variables, not `process.env`) and passing the URL and Region to `smoke-iam.ts` as argv from the npm script.
- Smoke tests "→ N events" (SPEC section 4): N is `STREAM_TICKS`, which the scripts cannot know and principle 8 forbids repeating. Resolved: assert at least one event, numbered consecutively from 1.
- `UpdateReplacePolicy: Retain` alone fails cfn-lint 1.58 with W3011, and cfn-lint exits non-zero on warnings. Resolved: add `DeletionPolicy: Delete`, which matches SPEC's "deleting the function deletes all its revisions".
- Stack names are not specified. Resolved: `STACK_NAME` default `lwf` (function `lwf-hello`), artifacts stack `${STACK_NAME}-artifacts`, both overridable.
- `SystemLogLevel` is listed as a revision property but no value is given. Resolved: omit it (optional in the cfn-lint 1.58 schema).
- `parallel.setup` names `npm ci`, but the plan uses no streams, so `docs/kukulu.json` has no `parallel` block.
