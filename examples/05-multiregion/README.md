# MultiRegion

Deploy one Lambda Web Function from Oregon (`us-west-2`) and serve it from
Oregon and N. Virginia (`us-east-1`) through one Lambda-generated global URL.

Finish the [VPC cleanup](../04-vpc/README.md#4-clean-up) first. This stage starts a
fresh `lwf-multiregion` stack with a new Cognito pool and client in Oregon.
It uses Stage 1's public JWT path. Express verifies Cognito access tokens on
`/whoami` and `/stream`. The `/health` route is public. MultiRegion endpoints
require a revision without a VPC connector. [AWS networking guide](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html)

Run commands from `examples/05-multiregion`. Use the [local prerequisites](../../README.md#local-prerequisites),
AWS CLI v2 with `lambda-web` commands and credentials, plus `curl` and `jq` for
the walkthrough. Set `AWS_PROFILE` if needed.

## 1. Deploy from the home Region

Install dependencies with `npm ci`, then deploy once. This command accesses AWS.

```sh
npm run deploy
```

If you want to match requests to Lambda's logs in step 2, use
`npm run deploy -- --parameter-overrides SystemLogLevel=DEBUG` as your first
deploy. Execution environment and request rate limits apply per Region. Both Regions
can incur charges. [Lambda scaling](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html)

These commands access AWS. Look for one revision at weight 100 and both Regions
in `regionalEndpoints`. Wait for both to report `state: Active` before sampling.
If an `updateStatus` is present, wait for `Successful`.
If creation fails, check the CloudFormation stack events and any available
regional status. Fix the cause and clean up the failed deployment before retrying.

```sh
source scripts/env.sh
BASE="$(stack_output "$STACK_NAME" PublicEndpointUrl)"
FUNCTION_NAME="$(stack_output "$STACK_NAME" PublicFunctionName)"
aws lambda-web get-web-function-endpoint --region "$AWS_REGION" \
  --function-name "$FUNCTION_NAME" --endpoint-name public \
  --query '{URL:domainName,Weights:revisionWeights,Regions:regionalEndpoints}'
```

The global URL ends in `.lambda-web.global.on.aws`. SAM sends traffic to the
initial revision on stack creation. A later revision needs explicit promotion.
For this lab, tear down and redeploy to try code changes. In-place changes to
the endpoint type or Region set require replacing the endpoint with a new name
and URL. [SAM WebFunction reference](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-webfunction.html)

## 2. Verify JWTs and compare routing

These commands access AWS and invoke the deployed endpoint. Use an email address
for a lab user. `get-jwt` creates or resets that user's password and prints an
access token.

```sh
curl -i "$BASE/health"
curl -i "$BASE/whoami"
TOKEN="$(npm run --silent get-jwt -- you@example.com)"
curl --fail-with-body -isS -H "Authorization: Bearer $TOKEN" "$BASE/whoami"
```

Expect 200 for health, 401 for `/whoami` without a token, and 200 with a token.
The authenticated response includes `region`. The app resolves it from the
execution environment's AZ ID at startup. A missing or failed lookup shows
`null` until that environment is recycled. [Lambda metadata](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-configuration-metadata-endpoint.html)

From two networks, run several requests against the same global URL. You can
use public AWS CloudShell sessions in Oregon and N. Virginia. Set `BASE` to the
global URL in each session. In Bash, run `read -r -s TOKEN` and paste the
short-lived token to keep it out of shell history.

```bash
for attempt in 1 2 3; do
  curl --fail --silent --show-error \
    --write-out '%{stderr}dns=%{time_namelookup}s first_byte=%{time_starttransfer}s total=%{time_total}s\n' \
    -H "Authorization: Bearer $TOKEN" "$BASE/whoami" | jq -r '.region'
done
```

Record the client location, Region, and timings. Both clients can see the same
Region because Lambda routes using latency estimates, which change over time,
and DNS resolvers and caching can affect the result. Client timings also include
effects such as cold starts and a first fetch of Cognito signing keys from the
home Region. Lambda does not perform health-based failover. [Multi-Region routing](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-replication.html)
[Route 53 resolver behavior](https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/routing-policy-edns0.html)

If you deployed with DEBUG system logs, save the `lambda-web-request-id` response
header from an authenticated request made with `curl -i`. In Oregon's centralized
log group `/aws/lambda/web/lwf-multiregion-public`, find the
`platform.requestComplete` event whose `record.requestId` matches. Compare the
event's `region` with the response. Repeat for each Region you observe and allow
time for log delivery. [Lambda log correlation](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-logging.html)

## 3. Tear down

When you finish this final stage, run the AWS command below. It deletes the
application stack and its Cognito users without prompting. In CloudFormation
in Oregon, confirm that `lwf-multiregion` and
`lwf-multiregion-<hash>-WebFunctionCode` are deleted.

```sh
npm run teardown
```

CloudWatch log groups can remain and retain events indefinitely by default.
If you no longer need those logs, run these AWS cleanup commands for the groups
that exist. You might only have a `.local` group in a Region that served requests.

```sh
LOG_GROUP=/aws/lambda/web/lwf-multiregion-public
aws logs delete-log-group --region us-west-2 --log-group-name "$LOG_GROUP"
aws logs delete-log-group --region us-west-2 --log-group-name "$LOG_GROUP.local"
aws logs delete-log-group --region us-east-1 --log-group-name "$LOG_GROUP.local"
```

## Check locally

These checks use fake metadata and Cognito keys. They require no AWS calls.
Use `npm run build` for an artifact with the ESM package marker.

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run test:bundle
cfn-lint --regions us-west-2 --template template.yaml
```
