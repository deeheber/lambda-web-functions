# Lambda Web Functions Hello World

A TypeScript Express 5 app deployed as **two AWS Lambda Web Functions**, defined with AWS SAM. It is a learning reference: a hello world to build more complex things from.

SAM generates one endpoint per Web Function, so the two auth styles live in two functions that run the same code:

- `lwf-iam`: endpoint `iam`, `AuthType: IamAuth`. Lambda checks the SigV4 signature. The app receives no caller identity.
- `lwf-public`: endpoint `public`, `AuthType: ApplicationManaged`. The app verifies a Cognito access token (JWT) itself.

The auth mode comes from the `AUTH_MODE` environment variable (`iam` or `jwt`) that the template sets on each function. It **fails closed**: a missing or unknown `AUTH_MODE` stops the app at startup, and in `jwt` mode a missing or invalid token returns 401.

## Routes

The same routes on both functions. In `jwt` mode, every route except `/health` needs `Authorization: Bearer <Cognito access token>`.

| Route | Response |
|---|---|
| `GET /health` | `200 {"status":"ok"}` |
| `GET /whoami` | `200` with `authMode` (`iam` or `jwt`), `subject` (`null` on `iam`), `envId`, `startedAt`, `requestCount` |
| `GET /stream` | `200 text/event-stream`: `data: {"tick":n}` events, one per interval, then the response ends |
| anything else | `404 {"error":"not_found"}` |

`envId` and `requestCount` show environment reuse: one environment serves many requests, so repeated calls return the same `envId` and a rising `requestCount`. `/stream` shows native HTTP streaming.

## Prerequisites

- Node 24
- AWS CLI v2
- SAM CLI 1.170 or newer
- cfn-lint
- AWS credentials (for deploy, test user and smoke tests)

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

None of these commands call AWS.

Always build through `npm run build` or `npm run deploy`, never `sam build` directly. esbuild is a devDependency, and only npm puts `node_modules/.bin` on the `PATH`, so a bare `sam build` fails with "Cannot find esbuild".

## Deploy

```sh
npm run deploy
```

This runs `sam build && sam deploy`. `samconfig.toml` holds the stack name `lwf` and the Region `us-west-2`. The first deploy also creates a code bucket stack named `lwf-<hash>-WebFunctionCode`, which SAM manages for you.

## Test the deployment

```sh
npm run smoke:iam
TOKEN=$(npm run --silent create-test-user -- you@example.com)
npm run smoke:jwt -- "$TOKEN"
```

- `npm run smoke:iam` signs requests with SigV4 (service `lambda`, the endpoint's Region) and checks every route. `IamAuth` calls need an `X-Amz-Content-SHA256` header (the payload hash, or `UNSIGNED-PAYLOAD`); without it Lambda returns 403. It also checks that an unsigned request gets 403.
- `npm run create-test-user -- <email>` creates a Cognito user and prints an access token on stdout.
- `npm run smoke:jwt -- <token>` checks the `public` endpoint with and without a token.

## Environment reuse

Call `/whoami` several times on each endpoint: `envId` stays the same and `requestCount` rises. The two functions have separate environments, so their `envId`s differ.

## Logs

Logs go to `/aws/lambda/web/lwf-iam` and `/aws/lambda/web/lwf-public`.

## Teardown

```sh
npm run teardown
```

Deletes the app stack, then empties and deletes the code bucket stack.

## Configuration reference

App config (`src/config.ts`), the only reader of `process.env`:

| Env var | Key | Default | Notes |
|---|---|---|---|
| `AWS_LAMBDA_HTTP_ENDPOINT` | `listen.host`, `listen.port` | `127.0.0.1:3000` | Set by Lambda. The default is for local dev only |
| `AUTH_MODE` | `auth.mode` | required | `iam` or `jwt`; anything else fails at startup |
| `COGNITO_USER_POOL_ID` | `auth.cognito.userPoolId` | required when `jwt` | Ignored when `iam` |
| `COGNITO_CLIENT_ID` | `auth.cognito.clientId` | required when `jwt` | Ignored when `iam` |
| `STREAM_TICKS` | `stream.ticks` | `5` | Starting guess |
| `STREAM_INTERVAL_MS` | `stream.intervalMs` | `500` | Starting guess |

Template parameters (`template.yaml`):

| Parameter | Default | Notes |
|---|---|---|
| `TimeoutSeconds` | `30` | 3 to 900 |
| `MaxConcurrencyPerEnvironment` | `64` | 1 to 128 |
| `MaxEnvironments` | `2` | Starting guess. Cost cap per function. Minimum 2 |
| `RateLimit` | `100` | Starting guess. Requests per second per endpoint, 100 to 1000 in steps of 100 |
| `ApplicationLogLevel` | `INFO` | `TRACE` to `FATAL` |

## Cost notes

`MaxEnvironments` and `RateLimit` are cost caps for experimenting. They apply to each function, so there are two sets of environments. Tear the stacks down when you are done.

## Future experiments

- [Canary or blue/green deploys](https://github.com/deeheber/lambda-web-functions/issues/1)
- [MultiRegion endpoints](https://github.com/deeheber/lambda-web-functions/issues/2)
- [VPC access (egress network connector)](https://github.com/deeheber/lambda-web-functions/issues/3)
- [CloudFront with origin access control, custom domain](https://github.com/deeheber/lambda-web-functions/issues/4)
