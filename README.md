# Learning Lambda Web Functions

## Get started

Start with [hello world](examples/01-hello-world/README.md). Requires Node 24.

```sh
cd examples/01-hello-world
npm ci
npm run dev
```

See the [roadmap](ROADMAP.md) for stage order, status, and walkthroughs.

## Working through stages

Run commands from the stage's folder. All stages update stack `lwf` in `us-west-2`.
Switching stages may remove or replace resources; teardown from any stage deletes
the application stack.

[VPC](examples/04-vpc/README.md) adds a private HTTP service and VPC connector after
Canary. Its live walkthrough is not yet verified. It is a short lab with ongoing
NAT, public IPv4, EC2, and disk charges; review its cost estimate before deployment
and follow its cleanup checks afterward.
