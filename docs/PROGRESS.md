# Lambda Web Functions Hello World build progress

Branch: build/2026-10-31
Started: 2026-10-31T19:05:25.860Z

## Tasks

- [x] P1-01 Switch auth to AUTH_MODE across config, middleware, app and server
- [x] P1-02 Add dev and dev:public scripts
- [x] P1-03 Phase 1 end: push and list manual checks
- [x] P2-01 Add the SAM template, samconfig and sam build
- [ ] P2-02 Wire deploy and teardown to the SAM CLI and delete the 0.1 build
- [ ] P2-03 Phase 2 end: push and list manual checks
- [ ] P3-01 Update the smoke and test-user scripts for the SAM stack
- [ ] P3-02 Rewrite the README and confirm the CLAUDE.md module map
- [ ] P3-03 Phase 3 end: push and list manual checks

## Log

(one entry per task, appended by implement)

### P1-01 — dcb794f

AUTH_MODE union in config (AuthConfig exported), authMiddleware(auth, verifier?) throws at construction in jwt without verifier, whoami drops endpoint, server builds verifier only in jwt mode. All 12 files updated; tests green.

### P1-02 — f4f6ba5

dev (iam) and dev:public (jwt, 127.0.0.1:3001) scripts added; README local-dev and config table updated (line 11 header prose left for P3-02). Tests added in scripts.test.ts.

### P1-03 — df67a4a

Push: done (origin build/2026-10-31).
Manual check: NOT VERIFIED (human)
- `npm run dev`, then `curl localhost:3000/whoami` -> 200 with authMode: iam, subject: null.
- `curl -N localhost:3000/stream` -> ticks arrive one at a time.
- `npm run dev:public`, then `curl -i localhost:3001/whoami` -> 401 with WWW-Authenticate: Bearer; `curl -i localhost:3001/health` -> 200.
- Starting with AUTH_MODE=none fails at startup.

### P2-01 — c335bd9

template.yaml, samconfig.toml, .aws-sam/ ignored (git + eslint), build = sam build. cfn-lint and sam build pass; both build dirs contain server.js. Tests: template.test.ts, scripts.test.ts additions.
