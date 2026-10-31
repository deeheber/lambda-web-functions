# Lambda Web Functions Hello World

One Express 5 app, deployed by SAM (`template.yaml`) as two Lambda Web Functions: `IamFunction` (`AuthType: IamAuth`, `AUTH_MODE=iam`) and `PublicFunction` (`AuthType: ApplicationManaged`, `AUTH_MODE=jwt`, Cognito access token checked in the app).

## Commands

- Checks: `npm run typecheck`, `npm run lint`, `npm test`, `cfn-lint template.yaml` (cfn-lint fails on warnings too).
- Build with `npm run build`, never bare `sam build`: esbuild is a devDependency and only npm puts it on `PATH`.
- `npm test` includes `test/bundle.test.ts`, which runs `npm run build`. It needs the SAM CLI and network and is slow (300 s `beforeAll`).
- Never run these yourself: `npm run dev` / `dev:public` (they never exit) and `deploy`, `teardown`, `create-test-user`, `smoke:iam`, `smoke:jwt` (they call AWS).

## Design rules

- `process.env` is read only in `src/config.ts`. `loadConfig(env)` takes the env as a parameter, so tests pass plain objects.
- `AUTH_MODE` is `iam` or `jwt` with no default. Never add a bypass, `none`/`off`/`disabled` mode, or a fallback.
- Never read `lambda-web-*` headers for auth or routing. Never use `X-Forwarded-Host` or `trust proxy`.
- Only `src/auth/jwt-verifier.ts` imports `aws-jwt-verify`. The app gets a `JwtVerifier` through `createApp(config, deps)`, and tests inject a fake. Verifier tests use an injected JWKS and never fetch one.
- The only module-level mutable state is `requestCount` in `src/env-info.ts`.
- No `import.meta` and no top-level `await` in `src/`: the deployed bundle is CJS.
- Each tunable has one home with its default: `src/config.ts` (app settings) or a `template.yaml` parameter (Lambda settings). Never repeat defaults in `package.json`, `samconfig.toml` or `scripts/`.
- Tests never call AWS: no SDK clients, no `aws`/`sam deploy` commands.

## Gotchas

- `test/readme.test.ts` requires every npm script to appear in README as `npm run <name>`.
- `yaml`'s `parse` turns `!Ref X` into `'X'` and `!Sub …` into its literal string. `test/template.test.ts` compares against those strings.
- The CJS bundle crashes inside the repo (root `package.json` is `"type": "module"`).
- `test/server.test.ts` runs `src/server.ts` with Node type stripping, so relative imports need `.ts` extensions.
