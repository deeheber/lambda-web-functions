# Lambda Web Functions Hello World

A TypeScript Express 5 hello world deployed with AWS SAM as two Lambda Web Functions that run the same code (SAM generates one endpoint per function):

- `lwf-iam`: endpoint `iam`, `AuthType: IamAuth`, `AUTH_MODE=iam`. Lambda checks the SigV4 signature; the app receives no caller identity.
- `lwf-public`: endpoint `public`, `AuthType: ApplicationManaged`, `AUTH_MODE=jwt`. The app verifies a Cognito access token (JWT) itself.

A missing or unknown `AUTH_MODE` stops the app at startup.

## Routes

The same routes on both functions. In `jwt` mode, every route except `/health` needs `Authorization: Bearer <Cognito access token>`.

| Route | Response |
|---|---|
| `GET /health` | `200 {"status":"ok"}` |
| `GET /whoami` | `200` with `authMode` (`iam` or `jwt`), `subject` (`null` on `iam`), `envId`, `startedAt`, `requestCount` |
| `GET /stream` | `200 text/event-stream`: `data: {"tick":n}` events, one per interval, then the response ends |
| anything else | `404 {"error":"not_found"}` |

In `jwt` mode, missing or invalid tokens return `401 {"error":"unauthorized"}` before routing, including for unknown paths. `/health` is exempt from the app's JWT check; the deployed IAM endpoint still requires signed requests for every path.

## Prerequisites

Node 24, AWS CLI v2, SAM CLI 1.170 or newer, and cfn-lint. AWS credentials are required only for deployment, test-user creation, deployment smoke tests, and teardown.

## Local development

```sh
npm ci
npm run dev          # iam mode on 127.0.0.1:3000
npm run dev:public   # jwt mode on 127.0.0.1:3001
```

In another terminal:

```sh
curl -i localhost:3000/whoami      # 200, authMode: iam
curl -N localhost:3000/stream      # ticks arrive one at a time
curl -i localhost:3001/whoami      # 401, WWW-Authenticate: Bearer
curl -i localhost:3001/health      # 200
```

`dev:public` uses placeholder Cognito pool and client IDs, so protected routes reject tokens from your deployed pool. `/health` remains accessible without a token.

## Checks

[GitHub Actions](.github/workflows/checks.yml) runs these checks and the bundle test when a PR targeting `main` is opened, reopened, or updated with new commits. To run the checks locally:

```sh
npm run typecheck
npm run lint
npm test
npm run build
cfn-lint template.yaml
```

None of these call AWS. Build and deploy through npm (not bare `sam`) so SAM finds the local esbuild.

`npm test` runs the regular tests without building. Run `npm run test:bundle` separately to build and check that the packaged app serves `/health`. This requires the SAM CLI, may need network access to install uncached dependencies, and can take several minutes.

## Deploy

```sh
npm run deploy
```

`samconfig.toml` sets the stack name (`lwf`) and Region (`us-west-2`).

The test-user and deployment smoke scripts read these same settings, overriding any inherited `AWS_REGION`.

## Test the deployment

```sh
npm run smoke:iam
npm run smoke:jwt:user -- you@example.com
```

`smoke:jwt:user` creates the user or resets its password. To use an existing token, run `npm run smoke:jwt -- "$TOKEN"`.

## Environment reuse

Call `/whoami` repeatedly to see which environment handles each request. `envId` and `startedAt` stay fixed within an environment, while `requestCount` counts all requests handled there, including health checks and requests rejected by app authentication. Requests can reach different environments, so counts across responses need not increase. Each function has its own environments.

## Logs

Logs go to `/aws/lambda/web/lwf-iam` and `/aws/lambda/web/lwf-public`.

The template defaults to application log level `INFO` and system log level `WARN`, controlled by the `ApplicationLogLevel` and `SystemLogLevel` parameters. The app logs startup and unhandled errors; it does not log each request.

## Teardown

```sh
npm run teardown
```

Runs `sam delete --no-prompts` for the configured stack.

## Configuration and cost

App settings live in [src/config.ts](src/config.ts) and deployment parameters in [template.yaml](template.yaml); `MaxEnvironments` and `RateLimit` apply to each function separately.

`STREAM_TICKS` and `STREAM_INTERVAL_MS` control the number and spacing of stream events. JWT mode also requires `COGNITO_USER_POOL_ID` and `COGNITO_CLIENT_ID`; the template supplies both from the Cognito resources it creates.

## Future experiments

- [Canary or blue/green deploys](https://github.com/deeheber/lambda-web-functions/issues/1)
- [MultiRegion endpoints](https://github.com/deeheber/lambda-web-functions/issues/2)
- [VPC access (egress network connector)](https://github.com/deeheber/lambda-web-functions/issues/3)
- [CloudFront with origin access control, custom domain](https://github.com/deeheber/lambda-web-functions/issues/4)
