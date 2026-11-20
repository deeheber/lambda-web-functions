# VPC

Reach a private HTTP service through a version-pinned Lambda network connector.
The service echoes the connection's source IP so you can see the VPC path.

Run commands from `examples/04-vpc`. This updates the same `lwf` stack in
`us-west-2`; continue from Canary without teardown. The existing CloudFront
hostname, Cognito users, and optional custom domain stay in place.

Status: offline checks pass; the live AWS walkthrough has not been verified.

## Cost and lifetime

[Delete the stack when you finish the lab](#4-clean-up). Resources keep billing
while idle, including when an older revision is serving traffic.

Planning estimate dated 2026-11-16 for `us-west-2`, before discounts or credits:

| Added resource | Budget assumption |
|---|---|
| One zonal NAT gateway | $0.045/hour, plus data processing and transfer. |
| One NAT public IPv4 address | $0.005/hour. |
| One Linux `t4g.nano`, standard CPU credits | $0.0042/hour. |
| 8 GiB gp3 root disk | About $0.64/month, prorated. |

Budget about $0.20 for three hours or $40 for 730 hours, before usage charges.
NAT rounds partial hours up. Existing stack resources can add charges. Check
current regional rates before deploying. [VPC pricing](https://aws.amazon.com/vpc/pricing/),
[EC2 pricing](https://aws.amazon.com/ec2/pricing/on-demand/), and
[EBS pricing](https://aws.amazon.com/ebs/pricing/).

The lab creates a dedicated VPC. NAT lets the app fetch Cognito signing keys.
The NAT gateway and its public IPv4 address keep billing after you stop or delete
the instance. The disk also keeps billing while the instance is stopped.

The NAT gateway and service instance are single points of failure. The
connector spans two Availability Zones, so traffic to NAT or the service can
incur cross-AZ transfer charges.

## Changes from Canary

`UpdateReplacePolicy: Retain` keeps the previous revision. Check each change set
for AMI changes. A newer AL2023 AMI can replace the instance and change the
private IP, triggering a new revision. Before routing traffic back to a VPC
revision, verify that its target instance still exists.

The revision pins a connector version. SAM creates its operator role separately
from the function execution role, which does not manage network interfaces.

SAM `AutoDeploymentMode: LatestRevision` moves traffic from Canary's retained
baseline to the stack-created revision. This is separate from the service's
automatic-deployment mode; check actual routing in step 3.

## Check locally

See the [local prerequisites](../../README.md#local-prerequisites).

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run test:bundle
cfn-lint --regions us-west-2 --template template.yaml
cfn-lint --regions us-east-1 --template certificate.yaml
```

To build the app on its own, run `npm run build`. It runs `sam build` and adds
the package marker Node needs to load the ESM bundle.

<details>
<summary>Why the function has two lint exceptions</summary>

- For `E1010`, cfn-lint 1.59.0 doesn't recognize the connector's `LatestVersionArn`.
- For `W3005`, SAM moves the egress reference to the generated revision. The
  function needs its own `DependsOn` so CloudFormation deletes the function
  before the connector.

</details>

### Try the app locally

Start the app with `npm run dev`, then run these in a second terminal.

```sh
curl -i http://127.0.0.1:3000/health
curl -i http://127.0.0.1:3000/private-ping
```

Expect `200` from `/health` and `401` from `/private-ping` because the request
has no JWT. The dev command uses placeholder Cognito IDs and points at a local
service URL. The deployment walkthrough below covers a real sign-in and a call
to the private service. Press Ctrl+C in the first terminal when you're done.

## 1. Record the pre-connector observations

From here on, the commands use AWS or the deployed app. Use AWS CLI v2 with
`lambda-web` and `lambda-core` support. Set `AWS_PROFILE` if you use a named profile.

Your AWS credentials need permission to update the tutorial stack and its EC2,
VPC, and IAM resources. Before deploying, check for these additional permissions.

- `lambda:PassNetworkConnector` for the network connector
- `iam:PassRole` for the connector's operator role
- `ec2:DescribeAvailabilityZones` to look up Availability Zones
- Read access to the public SSM parameter for the AMI

`CAPABILITY_IAM` is your acknowledgment that CloudFormation can create IAM resources.

Use the same Bash or zsh terminal through cleanup. The first command below loads
the stack name and region from `samconfig.toml` and makes `stack_output` available.
Save your measurements outside the terminal. If you restart the terminal,
source `scripts/env.sh` again and reload the stack outputs.

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

After the Canary rollback, check the endpoint output.

- `mode` is `Disabled`.
- `status` is `Successful`.
- `weights` shows `100` for the original baseline revision ID (all traffic).

Use `weights` to see which revision is serving traffic. The stack output
`CurrentRevisionId` still points to the Canary candidate. If any of the checks
above fail, resolve the issue before timing requests.

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

After the Canary rollback, each response should show `buildId` as `baseline-v1`.
For each request, save `buildId`, `envId`, `startedAt`, and the `total` time printed
by `curl`.

These timings cover the whole request, including CloudFront and any time spent
fetching JWT signing keys. Even the first request can reuse an existing Lambda
environment and its cached keys.

## 2. Deploy the connector revision

Keep the checked-in `AutoDeploymentMode: LatestRevision` and no `RevisionWeights`.
Do not copy Canary's edited template or revision IDs into this stage.

Choose two different standard Availability Zones from your account's list:

```sh
aws ec2 describe-availability-zones \
  --filters Name=state,Values=available Name=zone-type,Values=availability-zone \
  --query 'AvailabilityZones[].ZoneName' --output text
```

In the same terminal, set these to two names returned above. Stop if fewer than
two zones are available.

```sh
AZ_A=us-west-2a
AZ_B=us-west-2b
```

Explicit zones avoid `Fn::GetAZs` filtering, which can return just one zone if only
one default subnet remains. Reuse the same zones on later deployments; changing
them replaces subnets and dependent resources.

**If you use the default CloudFront hostname**, run this command.

```sh
npm run deploy -- --confirm-changeset --parameter-overrides \
  AvailabilityZoneA="$AZ_A" AvailabilityZoneB="$AZ_B"
```

**If you already set up a custom hostname**, reuse its `DomainName`,
`CertificateArn`, and `HostedZoneId`. Each stage has its own SAM configuration,
so pass those values again when you deploy from this folder.

If you need to look up those values, read them from the current stack.

```sh
aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query 'Stacks[0].Parameters'
```

Replace the three example values with the ones from your stack, then deploy.

```sh
npm run deploy -- --confirm-changeset --parameter-overrides \
  AvailabilityZoneA="$AZ_A" AvailabilityZoneB="$AZ_B" \
  DomainName=app.example.com \
  CertificateArn=arn:aws:acm:us-east-1:111122223333:certificate/REPLACE-WITH-EXISTING-ID \
  HostedZoneId=REPLACE-WITH-EXISTING-ZONE
```

SAM shows the proposed changes after building and uploading the code. Expect
new networking, an EC2 instance, a connector and its IAM role, plus a new
revision and an endpoint routing update. Enter `y` to deploy if the changes look
right. Enter `n` if you see an unexpected replacement or deletion.

CloudFormation gives the new instance up to ten minutes to report that its
local `/ping` check passed. Once deployment succeeds, test the connector in step 3.

## 3. Verify routing and private access

After deployment succeeds, reload the outputs in the same terminal:

```sh
VPC_REV="$(stack_output "$STACK_NAME" CurrentRevisionId)" &&
CONNECTOR="$(stack_output "$STACK_NAME" ConnectorArn)" &&
INSTANCE="$(stack_output "$STACK_NAME" PrivateServiceId)" &&
NAT_ID="$(stack_output "$STACK_NAME" NatGatewayId)" &&
NAT_ALLOCATION="$(stack_output "$STACK_NAME" NatAllocationId)" &&
VOLUME_ID="$(aws ec2 describe-instances --instance-ids "$INSTANCE" \
  --query 'Reservations[0].Instances[0].BlockDeviceMappings[0].Ebs.VolumeId' --output text)"
```

Check the connector:

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

`callerIp` should be in one of the connector subnets (`10.42.1.0/24` or
`10.42.2.0/24`). The exact IP can vary.

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

## Troubleshooting

- **Deploy fails.** Check the CloudFormation stack events for the failed resource and reason.
- **`/private-ping` returns `404`.** Check that `/whoami` reports `vpc-v1`. If it
  reports `baseline-v1`, check the endpoint's revision weights.
- **`/private-ping` returns `502` or `504`.** Check that the connector is `ACTIVE`
  and look for `Private HTTP service ready` in the EC2 instance's console output.

## 4. Clean up

Run teardown when you're done with the lab. The next stage, MultiRegion,
starts with a fresh stack, so finish VPC cleanup before moving on.

Teardown starts deleting the entire application stack, including Cognito users
and any custom-domain association, without a confirmation prompt.

```sh
npm run teardown
```

Budget about 15–30 minutes for the application stack to delete. CloudFront and
the network connector can take several minutes to clean up. Wait for
`DELETE_COMPLETE` in CloudFormation before moving on. If you see `DELETE_FAILED`,
check the stack events for the reason before retrying.

SAM may warn that it can't resolve S3 bucket information. It handles the Web
Function code bucket separately. In CloudFormation (`us-west-2`), check that
the `lwf-<hash>-WebFunctionCode` stack is also gone. With the default deployment
settings, no manual S3 cleanup is needed once both stacks are deleted.

<details>
<summary><strong>Double-check billable resources after teardown</strong></summary>

Use the IDs loaded in step 3 in the same terminal, AWS account, and Region. If
you'll use a new terminal for these checks, save the IDs before teardown.

Expect the instance to be `terminated` and the NAT gateway to be `deleted`.
Both can also return resource-not-found once their records expire. For the
Elastic IP and disk, `InvalidAllocationID.NotFound` and `InvalidVolume.NotFound`
are the expected results after deletion.

```sh
aws ec2 describe-instances --instance-ids "$INSTANCE" \
  --query 'Reservations[].Instances[].State.Name'
aws ec2 describe-nat-gateways --nat-gateway-ids "$NAT_ID" \
  --query 'NatGateways[].State'
aws ec2 describe-addresses --allocation-ids "$NAT_ALLOCATION"
aws ec2 describe-volumes --volume-ids "$VOLUME_ID"
```

</details>

<br>

If you created a separate certificate stack, wait for CloudFront to finish deleting
the distribution and removing its certificate association. If you plan to remove
the validation CNAME, copy its name and value from ACM in `us-east-1` before
deleting the certificate stack. Use the stack's existing name.

```sh
CERT_STACK='lwf-cloudfront-certificate'
aws cloudformation delete-stack --region us-east-1 --stack-name "$CERT_STACK"
aws cloudformation wait stack-delete-complete --region us-east-1 --stack-name "$CERT_STACK"
```

Keep the existing Route 53 hosted zone. Remove the matching validation CNAME
only if you can confirm it was added for the lab and no other certificate uses
it. Check your pre-lab DNS records or look for a matching `CREATE` in CloudTrail
under `ChangeResourceRecordSets` in `us-east-1`. If you're unsure, leave it in place.

For leftover log groups, see
[CloudFront log cleanup](../02-cloudfront/README.md#continue-or-clean-up).

## AWS references

- [Web Function networking and VPC access](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html)
- [SAM network connector](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-networkconnector.html)
- [SAM-generated connector operator role](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-specification-generated-resources-networkconnector.html)
- [SAM Web Function routing](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-webfunction.html)
- [Public AMI parameters](https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/finding-an-ami-parameter-store.html)
- [Fn::GetAZs and default-subnet filtering](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/intrinsic-function-reference-getavailabilityzones.html)
- [How CloudFormation waits for EC2 readiness](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-creationpolicy.html)
