# Lambda Web Functions Hello World

A TypeScript Express 5 app deployed as two AWS Lambda Web Functions defined with AWS SAM (`template.yaml`), both built from the same source: `iam` (`AuthType: IamAuth`) and `public` (`AuthType: ApplicationManaged`, Cognito JWT checked in-app). Each function learns its mode from `AUTH_MODE`. Source of truth: `docs/SPEC.md`.

## Principles

- [ ] `process.env` appears only in `src/config.ts`; `loadConfig(env = process.env)` takes the env as a parameter so tests pass plain objects.
- [ ] `AUTH_MODE` accepts exactly `iam` and `jwt` and is required. `loadConfig()` throws at startup on a missing or unknown value (fails closed). No "disabled", `none`, `off`, `skip` or default mode anywhere.
- [ ] `lambda-web-` appears nowhere in `src/` or `template.yaml` (case-insensitive, comments included). No `lambda-web-*` header is read for auth or routing.
- [ ] Only `src/auth/jwt-verifier.ts` imports `aws-jwt-verify`; the app gets a `JwtVerifier` through `createApp(config, deps)`, and tests pass a fake. The adapter's own tests use an injected JWKS and never fetch one.
- [ ] The only module-level mutable state in `src/` is `requestCount` in `src/env-info.ts`. Per-request data lives in locals or `res.locals`.
- [ ] `template.yaml` has no 12-digit account IDs and no Region literals; use `AWS::AccountId`, `AWS::Region`, `AWS::Partition`.
- [ ] Template invariant (`test/template.test.ts`): exactly two `AWS::Serverless::WebFunction` and no `AWS::Lambda::WebFunction*`; the `IamAuth` function has `AUTH_MODE: iam` and no Cognito vars; the `ApplicationManaged` function has `AUTH_MODE: jwt` plus `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID`.
- [ ] Every SPEC section 5 tunable has exactly one home with its default: a key in `src/config.ts` or a parameter in `template.yaml`.
- [ ] Nothing in `test/` and no check command calls the `aws` CLI, `sam deploy`, `sam delete`, or creates an AWS SDK client.
- [ ] Tests are written in the same task as the code they cover.

## Commands

- Install: `npm ci`
- Typecheck: `npm run typecheck` (`tsc --noEmit`)
- Lint: `npm run lint` (`eslint . --max-warnings 0`)
- Test: `npm test` (`vitest run`); one file: `npx vitest run <file>`
- Build: `npm run build` (`sam build` → `.aws-sam/build/{IamFunction,PublicFunction}/server.js`, CJS). Always through npm, never bare `sam build`: esbuild is a devDependency and only npm puts `node_modules/.bin` on `PATH`.
- Template lint: `cfn-lint template.yaml` (exits non-zero on warnings too)
- Manual only (never run by a task): `npm run dev` (iam, `127.0.0.1:3000`) and `npm run dev:public` (jwt, `127.0.0.1:3001`) never exit; `npm run deploy`, `npm run create-test-user -- <email>`, `npm run smoke:iam`, `npm run smoke:jwt -- <token>`, `npm run teardown` call AWS.

## Module map

| Path | Responsibility |
|---|---|
| `src/server.ts` | Entry point for both functions: `loadConfig()` → `createJwtVerifier()` only when `auth.mode === 'jwt'` → `createApp()` → listen; JSON `listening` line with `authMode`; SIGTERM → exit 0 within 1 s |
| `src/app.ts` | `createApp(config, deps)` with `AppDeps { verifier?: JwtVerifier }`: request counting, auth on every route, routes, `notFoundHandler`, `errorHandler` |
| `src/config.ts` | Only reader of `process.env`; typed, deeply frozen `Config`; exports `AuthConfig` = `{mode:'iam'}` \| `{mode:'jwt', cognito:{userPoolId, clientId}}`; throws on bad input |
| `src/env-info.ts` | `envId`, `startedAt`, `recordRequest()`, `getRequestCount()` |
| `src/auth/types.ts` | `AuthMode`, `AuthContext` (`authMode`, `subject`), `CognitoSettings`, `VerifiedToken`, `JwtVerifier`, `Jwks` (types only) |
| `src/auth/index.ts` | `authMiddleware(auth, verifier?)`: `iam` → pass, `subject = null`; `jwt` → `/health` passes, else Bearer access token or 401; throws at construction if `jwt` has no verifier |
| `src/auth/jwt-verifier.ts` | `createJwtVerifier(settings, jwks?)` over `CognitoJwtVerifier` (`tokenUse: "access"`, `clientId`); `jwks` pre-loads keys for offline tests |
| `src/routes/{health,whoami,stream}.ts` | `healthHandler`, `whoamiHandler`, `createStreamHandler(settings)` |
| `template.yaml` | SAM: Cognito pool + client, `IamFunction` and `PublicFunction` (`AWS::Serverless::WebFunction`), parameters, outputs |
| `samconfig.toml` | Stack `lwf`, Region `us-west-2`, `resolve_s3`, `CAPABILITY_IAM`, no changeset prompt |
| `scripts/env.sh` | Sourced: `STACK_NAME`, `AWS_REGION` (from `samconfig.toml`), `stack_output` |
| `scripts/create-test-user.sh`, `scripts/smoke-jwt.sh`, `scripts/smoke-iam.ts` | Manual smoke-test tooling |
| `test/` | vitest + supertest; reads `template.yaml`, `samconfig.toml` and `scripts/` as files only |

