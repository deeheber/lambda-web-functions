# MultiRegion

Deploy a Lambda Web Function in Oregon (`us-west-2`). Lambda replicates it to
N. Virginia (`us-east-1`) and gives you one URL for both Regions.

## Before you start

- Finish the [Stage 4 cleanup](../04-vpc/README.md#4-clean-up). MultiRegion endpoints require a revision without a VPC connector. [AWS networking guide](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-networking.html)
- Check the [local prerequisites](../../README.md#local-prerequisites). For this walkthrough, use Bash or zsh with `curl`, `jq`, and an AWS CLI v2 that supports `lambda-web`.
- Configure AWS credentials. Set `AWS_PROFILE` if you use a named profile.

From the repository root, enter the stage folder and install dependencies.
Run the rest of the commands from this folder unless noted.

```sh
cd examples/05-multiregion
npm ci
```

### Check locally

These optional checks use fake metadata and Cognito keys and run without AWS credentials.

```sh
npm run typecheck
npm run lint
npm test
npm run test:bundle
cfn-lint --regions us-west-2 --template template.yaml
```

## 1. Deploy from the home Region

Deploy the new `lwf-multiregion` stack. This command creates the function and
a new Cognito user pool and app client in Oregon.

```sh
npm run deploy
```

Execution environment and request rate limits apply per Region. Both Regions
can incur charges. [Lambda scaling](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-scaling.html)

Lambda lists the Web Function only in its home Region (Oregon). To check the
N. Virginia replica, query the endpoint from Oregon. [Replica visibility](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-replication.html)

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

- The URL ends in `.lambda-web.global.on.aws`.
- `revisionWeights` shows one revision receiving 100% of traffic.
- Rerun the endpoint query until `regionalEndpoints` shows `state: Active` for both Regions and any `updateStatus` field reads `Successful`.

If deployment fails, check the CloudFormation stack events and each Region's
status. Clean up the failed deployment before retrying.

## 2. Verify JWTs and compare routing

As in Stage 1, `/health` is public. Express checks the Cognito access token
on `/whoami` and `/stream`.

These commands access AWS and invoke the deployed endpoint. Replace
`you@example.com` with an email address for your lab user. `get-jwt` creates or
resets that user's password.

```sh
curl -i "$BASE/health"
curl -i "$BASE/whoami"
TOKEN="$(npm run --silent get-jwt -- you@example.com)" &&
  curl --fail-with-body -isS -H "Authorization: Bearer $TOKEN" "$BASE/whoami"
```

| Request | Expected status |
| --- | --- |
| `/health` | `200 OK` |
| `/whoami` without a token | `401 Unauthorized` |
| `/whoami` with a valid token | `200 OK` |

Look for `region` in the authenticated response to see which AWS Region handled the request.

If `region` is `null`, the app couldn't determine its Region from the
Availability Zone ID at startup. It checks once per execution environment.
[Lambda metadata](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-configuration-metadata-endpoint.html)

### Check routing from your terminal

Run the loop in the same terminal to see the Region and timings for each request.

```bash
for attempt in 1 2 3; do
  curl --fail --silent --show-error \
    --write-out '%{stderr}dns=%{time_namelookup}s first_byte=%{time_starttransfer}s total=%{time_total}s\n' \
    -H "Authorization: Bearer $TOKEN" "$BASE/whoami" | jq -r '.region'
done
```

### Optional comparison from another network

1. Note your network, the Region, and the timings.
2. Switch your laptop to another network, such as a phone hotspot. Keep the
   terminal open so you can reuse the same URL and token.
3. Run the loop again and compare the results.

Both networks may reach the same Region. Lambda chooses a Region using
estimated latency, and DNS caching can affect the result. [Multi-Region routing](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-endpoint-replication.html)

A slower first request can include a cold start or the time it takes to fetch
Cognito signing keys from Oregon.

### Optional CloudWatch check

| Log group in Oregon | What you'll see |
| --- | --- |
| `/aws/lambda/web/lwf-multiregion-public` | Logs from both Regions. |
| `/aws/lambda/web/lwf-multiregion-public.local` | Logs from Oregon only. |

Lambda creates a Region's `.local` log group only after the function handles
its first request there. If all requests ran in Oregon, N. Virginia has no
`.local` group yet. The two Oregon groups show the same events once Lambda
finishes copying them.

1. In the authenticated `/whoami` response, note the `region` in the body and
   copy the value of the `lambda-web-logstream` header.
2. In CloudWatch Logs, select Oregon and open the log group
   `/aws/lambda/web/lwf-multiregion-public`.
3. Open the log stream whose name starts with the header value you copied.
   If it hasn't appeared yet, wait and refresh.
4. Find the startup event containing `"msg":"listening"`. Compare its top-level
   `region` with the one from `/whoami`. [Lambda log correlation](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-logging.html)

## 3. Tear down

This command deletes the AWS application stack and its Cognito users without prompting.

```sh
npm run teardown
```

In CloudFormation in Oregon, confirm that `lwf-multiregion` and
`lwf-multiregion-<hash>-WebFunctionCode` are deleted.

CloudWatch log groups can remain and retain events indefinitely by default.
If you no longer need those logs, run these AWS cleanup commands for the groups
that exist.

```sh
LOG_GROUP=/aws/lambda/web/lwf-multiregion-public
aws logs delete-log-group --region us-west-2 --log-group-name "$LOG_GROUP"
aws logs delete-log-group --region us-west-2 --log-group-name "$LOG_GROUP.local"
aws logs delete-log-group --region us-east-1 --log-group-name "$LOG_GROUP.local"
```
