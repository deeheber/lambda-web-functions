# Lambda Web Functions Hello World

A TypeScript Express 5 hello world deployed with AWS SAM. Two Lambda Web Functions run the same code with different auth modes because SAM generates one endpoint per function:

- `lwf-iam`: endpoint `iam`, `AuthType: IamAuth`. Lambda checks the SigV4 signature. The app receives no caller identity.
- `lwf-public`: endpoint `public`, `AuthType: ApplicationManaged`. The app verifies a Cognito access token (JWT) itself.

The template sets `AUTH_MODE` to `iam` or `jwt`; missing or unknown values stop the app at startup.

## Routes

The same routes on both functions. In `jwt` mode, every route except `/health` needs `Authorization: Bearer <Cognito access token>`.

| Route | Response |
|---|---|
| `GET /health` | `200 {"status":"ok"}` |
| `GET /whoami` | `200` with `authMode` (`iam` or `jwt`), `subject` (`null` on `iam`), `envId`, `startedAt`, `requestCount` |
| `GET /stream` | `200 text/event-stream`: `data: {"tick":n}` events, one per interval, then the response ends |
| anything else | `404 {"error":"not_found"}` |

## Prerequisites

Node 24, AWS CLI v2, SAM CLI 1.170 or newer, cfn-lint, and AWS credentials.

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

Use the npm build/deploy commands so SAM can find the local esbuild dependency.

## Deploy

```sh
npm run deploy
```

`samconfig.toml` sets the stack name (`lwf`) and Region (`us-west-2`). SAM also manages a code bucket stack.

## Test the deployment

```sh
npm run smoke:iam
TOKEN=$(npm run --silent create-test-user -- you@example.com)
npm run smoke:jwt -- "$TOKEN"
```

The IAM smoke test signs requests and checks that unsigned calls return 403. The JWT smoke test checks access with and without a token. Replace `you@example.com` with your test email. `npm run create-test-user` creates the user or resets the existing user's password and returns a fresh token.

## Environment reuse

Call `/whoami` several times on each endpoint: while `envId` stays the same, `requestCount` rises (a new `envId` means a different environment served the call). The two functions have separate environments, so their `envId`s differ.

## Logs

Logs go to `/aws/lambda/web/lwf-iam` and `/aws/lambda/web/lwf-public`.

## Teardown

```sh
npm run teardown
```

Deletes the app stack, then empties and deletes the code bucket stack.

## Configuration and cost

See [src/config.ts](src/config.ts) for app configuration and [template.yaml](template.yaml) for deployment parameters. `MaxEnvironments` and `RateLimit` limit each function separately. Tear down when done experimenting.

## Future experiments

- [Canary or blue/green deploys](https://github.com/deeheber/lambda-web-functions/issues/1)
- [MultiRegion endpoints](https://github.com/deeheber/lambda-web-functions/issues/2)
- [VPC access (egress network connector)](https://github.com/deeheber/lambda-web-functions/issues/3)
- [CloudFront with origin access control, custom domain](https://github.com/deeheber/lambda-web-functions/issues/4)
