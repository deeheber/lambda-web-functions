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

[VPC](examples/04-vpc/README.md) adds a private HTTP service and VPC connector after
Canary. Its live walkthrough is not yet verified. It is a short lab with ongoing
NAT, public IPv4, EC2, and disk charges; review its cost estimate before deployment
and follow its cleanup checks afterward.

The planned MultiRegion stage starts with a fresh application stack after VPC cleanup.
