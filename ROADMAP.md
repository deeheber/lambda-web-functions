# Lambda Web Functions learning roadmap

## Suggested order

| Step | Example | What to learn | First milestone |
|---|---|---|---|
| 1 | [Hello world](examples/hello-world/README.md) | Request handling, IAM versus JWT authentication, streaming, and environment reuse | Complete the [walkthrough](examples/hello-world/docs/walkthrough.md). |
| 2 | CloudFront ([#4](https://github.com/deeheber/lambda-web-functions/issues/4)) | Serving a browser-facing app and separating origin access from user authentication | Use the CloudFront hostname with OAC; explore JWT forwarding, then a custom domain. Leave WAF for later. |
| 3 | Canary deployments ([#1](https://github.com/deeheber/lambda-web-functions/issues/1)) | Revisions, traffic weights, promotion, and rollback | Identify two builds in responses, split traffic, promote one, then roll back. |
| 4 | VPC access ([#3](https://github.com/deeheber/lambda-web-functions/issues/3)) | Reaching a private backend and managing connections | Call one small private HTTP target before adding a database. |
| 5 | MultiRegion ([#2](https://github.com/deeheber/lambda-web-functions/issues/2)) | Regional replication, routing, authentication, and observability | Expose the serving Region and compare requests from different locations. |

## Adding a learning stage

- Use `examples/cloudfront`, `examples/canary`, `examples/vpc`, or `examples/multiregion`.
- Include its own code, tests, package files, template, and SAM configuration.
  Prefer a small amount of duplication over a framework that obscures the lesson.
- Follow the [shared-stack workflow](README.md#working-through-stages). Preserve
  resource logical IDs where practical so resources carry forward between stages.
- Document how to run, what changed from the previous stage, what to observe, and how to
  clean up. Distinguish local checks from commands that access AWS.
- Keep hello world small; apply bug fixes and dependency updates without adding
  experiment-specific features to it.

Issue sketches reference the old `infra/app.yaml` and missing `docs/SPEC.md`.
Use the current example's template. Before implementing canary deployments, inspect
SAM's generated revisions and endpoints. Before MultiRegion, check regional
availability and VPC connector restrictions; document any features that cannot
carry forward from the VPC stage.
