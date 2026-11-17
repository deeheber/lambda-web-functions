# Learning roadmap

Follow the stages in order:

| Stage | Status | Learn by doing |
|---|---|---|
| [Hello world](examples/01-hello-world/README.md) | Available | [Walkthrough](examples/01-hello-world/docs/walkthrough.md): requests, authentication, reuse, and concurrency. |
| [CloudFront](examples/02-cloudfront/README.md) ([#4](https://github.com/deeheber/lambda-web-functions/issues/4)) | Available | Separate origin access from user authentication with OAC and JWT forwarding; optionally add a custom domain. |
| [Canary](examples/03-canary/README.md) ([#1](https://github.com/deeheber/lambda-web-functions/issues/1)) | Available | Split traffic between identifiable builds, promote one, then roll back. |
| VPC ([#3](https://github.com/deeheber/lambda-web-functions/issues/3)) | Planned | Reach a private HTTP service before introducing a database. |
| MultiRegion ([#2](https://github.com/deeheber/lambda-web-functions/issues/2)) | Planned | Expose the serving Region and compare regional routing. |

## Adding a stage

- Use `examples/04-vpc` or `examples/05-multiregion` for the remaining stages.
- Include runnable code, tests, package files, a template, and SAM configuration.
- Add the stage's folder name to `matrix.stage` in `.github/workflows/checks.yml`.
- Build on the previous stage using the [same stack](README.md#working-through-stages).
  Preserve resource logical IDs where practical.
- Document commands, stage changes, expected observations, and optional cleanup in the README.
  Label AWS-accessing commands.
- Keep earlier stages small and runnable; apply bug fixes and dependency updates.

Issue sketches reference obsolete `infra/app.yaml` and `docs/SPEC.md` paths;
use the preceding stage's template. Before MultiRegion, check regional availability
and VPC connector restrictions, and document anything that cannot carry forward.
