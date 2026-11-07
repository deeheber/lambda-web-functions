# Learning Lambda Web Functions

## Get started

Start with [hello world](examples/hello-world/README.md), an Express app with IAM
and Cognito JWT authentication. Local development requires Node 24.

```sh
cd examples/hello-world
npm ci
npm run dev
```

- [Walkthrough](examples/hello-world/docs/walkthrough.md): learn by tracing requests and observing behavior.
- [Roadmap](ROADMAP.md): the five learning stages and what to implement next.

Only hello world is implemented.

## Working through stages

Each folder preserves a runnable stage. Run commands from that folder.
All stages target stack `lwf` in `us-west-2`; deploying another stage updates it.

To compare stages, record observations, deploy the other stage, and repeat the
checks. Switching stages may remove or replace resources. Teardown from any
stage deletes the shared stack.
