# Lambda Web Functions Hello World build progress

Branch: build/2026-10-31
Started: 2026-10-31T18:07:39.064Z

## Tasks

- [x] P1-01 Scaffold the package and typed config loader
- [x] P1-02 Add env-info and the Cognito JWT verifier adapter
- [x] P1-03 Add the fail-closed auth middleware
- [x] P1-04 Add createApp with the health, whoami and stream routes
- [x] P1-05 Add the server entry point with SIGTERM handling and npm run dev
- [x] P1-06 Push phase 1 and list the manual checks
- [x] P2-01 Add the artifacts bucket template
- [x] P2-02 Add the app template and the pairing invariant test
- [x] P2-03 Add the CJS bundle and zip build script
- [x] P2-04 Add the deploy and teardown scripts
- [x] P2-05 Push phase 2 and list the manual checks
- [x] P3-01 Add the test-user and JWT smoke scripts
- [x] P3-02 Add the SigV4 IAM smoke script
- [x] P3-03 Write the README
- [x] P3-04 Push phase 3 and list the manual checks

## Log

(one entry per task, appended by implement)

### P1-01 — e38af95

Tests: test/config.test.ts (13 incl. it.each). Interpretation: STREAM_INTERVAL_MS=0 accepted. Defaults are string constants DEFAULT_LISTEN/DEFAULT_STREAM_TICKS/DEFAULT_STREAM_INTERVAL_MS in src/config.ts. All deps installed (express, aws-jwt-verify, esbuild, yaml, supertest...). Vitest is v5.0.5.

### P1-02 — 89620db

Tests: env-info (3), jwt-verifier (3, fetch stubbed). No interpretation. Types in src/auth/types.ts as specified.

### P1-03 — 9e363c9

Tests: test/auth.test.ts (11). Interpretation: 'iam ' (trailing space) cannot be sent over HTTP (parser trims), so exact-match test uses 'IAM','iam2','Public'. Empty header treated as missing.

### P1-04 — 5a2c8a3

Tests: app.test.ts (11), stream.test.ts (4, real loopback server). notFoundHandler/errorHandler exported from src/app.ts. whoami uses res.locals.requestCount. Stream timing test allows 5ms slack (>=35 vs 40ms).

### P1-05 — 231d195

Tests: test/server.test.ts (5, spawns src/server.ts via native type stripping with literal env). Added dev script. Ran npm run dev and curled /whoami: 200. Test file uses import.meta (allowed in test/).

### P1-06 — 85977c5

Push: pushed origin build/2026-10-31.
Manual check: NOT VERIFIED (human)
- npm run dev, then curl -i -H 'lambda-web-endpoint-name: iam' localhost:3000/whoami -> 200, authMode "iam", subject null.
- curl -i -H 'lambda-web-endpoint-name: public' localhost:3000/whoami (no token) -> 401 with WWW-Authenticate: Bearer.
- curl -i localhost:3000/whoami (no header) -> 401.
- curl -N -H 'lambda-web-endpoint-name: iam' localhost:3000/stream -> ticks arrive one at a time, then response ends.
(Empty commit used so the task commit subject matches.)

### P2-01 — 1989238

Tests: infra.test.ts artifacts describe (4). cfn-lint exit 0. Lint forbids explicit any, so template type uses Record<string, unknown> and toMatchObject; P2-02 should do likewise.

### P2-02 — 60643b9

Tests: infra.test.ts app describe (9). cfn-lint exit 0. Parameter Descriptions for MaxEnvironments/RateLimit begin "ASSUMPTION - ". Revision has DeletionPolicy Delete + UpdateReplacePolicy Retain.

### P2-03 — 6aaebe6

Tests: bundle.test.ts (4) builds into a temp dir, unzips, runs the bundle. npm run build verified: zip lists only index.js. Build verify command now active.

### P2-04 — 6f2d508

Tests: scripts.test.ts (3; bash -n only). Note: constraint infra-tunables-are-parameters scans scripts too, so comments in deploy.sh must not write "MaxEnvironments=4" style text. Later scripts/test (P3) must also avoid tunable=value text.

### P2-05 — 4421a03

Push: pushed origin build/2026-10-31.
Manual check: NOT VERIFIED (human)
- npm run deploy succeeds in us-west-2 (AWS credentials set; cfn-lint >= 1.58 installed).
- In the Lambda console the function lwf-hello shows one revision and two Active endpoints: iam (IAM auth) and public (application managed).

### P3-01 — 669bed2

Tests: scripts.test.ts +3. Usage check runs before sourcing env.sh. Existing-user case: admin-create-user failure is tolerated with a stderr note. Scripts never run (need AWS).

### P3-02 — d6ea711

Tests: scripts.test.ts +3. Added dev deps @smithy/signature-v4, @aws-crypto/sha256-js, @aws-sdk/credential-provider-node. Script not run against AWS; usage path verified (exit 2). JSON responses cast to a local Json interface for tsc.

### P3-03 — 7d0ee66

Tests: readme.test.ts (3). README has all required sections; README is not scanned by constraints so it shows the deploy override example.

### P3-04 — f6ff275

Push: pushed origin build/2026-10-31.
Manual check: NOT VERIFIED (human)
- After npm run deploy: npm run create-test-user -- <email> prints an access token.
- npm run smoke:iam and npm run smoke:jwt -- <token> both exit 0.
- Calling /whoami several times on each endpoint shows a shared envId and a rising requestCount (same environments serve both endpoints).
- Logs appear in /aws/lambda/web/lwf-hello.
- npm run teardown removes both stacks.
