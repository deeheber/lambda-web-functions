# Learning roadmap

Follow this order, from a basic HTTP app to regional distribution:

| Stage | Learn by doing |
|---|---|
| [Hello world](examples/hello-world/README.md) | Complete the [walkthrough](examples/hello-world/docs/walkthrough.md): requests, authentication, reuse, and concurrency. |
| CloudFront ([#4](https://github.com/deeheber/lambda-web-functions/issues/4)) | Separate origin access from user authentication. Start with OAC, then JWT forwarding and a custom domain. |
| Canary ([#1](https://github.com/deeheber/lambda-web-functions/issues/1)) | Split traffic between identifiable builds, promote one, then roll back. |
| VPC ([#3](https://github.com/deeheber/lambda-web-functions/issues/3)) | Reach a private HTTP service before introducing a database. |
| MultiRegion ([#2](https://github.com/deeheber/lambda-web-functions/issues/2)) | Expose the serving Region and compare regional routing. |

## Adding a stage

- Use `examples/cloudfront`, `examples/canary`, `examples/vpc`, or `examples/multiregion`.
- Include runnable code, tests, package files, a template, and SAM configuration.
- When adding the second stage, extend the existing GitHub Actions checks workflow
  with a matrix that runs checks from each stage's folder. Keep one workflow.
- Build on the previous stage using the [same stack](README.md#working-through-stages).
  Preserve resource logical IDs where practical.
- Add a README with commands, changes from the previous stage, observations, and cleanup.
  Label commands that access AWS.
- Keep earlier stages small and runnable; apply bug fixes and dependency updates.

Issue sketches reference the old `infra/app.yaml` and missing `docs/SPEC.md`.
Use the current stage's template. For canary deployments, inspect SAM's generated
revisions and endpoints first. Before MultiRegion, check regional availability
and VPC connector restrictions; document anything that cannot carry forward.
