# Lambda Web Functions Hello World

A TypeScript Express 5 app deployed with AWS SAM as two Web Functions running the same code:

- `lwf-iam`: endpoint `iam`, `AuthType: IamAuth`, `AUTH_MODE=iam`. Lambda checks the SigV4 signature; the app receives no caller identity.
- `lwf-public`: endpoint `public`, `AuthType: ApplicationManaged`, `AUTH_MODE=jwt`. The app verifies a Cognito access token (JWT) itself.

A missing or unknown `AUTH_MODE` stops the app at startup.

Start with the [learning walkthrough](docs/walkthrough.md).

Run all commands below from `examples/hello-world`:

```sh
cd examples/hello-world
```

## Routes

Both functions serve these routes after authentication:

| Route | Response |
|---|---|
| `GET /health` | `200 {"status":"ok"}` |
| `GET /whoami` | `200` with `authMode` (`iam` or `jwt`), `subject` (`null` on `iam`), `envId`, `startedAt`, `requestCount` |
| `GET /stream` | `200 text/event-stream`: `data: {"tick":n}` events, one per interval, then the response ends |
| anything else | `404 {"error":"not_found"}` |

In `jwt` mode, every route except `/health` requires `Authorization: Bearer <Cognito access token>`. Missing or invalid tokens return `401 {"error":"unauthorized"}` before routing, including for unknown paths. The deployed IAM endpoint requires signed requests for every path.

## Prerequisites

Node 24, AWS CLI v2, SAM CLI 1.170 or newer, and cfn-lint. AWS credentials are required only for deployment, test-user creation, deployment smoke tests, and teardown.

## Local development

```sh
npm ci
npm run dev          # iam mode on 127.0.0.1:3000
npm run dev:public   # jwt mode on 127.0.0.1:3001
```

Run the servers in separate terminals; stop each with Ctrl+C. Try:

```sh
curl -i localhost:3000/whoami      # 200, authMode: iam
curl -N localhost:3000/stream      # ticks arrive one at a time
curl -i localhost:3001/whoami      # 401, WWW-Authenticate: Bearer
curl -i localhost:3001/health      # 200
```

`dev:public` uses placeholder Cognito pool and client IDs, so protected routes reject tokens from your deployed pool. `/health` remains accessible without a token.

## Checks

[GitHub Actions](../../.github/workflows/checks.yml) runs these checks and the bundle test for PRs targeting `main`. To run the checks locally:

```sh
npm run typecheck
npm run lint
npm test
npm run build
cfn-lint template.yaml
```

These checks do not call AWS. Use `npm run build` rather than bare `sam build`: it adds the ESM package markers required to run the bundles.

`npm run test:bundle` builds and tests both packaged functions. It requires SAM and may need network access for uncached dependencies.

## Deploy

```sh
npm run deploy
```

Deployment and smoke scripts use `samconfig.toml`; the scripts override inherited
`AWS_REGION`. See the [shared-stack workflow](../../README.md#working-through-stages)
before switching stages.

## Test the deployment

```sh
npm run smoke:iam
npm run smoke:jwt:user -- you@example.com
```

Cognito self-service signup is disabled after deployment. `smoke:jwt:user` uses administrator APIs to create the user or reset its password. To use an existing token, run `npm run smoke:jwt -- "$TOKEN"`.

## Logs

Logs go to `/aws/lambda/web/lwf-iam` and `/aws/lambda/web/lwf-public`.

The app logs startup and unhandled errors, not each request. Log levels are
configured in `template.yaml`.

## Teardown

```sh
npm run teardown
```

Runs `sam delete --no-prompts` for the shared stack, including resources deployed
by a later stage. Use it when finished with the deployment, not to switch stages.

## Configuration and cost

App settings live in [src/config.ts](src/config.ts) and deployment parameters in [template.yaml](template.yaml); `MaxEnvironments` and `RateLimit` apply to each function separately.
