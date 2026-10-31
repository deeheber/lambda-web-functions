# Lambda Web Functions Hello World build progress

Branch: build/2026-10-31
Started: 2026-10-31T19:05:25.860Z

## Tasks

- [x] P1-01 Switch auth to AUTH_MODE across config, middleware, app and server
- [ ] P1-02 Add dev and dev:public scripts
- [ ] P1-03 Phase 1 end: push and list manual checks
- [ ] P2-01 Add the SAM template, samconfig and sam build
- [ ] P2-02 Wire deploy and teardown to the SAM CLI and delete the 0.1 build
- [ ] P2-03 Phase 2 end: push and list manual checks
- [ ] P3-01 Update the smoke and test-user scripts for the SAM stack
- [ ] P3-02 Rewrite the README and confirm the CLAUDE.md module map
- [ ] P3-03 Phase 3 end: push and list manual checks

## Log

(one entry per task, appended by implement)

### P1-01 — dcb794f

AUTH_MODE union in config (AuthConfig exported), authMiddleware(auth, verifier?) throws at construction in jwt without verifier, whoami drops endpoint, server builds verifier only in jwt mode. All 12 files updated; tests green.