Boundaries: `src/` never imports from `scripts/` or `test/`; `scripts/` never imports from `src/`. Runtime imports follow the SPEC section 4 table; `import type` of `src/auth/types.ts` and `src/config.ts` is allowed from any `src/` module.

## Constraints

- No `process.env` outside `src/config.ts` in `src/`, `test/`, `scripts/`, `vitest.config.ts`, `eslint.config.js`.
- No `lambda-web-` in `src/` or `template.yaml`, any case, comments included.
- No auth bypass flag or `'none'`/`'off'`/`'skip'`/`'disabled'` mode string in `src/`.
- Every `AUTH_MODE` value in `template.yaml` is literally `iam` or `jwt`.
- No `AUTH_ENDPOINT_IAM`/`AUTH_ENDPOINT_JWT`, `iamEndpointName`, `jwtEndpointName` or `AuthEndpoints` anywhere.
- No `aws-jwt-verify` import or mock outside `src/auth/jwt-verifier.ts`.
- No top-level `let`/`var` or top-level `Map`/`Set`/`Array` instance in `src/` outside `src/env-info.ts`. Top-level object/array literals that get mutated: reviewer checks by reading.
- No `X-Forwarded-Host` and no `trust proxy` in `src/`.
- No `import.meta` in `src/`. No top-level `await` in `src/`: reviewer checks by reading, and the CJS build fails on it.
- Stream defaults (`5` ticks, `500` ms) only in `src/config.ts`; never set in scripts, `package.json`, `samconfig.toml` or `template.yaml`.
- Listen default `127.0.0.1:3000` only in `src/config.ts`; `package.json` never spells `3000`.
- No 12-digit numbers in `template.yaml`.
- No Region literals in `template.yaml`.
- `Timeout`, `MaxConcurrencyPerEnvironment`, `MaxEnvironments`, `RateLimit`, `ApplicationLogLevel` get values only from `template.yaml` parameter defaults; Resources use `!Ref`; no literal in `samconfig.toml`, `scripts/` or `package.json`, comments included.
- No AWS SDK import, SDK client, or spawned `aws`/`sam` command in `test/`.
- The `typecheck`, `lint`, `test` and `build` npm scripts never contain `aws`, `sam deploy`, `sam delete` or `sam sync`.
- No global npm install in `package.json`, `scripts/` or `README.md`.
- No `Globals` section in `template.yaml`; every Web Function property is written on each function: checked by `test/template.test.ts`.
- The deployed bundle is CommonJS (`Format: cjs`) and each `.aws-sam/build/<Id>/` holds only `server.js`: checked by `test/bundle.test.ts`.
- Relative imports use the `.ts` extension; type-only imports use `import type`; no `enum`, `namespace` or parameter properties (`erasableSyntaxOnly`): enforced by `tsc`.

## Gotchas

- `test/readme.test.ts` requires every npm script name to appear in README as `npm run <name>`; whoever adds a script documents it in the same task.
- `yaml`'s `parse(text, { logLevel: 'error' })` turns `!Ref X` into the string `'X'` and `!Sub …` into its literal string; `test/template.test.ts` compares against those strings.
- The CJS bundle crashes when run inside the repo (root `package.json` is `"type": "module"`): the dev scripts write `dist/package.json` `{"type":"commonjs"}`, and `test/bundle.test.ts` copies `server.js` to a temp dir before running it.
- `npm test` runs `npm run build` (the bundle test), so it needs the SAM CLI on `PATH` and npm network access; its `beforeAll` timeout is 300 s.
- `test/server.test.ts` runs `src/server.ts` directly with Node's type stripping, so `.ts` import extensions are required.
- ESLint forbids `any`; type parsed YAML/JSON as `Record<string, unknown>`-based interfaces and use `toMatchObject`/`toEqual`.
- On macOS, `sed -i` needs a suffix argument; prefer the Edit tool.

`docs/SPEC.md` wins over code comments.
