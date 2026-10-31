# Lambda Web Functions Hello World

A TypeScript Express 5 app deployed as **one AWS Lambda Web Function with two endpoints**, defined in plain CloudFormation. It is a learning reference: a hello world to build more complex things from.

- One `AWS::Lambda::WebFunction`, one `AWS::Lambda::WebFunctionRevision`, two `HomeRegion` endpoints, each sending 100% of traffic to that revision.
- `iam` endpoint: `IamAuth`. Lambda checks the SigV4 signature. The app receives no caller identity.
- `public` endpoint: `ApplicationManaged`. The app verifies a Cognito access token (JWT) itself.
- Auth is chosen per request from the `lambda-web-endpoint-name` header, which Lambda sets and clients cannot forge. It **fails closed**: a missing or unknown endpoint name returns 401.

## Routes

Identical on both endpoints. Every request needs a known endpoint name. On `public`, every route except `/health` also needs `Authorization: Bearer <Cognito access token>`.

| Route | Response |
|---|---|
| `GET /health` | `200 {"status":"ok"}` |
| `GET /whoami` | `200` with `endpoint`, `authMode` (`iam` or `jwt`), `subject` (`null` on `iam`), `envId`, `startedAt`, `requestCount` |
| `GET /stream` | `200 text/event-stream`: `data: {"tick":n}` events, one per interval, then the response ends |
| anything else | `404 {"error":"not_found"}` |

`envId` and `requestCount` show environment reuse: one environment serves many requests, so repeated calls return the same `envId` and a rising `requestCount`. `/stream` shows native HTTP streaming.

## Prerequisites

- Node 24
- AWS CLI v2
- cfn-lint 1.58 or newer
- AWS credentials (for deploy, test user and smoke tests)

The default Region is `us-west-2`; override it with `AWS_REGION`. The stack name is `STACK_NAME` (default `lwf`); the artifacts stack is `<STACK_NAME>-artifacts`.

## Local development

```sh
npm ci
npm run dev
```

In another terminal:

```sh
curl -i -H 'lambda-web-endpoint-name: iam' localhost:3000/whoami      # 200
curl -i -H 'lambda-web-endpoint-name: public' localhost:3000/whoami   # 401, WWW-Authenticate: Bearer
curl -i localhost:3000/whoami                                          # 401
curl -N -H 'lambda-web-endpoint-name: iam' localhost:3000/stream      # ticks arrive one at a time
```

Locally the `public` path rejects every token, which is expected.

## Checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
cfn-lint infra/*.yaml
```

`npm run build` bundles `src/server.ts` to a CommonJS `dist/index.js` and zips it as `dist/app.zip` (only `index.js`, at the zip root), then prints the sha256. The bundle must be CommonJS because the zip has no `package.json`.

None of these commands call AWS.

## Deploy

```sh
npm run deploy
```

This builds, deploys `infra/artifacts.yaml`, uploads the zip as `app-<sha256>.zip`, deploys `infra/app.yaml` and prints the stack outputs. Override stack parameters by passing `Name=Value` arguments:

```sh
npm run deploy -- MaxEnvironments=4
```

## Test the deployment

```sh
npm run smoke:iam
TOKEN=$(npm run --silent create-test-user -- you@example.com)
npm run smoke:jwt -- "$TOKEN"
```

- `npm run smoke:iam` signs requests with SigV4 (service `lambda`, the endpoint's Region) and checks every route. Lambda requires an `X-Amz-Content-SHA256` header on `IamAuth` calls (the payload hash, or `UNSIGNED-PAYLOAD`); without it Lambda returns 403. It also checks that an unsigned request gets 403.
- `npm run create-test-user -- <email>` creates a Cognito user and prints an access token on stdout.
- `npm run smoke:jwt -- <token>` checks the `public` endpoint with and without a token.

To see environment reuse, call `/whoami` several times on each endpoint: the `envId` stays the same and `requestCount` rises. Logs go to `/aws/lambda/web/<function-name>`.

## Teardown

```sh
npm run teardown
```

Deletes the app stack, empties the bucket and deletes the artifacts stack.

## Configuration reference

App config (`src/config.ts`), the only reader of `process.env`:

| Env var | Key | Default | Notes |
|---|---|---|---|
| `AWS_LAMBDA_HTTP_ENDPOINT` | `listen.host`, `listen.port` | `127.0.0.1:3000` | Set by Lambda. The default is for local dev only |
| `AUTH_ENDPOINT_IAM` | `auth.iamEndpointName` | required | `iam` in the template |
| `AUTH_ENDPOINT_JWT` | `auth.jwtEndpointName` | required | `public` in the template. Must differ from the IAM name |
| `COGNITO_USER_POOL_ID` | `auth.cognito.userPoolId` | required | |
| `COGNITO_CLIENT_ID` | `auth.cognito.clientId` | required | |
| `STREAM_TICKS` | `stream.ticks` | `5` | Starting guess |
| `STREAM_INTERVAL_MS` | `stream.intervalMs` | `500` | Starting guess |

Stack parameters (`infra/app.yaml`):

| Parameter | Default | Notes |
|---|---|---|
| `CodeBucket` | none | From the artifacts stack |
| `CodeKey` | none | `app-<sha256>.zip`. A new key means a new revision |
| `TimeoutSeconds` | `30` | 3 to 900 |
| `MaxConcurrencyPerEnvironment` | `64` | 1 to 128 |
| `MaxEnvironments` | `2` | Starting guess. Cost cap. Minimum 2 |
| `RateLimit` | `100` | Starting guess. Requests per second per endpoint, 100 to 1000 in steps of 100 |
| `ApplicationLogLevel` | `INFO` | `TRACE` to `FATAL` |

## Cost notes

`MaxEnvironments` and `RateLimit` are cost caps for experimenting, applied to both endpoints. Tear the stacks down when you are done.

## Future experiments

- [Canary or blue/green deploys](https://github.com/deeheber/lambda-web-functions/issues/1)
- [MultiRegion endpoints](https://github.com/deeheber/lambda-web-functions/issues/2)
- [VPC access (egress network connector)](https://github.com/deeheber/lambda-web-functions/issues/3)
- [CloudFront with origin access control, custom domain](https://github.com/deeheber/lambda-web-functions/issues/4)
