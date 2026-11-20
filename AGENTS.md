# Agent instructions

## Working boundaries

- Run commands that access AWS services or a deployed application only with explicit user approval.
- Stop any local dev servers you start before finishing.
- Tests must not call AWS services. Use fakes or injected JWKS for authentication tests.
- Remove the CloudFront association before deleting its separate certificate stack.

## Design decisions

- Preserve resource logical IDs where practical; document resource removals and replacements.
- Never add an authentication bypass, disabled mode, or fallback for missing or invalid `AUTH_MODE`.
- Never use `lambda-web-*` headers for authentication or routing, or enable `X-Forwarded-Host` / Express `trust proxy` behavior.
- Define each tunable's default once per stage: app settings in `src/config.ts`, Lambda settings in `template.yaml`. Do not repeat defaults in scripts or other configuration files.

## Bundle pitfalls

- Build and deploy through `npm run build` and `npm run deploy`. Bare `sam build` omits the package markers needed to run the ESM bundles.
- Keep the esbuild `createRequire` banner: bundled CommonJS dependencies need it to load Node built-ins.
