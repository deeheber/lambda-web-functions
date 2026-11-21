# Agent instructions

## Working boundaries

- Run commands that access AWS services or a deployed application only with explicit user approval.
- Stop any local dev servers you start before finishing.
- Tests must not call AWS services.

## Design decisions

- Preserve resource logical IDs where practical. Document resource removals and replacements.
- Never add an authentication bypass or disabled mode.
- Never use `lambda-web-*` headers for authentication or routing, or enable `X-Forwarded-Host` / Express `trust proxy` behavior.
- Define defaults once per stage. App defaults belong in `src/config.ts` and Lambda defaults in `template.yaml`.
- Keep the esbuild `createRequire` banner so bundled CommonJS dependencies can load Node built-ins.
