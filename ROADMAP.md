# Learning roadmap

Follow the stages in order:

| Stage | Status | Learn by doing |
|---|---|---|
| [Hello world](examples/01-hello-world/README.md) | Available | [Walkthrough](examples/01-hello-world/docs/walkthrough.md): requests, authentication, reuse, and concurrency. |
| [CloudFront](examples/02-cloudfront/README.md) ([#4](https://github.com/deeheber/lambda-web-functions/issues/4)) | Available | Separate origin access from user authentication with OAC and JWT forwarding; optionally add a custom domain. |
| [Canary](examples/03-canary/README.md) ([#1](https://github.com/deeheber/lambda-web-functions/issues/1)) | Available | Split traffic between identifiable builds, promote one, then roll back. |
| [VPC](examples/04-vpc/README.md) ([#3](https://github.com/deeheber/lambda-web-functions/issues/3)) | Available | Reach a private HTTP service through a version-pinned connector; short lab with explicit cost and cleanup steps. |
| [MultiRegion](examples/05-multiregion/README.md) ([#2](https://github.com/deeheber/lambda-web-functions/issues/2)) | Pending AWS verification | Deploy a fresh stack after VPC cleanup, then expose the serving Region and compare regional routing. |

The MultiRegion walkthrough calls the Lambda-generated global URL directly
to observe Lambda's latency-based routing. CloudFront is an optional follow-up
for a custom domain, AWS WAF, caching, or origin access control.

## Adding a stage

- Build on an existing example. Include runnable code, offline tests, package
  files, a template, and SAM configuration.
- Add the stage folder to `matrix.stage` in `.github/workflows/checks.yml`.
- In the stage README, explain whether to start a fresh stack or update an
  existing one. Include commands, expected results, and cleanup. Label commands
  that access AWS.
- Keep earlier stages runnable when applying fixes or dependency updates.
