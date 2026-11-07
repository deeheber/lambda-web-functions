# Hello-world walkthrough

Follow the [README](../README.md) to install dependencies and start local IAM mode.
Run the requests below in another terminal.

## 1. Trace a request

```sh
curl -i localhost:3000/health
curl -i localhost:3000/whoami
curl -N localhost:3000/stream
curl -i localhost:3000/missing
```

Follow [server.ts](../src/server.ts) → [app.ts](../src/app.ts) →
[authentication](../src/auth/index.ts) → [routes](../src/routes).

Expect JSON responses, stream events arriving over time, and a 404 for `/missing`.
Where does each response originate, and what runs before its handler?

## 2. Understand the deployment

Compare [template.yaml](../template.yaml) with AWS's
[core concepts](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-how-it-works.html).
Find both functions, authentication settings, and endpoint outputs.

A function contains immutable revisions of code and configuration. Endpoints route
requests to those revisions. Which settings belong to each?

`npm run build` produces `.aws-sam/build/template.yaml` without deploying.
That template still uses SAM shorthand. After deployment, inspect CloudFormation's
processed template to see the expanded resources.

## 3. Compare authentication

Keep IAM mode running and start local JWT mode as described in the README.

```sh
curl -i localhost:3000/whoami
curl -i localhost:3001/health
curl -i localhost:3001/whoami
curl -i localhost:3001/missing
curl -i localhost:3001/whoami -H 'Authorization: Bearer invalid'
```

Local IAM requests succeed without signatures; signature enforcement happens at
AWS's endpoint. JWT mode returns 200 for `/health` and 401 for the other requests.

When ready to use AWS, follow the README's deployment and smoke tests to compare
signed, unsigned, and valid-token requests. Which failures reach Express?
See the [access-control guide](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-access-control.html).

## 4. Observe reuse and concurrency

Call `/whoami` repeatedly, then overlap two streams with another request:

```sh
curl -N localhost:3000/stream &
curl -N localhost:3000/stream &
curl -s localhost:3000/whoami
wait
```

- The server responds while streams are open.
- `envId` and `startedAt` stay fixed until the process restarts.
- `requestCount` includes health checks and requests rejected by app authentication.

Restart the server and compare `/whoami`. `envId` identifies the process, not an AWS revision.

On AWS, repeat with authenticated requests and group results by `envId`.
Environments have independent counters; a small test may reach only one.
Local runs demonstrate concurrency, not AWS scaling.

What state must live outside an environment to survive its replacement?
Read the [lifecycle](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-env-lifecycle.html)
and [scaling](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html) guides.
Stop local servers with Ctrl+C when finished.
