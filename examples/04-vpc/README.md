# VPC

Reach a private HTTP service through a version-pinned Lambda network connector.
The service echoes the connection's source IP so you can see the VPC path.

Run commands from `examples/04-vpc`. This updates the same `lwf` stack in
`us-west-2`; continue from Canary without teardown. The existing CloudFront
hostname, Cognito users, and optional custom domain stay in place.

Status: offline checks pass; the live AWS walkthrough has not been verified.

## Cost and lifetime

Use this as a short lab and [clean up](#5-clean-up) when finished. Resources keep
billing while idle, including when an older revision is serving traffic.

Planning estimate dated 2026-11-16 for `us-west-2`, before discounts or credits:

| Added resource | Budget assumption |
|---|---|
| One zonal NAT gateway | $0.045/hour, plus data processing and transfer. |
| One NAT public IPv4 address | $0.005/hour. |
| One Linux `t4g.nano`, standard CPU credits | $0.0042/hour. |
| 8 GiB gp3 root disk | About $0.64/month, prorated. |

Budget roughly $0.20 for a three-hour lab, allowing for NAT's billing of partial
hours as full hours. Left running for 730 hours, these resources cost about $40
before usage charges. The NAT and disk rates are budgeting assumptions; check
current regional rates before deployment.
See [VPC pricing](https://aws.amazon.com/vpc/pricing/),
[EC2 pricing](https://aws.amazon.com/ec2/pricing/on-demand/), and
[EBS pricing](https://aws.amazon.com/ebs/pricing/).
The existing Web Function, CloudFront, Cognito, storage, and logs can add charges.

The VPC itself has no additional charge. A dedicated VPC makes cleanup repeatable
and does not require an account default VPC, even if yours was deleted.
Default public subnets would not give the connector's private IPv4 interfaces
internet access. NAT preserves the app's ability to fetch Cognito signing keys.
Deleting or stopping only the EC2 instance does not stop NAT or public IPv4 charges;
stopping it also leaves the disk billable.

One NAT gateway and one service instance are not highly available. The connector
spans two Availability Zones; traffic from the second AZ to NAT or the service can
incur cross-AZ transfer charges.

## Changes from Canary

The function, endpoint, Cognito pool/client, distribution, OAC, policy, and optional
DNS records keep their logical IDs. The code and connector settings replace the
revision; `UpdateReplacePolicy: Retain` keeps its predecessor. No existing resource
is intentionally removed. A newer AMI can replace the instance on a later
deployment, changing its IP and replacing the revision too.

The revision pins a connector version. SAM creates its operator role separately
from the function execution role, which does not manage network interfaces.

SAM `AutoDeploymentMode: LatestRevision` moves traffic from Canary's retained
baseline to the stack-created revision. This is separate from the service's
automatic-deployment mode; check actual routing in step 3.

## Check locally

Requires Node 24.2+, SAM CLI 1.170+, cfn-lint 1.59+, Python 3, Bash, and zsh.
These checks use injected JWT keys, fake AWS commands, and loopback HTTP services;
they do not call AWS. Dependency installation may need network access.

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run test:bundle
cfn-lint --regions us-west-2 --template template.yaml
cfn-lint --regions us-east-1 --template certificate.yaml
```

Use `npm run build` for a build alone. Bare `sam build` omits the ESM package marker.
The function metadata suppresses `E1010` because cfn-lint 1.59.0 lacks the documented
`LatestVersionArn` connector attribute. The exception is scoped to the referring
function.
It also suppresses `W3005` there: SAM moves the egress reference onto the generated
revision, so the explicit function dependency is needed for deletion order.

`npm run dev` sets placeholder Cognito IDs and an explicit loopback service URL.
In another terminal, `/health` returns 200 and `/private-ping` without a JWT returns
401. No private service or working Cognito login is provided by this dev command.
Stop the server with Ctrl+C.

## 1. Record the pre-connector observations

All remaining commands access AWS or the deployed application. Requires AWS CLI v2
with both `lambda-web` and `lambda-core` support, credentials, and permissions to
update the tutorial stack and its EC2/VPC/IAM resources. Set `AWS_PROFILE` if needed.
The deployment identity needs `lambda:PassNetworkConnector`, `iam:PassRole` for the
operator role, and access to the public SSM AMI parameter. `CAPABILITY_IAM` acknowledges
IAM creation; it does not grant these permissions.

Use one Bash or zsh terminal through cleanup. `source scripts/env.sh` defines
`STACK_NAME`, exports `AWS_REGION` from `samconfig.toml`, and defines `stack_output`.
If that terminal closes, source it again and reload the outputs; keep recorded
measurements and cleanup IDs.

```sh
source scripts/env.sh &&
export AWS_PAGER='' &&
FUNCTION_NAME="$(stack_output "$STACK_NAME" IamFunctionName)" &&
BASE="$(stack_output "$STACK_NAME" CloudFrontEndpointUrl)"
# Optional: if you already configured a custom domain, use it for both measurements.
# BASE="$(stack_output "$STACK_NAME" CustomDomainUrl)"
```

Inspect the existing endpoint before deploying anything:

```sh
aws lambda-web get-web-function-endpoint \
  --function-name "$FUNCTION_NAME" --endpoint-name iam \
  --query '{mode:autoDeploymentMode,status:updateStatus,weights:revisionWeights}'
```

After the Canary rollback, expect service mode `Disabled`, status `Successful`,
and the retained baseline ID at weight 100. Do not assume `CurrentRevisionId` is
serving: that output still names Canary's candidate. Stop and resolve any failed
update or unexpected traffic split before comparing timings.

Obtain a token with your test user's email. This command creates the user if needed
and resets its password. The token remains valid across this stage's deployment
because the Cognito pool/client are preserved.

```sh
TOKEN="$(npm run --silent get-jwt -- you@example.com)" &&
export TOKEN
```

Define this function in the same terminal and save its output before deployment:

```sh
observe() {
  for attempt in 1 2 3; do
    curl --fail-with-body --silent --show-error --max-time 15 \
      -H "Authorization: Bearer $TOKEN" \
      -w '\nHTTP %{http_code}, total %{time_total}s\n' "$BASE/whoami" || return
  done
}
observe
```

Expect `baseline-v1` if you finished Canary's rollback. Record `buildId`, `envId`,
`startedAt`, and the three timings. They are end-to-end latency observations,
including CloudFront and possible JWT key fetching. The first request is not a
proven cold start; existing environments and key caches affect the results.

## 2. Deploy the connector revision

Keep the checked-in `AutoDeploymentMode: LatestRevision` and no `RevisionWeights`.
Do not copy Canary's edited template or revision IDs into this stage.

If you used a custom domain, supply its same three parameter values again in the
command below; do not assume a different stage folder has your previous SAM
parameter overrides saved. Read the old values first if needed:

```sh
aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Parameters'
```

Without a custom domain:

```sh
npm run deploy -- --confirm-changeset
```

With your existing custom domain, use this instead, replacing the three values:

```sh
npm run deploy -- --confirm-changeset --parameter-overrides \
  DomainName=app.example.com \
  CertificateArn=arn:aws:acm:us-east-1:111122223333:certificate/REPLACE-WITH-EXISTING-ID \
  HostedZoneId=REPLACE-WITH-EXISTING-ZONE
```

Deployment builds locally, uploads code, and prompts for change-set approval.
Review the proposed changes and enter `y` to continue, or `n` to stop. Expect new
network, service, connector, and operator-role resources, revision replacement,
and an endpoint routing update. The function, endpoint, Cognito pool/client,
distribution, OAC, and existing domain records should not need replacement. Stop
if the change set proposes an unexpected replacement or deletion.

CloudFormation success does not prove the Python service is ready: EC2 user data
can finish after the instance resource is created. Check the live path next.

## 3. Verify routing and private access

After deployment succeeds, reload the outputs in the same terminal:

```sh
VPC_REV="$(stack_output "$STACK_NAME" CurrentRevisionId)" &&
CONNECTOR="$(stack_output "$STACK_NAME" ConnectorArn)" &&
INSTANCE="$(stack_output "$STACK_NAME" PrivateServiceId)" &&
VPC_ID="$(stack_output "$STACK_NAME" VpcId)" &&
NAT_ID="$(stack_output "$STACK_NAME" NatGatewayId)" &&
NAT_ALLOCATION="$(stack_output "$STACK_NAME" NatAllocationId)" &&
VOLUME_ID="$(aws ec2 describe-instances --instance-ids "$INSTANCE" \
  --query 'Reservations[0].Instances[0].BlockDeviceMappings[0].Ebs.VolumeId' --output text)"
```

Record these IDs outside the terminal before cleanup. Check the connector:

```sh
aws lambda-core get-network-connector --identifier "$CONNECTOR" \
  --query '{state:State,reason:StateReason,version:LatestVersionArn}'
```

Expect `ACTIVE` and a version-qualified ARN ending in `:<number>`. Then check the
revision and endpoint:

```sh
aws lambda-web get-web-function-revision \
  --function-name "$FUNCTION_NAME" --revision-id "$VPC_REV" \
  --query '{state:state,connector:serviceConfig.egressNetworkConnectorArn}' &&
aws lambda-web wait web-function-endpoint-updated \
  --function-name "$FUNCTION_NAME" --endpoint-name iam &&
aws lambda-web get-web-function-endpoint \
  --function-name "$FUNCTION_NAME" --endpoint-name iam \
  --query '{mode:autoDeploymentMode,status:updateStatus,weights:revisionWeights}'
```

Expect the revision to be `Active`, its connector ARN to match the connector's
version-qualified ARN, endpoint update status `Successful`, and `VPC_REV` at weight
100. With SAM-managed routing, service mode can remain `Disabled`; the weights
must identify the new revision. Stop if the waiter fails or these values differ.

Now repeat the pre-connector observations, then call the new route:

```sh
observe
curl -i --max-time 15 "$BASE/health"
curl -i --max-time 15 "$BASE/private-ping"
curl -i --max-time 15 "$BASE/private-ping" -H 'Authorization: Bearer invalid'
curl --fail-with-body -i --max-time 15 "$BASE/private-ping" \
  -H "Authorization: Bearer $TOKEN"
```

Expect `vpc-v1` from `/whoami`, health 200, private-ping 401 without a valid token,
and authenticated private-ping 200 with a body like:

```json
{"service":"private-http","callerIp":"10.42.1.123"}
```

The peer address should belong to a connector subnet, `10.42.1.0/24` or
`10.42.2.0/24`. It can change between environments; do not use it as an
authentication control. The service allows HTTP only from the connector's security
group, while the app checks JWTs. Source-IP echo does not replace a Flow Logs audit.

Refresh `TOKEN` with the earlier command if it expires; 401s are not latency samples.

Check the carried-forward streaming behavior:

```sh
curl --fail-with-body -i -N --max-time 15 "$BASE/stream" \
  -H "Authorization: Bearer $TOKEN"
```

Expect 200 and ticks arriving over time. If using the custom domain, also repeat
health, authenticated private-ping, and streaming against `CloudFrontEndpointUrl`
so both hostnames are checked. Mark live validation complete only after routing,
authentication, private access, streaming, and any configured domain checks pass.

## 4. Troubleshoot

| Observation | Check |
|---|---|
| `/private-ping` is 404 with a valid token | Check `/whoami` build and endpoint weights. A retained Canary baseline has no new route. |
| `/health` works but a valid JWT is rejected | Health does not fetch keys. Check token expiry/pool, NAT state, private routes, HTTPS egress, and DNS resolution for Cognito. |
| `/private-ping` is 502 | The service may still be booting, refuse the connection, or return invalid data. Check the instance and bootstrap output below; retry after readiness. |
| `/private-ping` is 504 | Check connector state, subnet/AZ selection, both security-group directions, and instance readiness. |
| Connector creation or update fails | Inspect its state reason and CloudFormation events; check available subnet IPs, operator-role permissions, and deployer pass permissions. |
| Change set removes the custom domain | Stop and provide the existing domain, certificate, and hosted-zone parameters together. |

These diagnostic commands are read-only but access AWS:

```sh
aws cloudformation describe-stack-events --stack-name "$STACK_NAME" \
  --query 'StackEvents[0:20].[LogicalResourceId,ResourceStatus,ResourceStatusReason]'
aws ec2 describe-instance-status --instance-ids "$INSTANCE" --include-all-instances
aws ec2 get-console-output --instance-id "$INSTANCE" --latest \
  --query Output --output text
```

Look for `Private HTTP service ready` in console output; output can lag. User data
logs setup errors to the console and `/var/log/private-http-setup.log`. There is no
SSH or SSM instance role in this lab. If bootstrap fails, inspect the output and
correct the template before replacing the instance; do not open public ingress.
A successful bootstrap check confirms only the instance's local service, not
connector connectivity.

## 5. Clean up

Recommended after this short lab. These commands access AWS and delete the entire
application stack, including Cognito users and any configured custom-domain
association. Save `INSTANCE`, `VOLUME_ID`, `NAT_ID`, `NAT_ALLOCATION`, and `VPC_ID`
from step 3 before deletion; stack outputs disappear afterward.

```sh
npm run teardown
```

This command uses SAM's `--no-prompts` deletion setting: it does not ask for
confirmation. Deleting the Web Function deletes its retained revisions and
endpoints. Dependencies order deletion of the function before the connector,
then its networking. SAM also handles its managed code-bucket stack; do not
manually empty the bucket while revisions use it.

Connector network interfaces are cleaned up asynchronously. If deletion is slow,
inspect stack events. If the stack reaches `DELETE_FAILED`, inspect the named
dependency, wait for connector cleanup, and retry deletion. Do not manually delete
Lambda-managed interfaces or unrelated account resources. Check any old roles or
functions retained by earlier replacement separately.

Verify cleanup using the saved IDs, in the same region:

```sh
aws ec2 describe-instances --instance-ids "$INSTANCE" \
  --query 'Reservations[].Instances[].State.Name'
aws ec2 describe-nat-gateways --nat-gateway-ids "$NAT_ID" \
  --query 'NatGateways[].State'
aws ec2 describe-addresses --allocation-ids "$NAT_ALLOCATION"
aws ec2 describe-volumes --volume-ids "$VOLUME_ID"
aws ec2 describe-vpcs --vpc-ids "$VPC_ID"
```

Expect EC2 `terminated` and NAT `deleted`, or a resource-not-found error once their
records expire. The Elastic IP allocation, root volume, and VPC should report
resource-not-found. An empty result or a failure alone is not proof: confirm the
correct account/region and distinguish not-found from access/network errors.
If you created the separate certificate stack, delete it only after the distribution
has been deleted and its association removed. Use your existing stack name:

```sh
CERT_STACK='lwf-cloudfront-certificate'
aws cloudformation delete-stack --region us-east-1 --stack-name "$CERT_STACK"
aws cloudformation wait stack-delete-complete --region us-east-1 --stack-name "$CERT_STACK"
```

Keep the hosted zone and validation CNAMEs still used by other certificates.
CloudWatch log groups can remain; follow the
[CloudFront log cleanup instructions](../02-cloudfront/README.md#continue-or-clean-up)
for old and current logs you no longer need.

## Continue instead of deleting

Leaving this stack deployed keeps NAT, public IPv4, EC2, and EBS charges running.
MultiRegion is still planned. A connector revision supports only `HomeRegion`;
you cannot carry it into a `MultiRegion` or `PerRegion` endpoint.

A future transition must first deploy a connector-free revision and route traffic
to it while retaining the connector and networking. Then remove every old revision
referencing that connector, including revisions retained outside CloudFormation,
before removing the connector and VPC resources in a later update. Changing endpoint
type also requires a new endpoint and moving the CloudFront origin. Do not deploy
an earlier stage directly as cleanup: it would remove the connector while retained
revisions can still reference it. Full application teardown avoids that transition.

## AWS references

- [Web Function networking, permissions, versioning, and removal](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html)
- [SAM network connector](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-networkconnector.html)
- [Generated connector operator role](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-specification-generated-resources-networkconnector.html)
- [SAM Web Function routing](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-webfunction.html)
- [AL2023 Python](https://docs.aws.amazon.com/linux/al2023/ug/python.html)
- [Public AMI parameters](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/finding-an-ami-parameter-store.html)
- [Connector deletion and asynchronous interface cleanup](https://docs.aws.amazon.com/cli/latest/reference/lambda-core/delete-network-connector.html)
