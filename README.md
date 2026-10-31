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

## Prerequisites

Node 24, AWS CLI v2, SAM CLI 1.170 or newer, and cfn-lint. AWS credentials are required only for deployment, test-user creation, smoke tests, and teardown.

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

The local `public` server rejects every token, which is expected.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
cfn-lint template.yaml
```

None of these call AWS. Build and deploy through npm (not bare `sam`) so SAM finds the local esbuild.

## Deploy

```sh
npm run deploy
```

`samconfig.toml` sets the stack name (`lwf`) and Region (`us-west-2`).

## Test the deployment

```sh
npm run smoke:iam
TOKEN=$(npm run --silent create-test-user -- you@example.com)
npm run smoke:jwt -- "$TOKEN"
```

`npm run create-test-user` creates the user (or resets its password) and prints a fresh access token. `npm run smoke:iam` signs requests and checks that unsigned calls get 403. `npm run smoke:jwt` checks access with and without the token.

## Environment reuse

Call `/whoami` repeatedly: `requestCount` rises while `envId` stays the same, and a new `envId` means a different environment answered. Each function has its own environments.

## Logs

Logs go to `/aws/lambda/web/lwf-iam` and `/aws/lambda/web/lwf-public`.

## Teardown

```sh
npm run teardown
```

Deletes the app stack, then empties and deletes the code bucket stack SAM created on the first deploy.

## Configuration and cost

App settings live in [src/config.ts](src/config.ts) and deployment parameters in [template.yaml](template.yaml); `MaxEnvironments` and `RateLimit` apply to each function separately.

## Future experiments

- [Canary or blue/green deploys](https://github.com/deeheber/lambda-web-functions/issues/1)
- [MultiRegion endpoints](https://github.com/deeheber/lambda-web-functions/issues/2)
- [VPC access (egress network connector)](https://github.com/deeheber/lambda-web-functions/issues/3)
- [CloudFront with origin access control, custom domain](https://github.com/deeheber/lambda-web-functions/issues/4)
