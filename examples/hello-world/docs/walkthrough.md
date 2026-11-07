# Hello-world learning walkthrough

Run commands from `examples/hello-world`. See the [README](../README.md) for
prerequisites, deployment, and cleanup.

## 1. Trace a local request

Start `npm run dev`. In a second terminal:

```sh
curl -i localhost:3000/health
curl -i localhost:3000/whoami
curl -N localhost:3000/stream
curl -i localhost:3000/missing
```

Follow [server.ts](../src/server.ts) → [app.ts](../src/app.ts) →
[authentication](../src/auth/index.ts) → [route handlers](../src/routes).

Observe: health and identity return JSON, stream events arrive over time, and
the unknown path returns 404. The authentication middleware runs before routing.

Question: where does each response originate, and what happens before its handler runs?

## 2. Map the deployment resources

Read [template.yaml](../template.yaml) alongside AWS's
[core concepts](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-how-it-works.html).
Find the two SAM Web Functions, their authentication types, environment variables,
and endpoint URL outputs.

Run `npm run build` and inspect `.aws-sam/build/template.yaml`. This is a local
build; it does not deploy. To see the expanded CloudFormation resource model,
inspect the processed template of a deployed stack in the CloudFormation console.
SAM source and local build templates may still contain SAM resources.

Observe: the deployed model has functions, immutable code/configuration revisions,
and endpoints that route requests to revisions. Compare that model with the SAM
shorthand in the source template.

Question: which settings belong to a revision, and which belong to an endpoint?

## 3. Compare authentication paths

Keep `npm run dev` running and start `npm run dev:public` in another terminal.

```sh
curl -i localhost:3000/whoami
curl -i localhost:3001/health
curl -i localhost:3001/whoami
curl -i localhost:3001/missing
curl -i localhost:3001/whoami -H 'Authorization: Bearer invalid'
```

Observe: local IAM mode accepts requests because AWS enforces signatures at the
deployed endpoint. JWT mode permits `/health`, but returns 401 for protected
routes without a valid token, including unknown paths. The local JWT command
uses placeholder Cognito IDs; use the deployment for successful token checks.

When ready to use AWS, follow the README's deployment and smoke-test steps.
`smoke:iam` compares signed and unsigned requests; `smoke:jwt:user` checks JWT
authentication. These commands access AWS.

Question: which failures are rejected by Lambda before reaching Express, and which
are rejected by the application? See AWS's
[access-control guide](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-access-control.html).

## 4. Observe reuse, concurrency, and streaming

With the local IAM server running, repeat `/whoami` calls. Then overlap two streams
and an identity request:

```sh
curl -N localhost:3000/stream &
curl -N localhost:3000/stream &
curl -s localhost:3000/whoami
wait
```

Observe: the server can respond while streams are open. Within the same process,
`envId` and `startedAt` stay fixed while `requestCount` increases. It includes health
checks and requests rejected by application authentication. Restart the server
and compare the identity again. This UUID identifies an application process;
it is not an AWS revision ID.

On a deployment, repeat sequential and overlapping requests using the endpoint's
required authentication. Group `/whoami` results by `envId`; different environments
have independent counters. You may see only one environment during a small test.
Local runs demonstrate process reuse and concurrent handling, not AWS scaling.

Question: what state is shared within one environment, and what must be stored
externally to survive replacement? Read AWS's
[environment lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-env-lifecycle.html)
and [scaling guide](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html).

Stop each local server with Ctrl+C. Record your observations before continuing
to the CloudFront stage using the [shared-stack workflow](../../../README.md#working-through-stages).
