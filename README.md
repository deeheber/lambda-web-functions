# Learning Lambda Web Functions

## Get started

Start with [hello world](examples/hello-world/README.md), a TypeScript Express app
with IAM and Cognito JWT authentication, environment reuse information, and streaming.
Local development requires Node 24.

```sh
cd examples/hello-world
npm ci
npm run dev
```

Follow the [walkthrough](examples/hello-world/docs/walkthrough.md) to trace requests
and compare local behavior with a deployment. The [roadmap](ROADMAP.md) gives the
learning order and planned stages. Only hello world is implemented.

## Working through stages

Each folder preserves a complete runnable stage. Run commands from that folder.
All stages target stack `lwf` in `us-west-2`; deploying another stage updates it.

To compare stages, record observations, deploy the other stage, and repeat the
checks. Switching stages may remove or replace resources. Teardown from any
stage deletes the shared stack.
