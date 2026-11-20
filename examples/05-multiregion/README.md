# MultiRegion

Deploy one Lambda Web Function from Oregon (`us-west-2`) and serve it from
Oregon and N. Virginia (`us-east-1`) through one Lambda-generated global URL.

Finish the [VPC cleanup](../04-vpc/README.md#4-clean-up) first. This stage starts a
fresh `lwf-multiregion` stack with a new Cognito pool and client in Oregon.
It uses Stage 1's public JWT path. Express verifies Cognito access tokens on
`/whoami` and `/stream`. The `/health` route is public. MultiRegion endpoints
require a revision without a VPC connector. [AWS networking guide](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html)

Use Bash or zsh with AWS CLI v2 that includes `lambda-web`, AWS credentials,
`curl`, and `jq`. Set `AWS_PROFILE` if needed. [Local prerequisites](../../README.md#local-prerequisites)

## 1. Deploy from the home Region

From the repository root, enter the stage folder and install dependencies.
Run the rest of the commands from this folder unless noted.

```sh
cd examples/05-multiregion
npm ci
```

Deploy once. This command accesses AWS.

```sh
npm run deploy
```

Execution environment and request rate limits apply per Region. Both Regions
can incur charges. [Lambda scaling](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html)

In the same terminal, load the global URL and check both Regions. These commands
access AWS.

```sh
source scripts/env.sh
BASE="$(stack_output "$STACK_NAME" PublicEndpointUrl)"
printf '%s\n' "$BASE"
FUNCTION_NAME="$(stack_output "$STACK_NAME" PublicFunctionName)"
aws lambda-web get-web-function-endpoint --region "$AWS_REGION" \
  --function-name "$FUNCTION_NAME" --endpoint-name public \
  --query '{revisionWeights:revisionWeights,regionalEndpoints:regionalEndpoints}' \
  --output json
```

Expect the URL to end in `.lambda-web.global.on.aws` and one revision at weight
100. Under `regionalEndpoints`, wait for Oregon and N. Virginia to report
`state: Active`. If `updateStatus` appears, wait for `Successful`. If deployment
fails, check the CloudFormation stack events and any regional status, then
clean up the failed deployment before retrying.

For code changes in this lab, tear down and redeploy. The endpoint keeps
serving its first revision until you promote another one. Changing the endpoint
type or Region set requires a new endpoint name and URL. [SAM WebFunction reference](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-webfunction.html)

## 2. Verify JWTs and compare routing

These commands access AWS and invoke the deployed endpoint. Replace
`you@example.com` with an email address for your lab user. `get-jwt` creates or
resets that user's password. The command below saves the access token in `TOKEN`.

```sh
curl -i "$BASE/health"
curl -i "$BASE/whoami"
TOKEN="$(npm run --silent get-jwt -- you@example.com)" &&
  curl --fail-with-body -isS -H "Authorization: Bearer $TOKEN" "$BASE/whoami"
```

Expect 200 for health, 401 for `/whoami` without a token, and 200 with a token.
The authenticated response includes `region`. The app resolves it from the
execution environment's AZ ID at startup. A missing or failed lookup shows
`null` until that environment is recycled. [Lambda metadata](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-configuration-metadata-endpoint.html)

### Compare two locations

Run the sample from two networks. If you only have one, use public AWS CloudShell
in Oregon and N. Virginia. In your original terminal, use `printf '%s\n' "$TOKEN"`
to copy the short-lived access token. In each new Bash session, replace the example
URL with the URL from step 1. When `read` waits for input, paste the token and
press Enter. Bash keeps that input out of shell history.

```bash
BASE='https://<id>.lambda-web.global.on.aws'
read -r -s TOKEN
```

Run this sample against the deployed endpoint in both locations.

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

### Optional CloudWatch check

Copy the `lambda-web-logstream` header from an authenticated `curl -i` response.
In CloudWatch Logs in Oregon, open `/aws/lambda/web/lwf-multiregion-public` and
find the stream whose name starts with that value. Compare Lambda's top-level
`region` on the startup log with the `region` in the response. Allow time for
logs to arrive. [Lambda log correlation](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-logging.html)

## 3. Tear down

When you finish this final stage, run the AWS command below from the stage
folder. It deletes the application stack and its Cognito users without prompting.

```sh
npm run teardown
```

In CloudFormation in Oregon, confirm that `lwf-multiregion` and
`lwf-multiregion-<hash>-WebFunctionCode` are deleted.

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
