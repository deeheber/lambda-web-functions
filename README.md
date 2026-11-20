# Learning Lambda Web Functions

## Get started

Start with [hello world](examples/01-hello-world/README.md) and check the
[Node requirements](#local-prerequisites).

```sh
cd examples/01-hello-world
npm ci
npm run dev
```

See the [roadmap](ROADMAP.md) for stage order, status, and walkthroughs.

## Local prerequisites

- Use Node 24 or later. Canary and VPC require at least Node 24.2.
- For the full local checks, install SAM CLI 1.170+, cfn-lint, Bash, and zsh.
  The VPC checks require Python 3 and cfn-lint 1.59+.

Local checks run without AWS credentials or service calls. Installing uncached
npm or build dependencies may require internet access.

## Working through stages

Run commands from the stage's folder. Hello world through VPC use the same `lwf`
stack in `us-west-2`. Switching stages may remove or replace resources. Teardown
deletes the application stack.

[VPC](examples/04-vpc/README.md) adds a private HTTP service and VPC connector.
Review the lab's costs before deploying.

After VPC cleanup, [MultiRegion](examples/05-multiregion/README.md) starts a fresh
`lwf-multiregion` stack in `us-west-2`.
