# Agent instructions

## Working boundaries

- Do not run `deploy`, `teardown`, `create-test-user`, `smoke:iam`, or `smoke:jwt` unless explicitly requested; they access AWS.
- Stop any local dev servers you start before finishing.
- Tests must not call AWS services. Use fakes or injected JWKS for authentication tests.

## Design decisions

- Never add an authentication bypass, disabled mode, or fallback for missing or invalid `AUTH_MODE`.
- Never use `lambda-web-*` headers for authentication or routing, or enable `X-Forwarded-Host` / Express `trust proxy` behavior.
- Keep each tunable's default in one place: `src/config.ts` for app settings or a `template.yaml` parameter for Lambda settings. Do not repeat defaults in scripts or other configuration files.

## Bundle pitfalls

- Keep `src/` compatible with the deployed CommonJS bundle: no `import.meta` or top-level `await`.
- To run the SAM-built `server.js` locally, copy it outside the repository's ESM package scope, as `test/bundle.test.ts` does. The dev scripts already create their own CommonJS package boundary.
