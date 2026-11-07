# Hello world

An Express 5 app deployed with SAM as two Web Functions running the same code:

| Function | Authentication |
|---|---|
| `lwf-iam` | Lambda verifies signed requests; the app receives no caller identity. |
| `lwf-public` | The app verifies a Cognito access token. `/health` needs no token. |

Use the [walkthrough](docs/walkthrough.md) for exercises. This README is the command reference.
Run commands from `examples/hello-world`.

## Run locally

Requires Node 24. From the repository root:

```sh
cd examples/hello-world
npm ci
npm run dev          # IAM mode on localhost:3000
```

In another terminal, from the same folder:

```sh
npm run dev:public   # JWT mode on localhost:3001
```

Stop servers with Ctrl+C. Local IAM mode does not enforce AWS signatures.
Local JWT mode uses placeholder Cognito IDs; use a deployment to test valid tokens.

## Routes

| GET route | Response |
|---|---|
| `/health` | `200 {"status":"ok"}` |
| `/whoami` | Authentication, process identity, start time, and request count |
| `/stream` | A finite stream of `data: {"tick":n}` events |
| Other paths | `404 {"error":"not_found"}` |

On the deployed IAM endpoint, every request requires a signature. In JWT mode,
all paths except `/health` require `Authorization: Bearer <access-token>`;
missing or invalid tokens return 401 before routing, including for unknown paths.

## Check locally

Build and template checks require SAM CLI 1.170+ and cfn-lint. No AWS credentials
are needed. [CI](../../.github/workflows/checks.yml) runs:

```sh
npm run typecheck
npm run lint
npm test
npm run test:bundle   # builds and tests both packaged functions
cfn-lint template.yaml
```

Use `npm run build` for a build alone. Bare `sam build` omits required ESM package
markers. Uncached build dependencies may need network access.

## Deploy and test on AWS

Requires AWS CLI v2 and credentials. The commands below access AWS.

The IAM smoke test also needs [`lambda:InvokeWebFunctionEndpoint` permission](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-access-control.html);
a valid signature without permission still returns 403.

```sh
npm run deploy
npm run smoke:iam
npm run smoke:jwt:user -- you@example.com
```

Commands use `samconfig.toml`; smoke scripts override inherited `AWS_REGION`.
Read the [shared-stack workflow](../../README.md#working-through-stages) before switching stages.

`smoke:jwt:user` creates a Cognito user or resets its password. Self-service signup
is disabled. With an existing token, use `npm run smoke:jwt -- "$TOKEN"`.

## Logs and configuration

Logs: `/aws/lambda/web/lwf-iam` and `/aws/lambda/web/lwf-public`.
The app logs startup and unhandled errors, not each request.

App settings: [src/config.ts](src/config.ts). Deployment settings and log levels:
[template.yaml](template.yaml). Environment and rate limits apply to each function separately.
A missing or invalid `AUTH_MODE` stops startup.

## Clean up

```sh
npm run teardown
```

Deletes the shared AWS stack without prompting, including any later stage's resources.

CloudWatch log groups remain, with no expiry by default. If you no longer need
the logs, delete both functions' groups and their `.local` companions (Bash):

```bash
source scripts/env.sh
for name in iam public; do
  for suffix in '' .local; do
    aws logs delete-log-group --region "$AWS_REGION" \
      --log-group-name "/aws/lambda/web/${STACK_NAME}-${name}${suffix}"
  done
done
```
