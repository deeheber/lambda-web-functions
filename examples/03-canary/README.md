# Canary

Deploy a candidate build to 10% of traffic, promote it, then roll back through
CloudFormation.

Run every command from `examples/03-canary`. This stage updates the same `lwf`
stack in `us-west-2`. Continue from CloudFront without teardown. Your existing
custom domain and certificate continue to work without changes.

## Changes from CloudFront

- `/whoami` adds `buildId`, compiled from `BUILD_ID` in `src/config.ts`.
- `CurrentRevisionId` reports the stack-managed revision, which may not be serving traffic.
- `UpdateReplacePolicy: Retain` preserves replaced revisions for rollback;
  `DeletionPolicy: Delete` keeps normal teardown behavior. SAM passes both policies
  to the generated function, execution role, revision, and endpoint.
- The function, endpoint, Cognito pool/client, distribution, OAC, and optional DNS
  records keep their logical IDs. Adding the build identifier replaces the revision
  and can leave the preceding CloudFront revision retained.

SAM's `AutoDeploymentMode: LatestRevision` routes to the stack's generated revision.
`Disabled` pins routing to the IDs in `RevisionWeights`. These template settings
do not change the service's separate automatic-deployment mode.

## Check locally

Requires Node 24.2+, SAM CLI 1.170+, and cfn-lint. Scripts use Bash; tests also require zsh.
Tests do not call AWS; dependency installation may need network.

```sh
npm ci
npm run typecheck
npm run lint
npm test
npm run test:bundle
cfn-lint template.yaml
cfn-lint --regions us-east-1 --template certificate.yaml
```

Use `npm run build` for a build alone. Bare `sam build` omits the required ESM
package marker.

For local development, run `npm run dev`. In another terminal, `/health` returns
200 and `/whoami` without a JWT returns 401:

```sh
curl -i localhost:3000/health
curl -i localhost:3000/whoami
```

Stop the server with Ctrl+C. Local development uses placeholder Cognito IDs.

## 1. Deploy the baseline

The remaining numbered steps access AWS and the deployed application. Requires
AWS CLI v2 with `lambda-web` support and credentials; set `AWS_PROFILE` if needed.
Start with the checked-in `BUILD_ID = "baseline-v1"` and `AutoDeploymentMode: LatestRevision`.

```sh
npm run deploy -- --confirm-changeset &&
source scripts/env.sh &&
FUNCTION_NAME="$(stack_output "$STACK_NAME" IamFunctionName)" &&
BASE="$(stack_output "$STACK_NAME" CloudFrontEndpointUrl)" &&
BASELINE_REV="$(stack_output "$STACK_NAME" CurrentRevisionId)" &&
printf 'Baseline revision: %s\n' "$BASELINE_REV"
```

Review the change set before accepting: only the revision should need replacement.
Record the baseline ID and keep this terminal open. Do not overwrite `BASELINE_REV`
after creating the candidate.

Define this read-only check:

```sh
check_endpoint() {
  aws lambda-web wait web-function-endpoint-updated \
    --function-name "$FUNCTION_NAME" --endpoint-name iam &&
  aws lambda-web get-web-function-endpoint \
    --function-name "$FUNCTION_NAME" --endpoint-name iam \
    --query '{mode:autoDeploymentMode,status:updateStatus,weights:revisionWeights}'
}
check_endpoint
```

Expect service mode `Disabled`, update status `Successful`, and your baseline ID
at weight 100. Stop if the waiter fails or these values differ. Console changes
or `aws lambda-web deploy` can enable service mode `LatestRevision`, which would
send traffic to a new candidate immediately. Do not use either during this exercise.

```sh
# Optional: use this only if you configured a custom domain.
# BASE="$(stack_output "$STACK_NAME" CustomDomainUrl)"
curl -i "$BASE/health"
TOKEN="$(npm run --silent get-jwt -- you@example.com)" # Replace with your test user's email.
export TOKEN
npm run sample -- "$BASE" 100
```

Expect health 200 and all successful samples to report `baseline-v1`.
`get-jwt` creates the test user if needed and resets its password.
Refresh `TOKEN` with the same command if it expires; 401s are failures, not build samples.

## 2. Pin traffic to the baseline

Under `IamFunction.Properties` in `template.yaml`, replace
`AutoDeploymentMode: LatestRevision` with the following. Use the recorded revision
ID as the YAML key; shell variables and parameter references do not work here.

```yaml
      AutoDeploymentMode: Disabled
      RevisionWeights:
        rev-REPLACE-WITH-BASELINE-ID: 100 # Use the recorded baseline revision ID.
```

```sh
npm run deploy -- --confirm-changeset &&
check_endpoint
```

Expect baseline 100 and status `Successful`. Also check that the baseline is `Active`
before creating the candidate:

```sh
aws lambda-web get-web-function-revision \
  --function-name "$FUNCTION_NAME" --revision-id "$BASELINE_REV" --query state
```

For this deployment, keep code and revision settings unchanged. The change set
must not replace `IamFunctionRevision`.

## 3. Create the candidate without traffic

Change only this line in `src/config.ts`:

```ts
export const BUILD_ID = "candidate-v2";
```

Keep the baseline-only weights from step 2, then deploy:

```sh
npm run deploy -- --confirm-changeset &&
CANDIDATE_REV="$(stack_output "$STACK_NAME" CurrentRevisionId)" &&
printf 'Candidate revision: %s\n' "$CANDIDATE_REV" &&
check_endpoint &&
aws lambda-web get-web-function-revision \
  --function-name "$FUNCTION_NAME" --revision-id "$BASELINE_REV" --query state &&
aws lambda-web get-web-function-revision \
  --function-name "$FUNCTION_NAME" --revision-id "$CANDIDATE_REV" --query state
```

Expect a new candidate ID, both revisions `Active`, and baseline still receiving
100% with status `Successful`. Record the candidate ID, then sample:

```sh
npm run sample -- "$BASE" 100
```

Expect only `baseline-v1` responses.

Through rollback, change only the weights. Code, dependency, timeout, logging, or
environment changes can replace the revision. Unchanged builds reuse SAM's artifact;
stop if a traffic-only change set proposes revision replacement.

## 4. Split traffic 90/10

Replace only the `RevisionWeights` map in `template.yaml`:

```yaml
      RevisionWeights:
        rev-REPLACE-WITH-BASELINE-ID: 90 # Use BASELINE_REV's recorded value.
        rev-REPLACE-WITH-CANDIDATE-ID: 10 # Use CANDIDATE_REV's recorded value.
```

```sh
npm run deploy -- --confirm-changeset &&
check_endpoint
```

Confirm the baseline is at 90, the candidate at 10, and status is `Successful`, then sample:

```sh
npm run sample -- "$BASE" 100
```

Expect mostly `baseline-v1` responses with some `candidate-v2`. Small samples can
miss the candidate or differ from 90/10; repeat or increase the count.

Percentages count successful responses; failures are listed separately without
automatic retries. If you see 429s, wait briefly and repeat; investigate persistent failures.
The app's `Cache-Control: no-store` prevents cached responses from distorting observations.

Check streaming and authentication through the same hostname:

```sh
curl -i "$BASE/whoami"
curl -i -N "$BASE/stream" -H "Authorization: Bearer $TOKEN"
```

Expect 401 without the token, and 200 with stream ticks arriving over time.

## 5. Promote the candidate

Replace the map with a single candidate entry; keep `AutoDeploymentMode: Disabled`:

```yaml
      RevisionWeights:
        rev-REPLACE-WITH-CANDIDATE-ID: 100 # Use the recorded candidate revision ID.
```

```sh
npm run deploy -- --confirm-changeset &&
check_endpoint
```

Confirm the candidate is at 100 and status is `Successful`, then sample:

```sh
npm run sample -- "$BASE" 100
```

Expect `candidate-v2` in every successful sample.
Remove the baseline entry rather than setting its weight to zero. Weights must be
1–100 and total 100; SAM's transform rejects zero even if cfn-lint accepts it.

## 6. Roll back through CloudFormation

Keep the candidate source and replace only the map:

```yaml
      RevisionWeights:
        rev-REPLACE-WITH-BASELINE-ID: 100 # Use the original baseline revision ID.
```

```sh
npm run deploy -- --confirm-changeset &&
check_endpoint
```

Confirm the original baseline ID is at 100 and status is `Successful`, then sample:

```sh
npm run sample -- "$BASE" 100
```

Expect only `baseline-v1` responses.
`CurrentRevisionId` still identifies the candidate; rollback changes only routing.

Complete this exercise before creating further revisions. Replaced revisions leave
CloudFormation's management. Lambda can automatically delete old, unused revisions
when its revision count exceeds the cleanup target of 50; after promotion, the
baseline is unused. Retention is not an indefinite rollback guarantee.

SAM manages a separate code bucket stack. Revisions keep reading their code from
that bucket, so do not delete its objects/versions or change access policies while
using these revisions.

## Continue or clean up

Leave the application and optional domain deployed to continue along the
[roadmap](../../ROADMAP.md). A later stage using SAM's default `LatestRevision`
routes to that deployment's revision, even if this stage ended serving the retained
baseline.

<details>
<summary>Optional: remove the custom domain</summary>

These commands access AWS. Keep your current revision weights and remove only the
domain association and DNS aliases:

```sh
npm run deploy -- --confirm-changeset --parameter-overrides \
  'DomainName=""' 'CertificateArn=""' 'HostedZoneId=""'
```

After the distribution update completes, you can delete the separate certificate stack:

```sh
CERT_STACK='lwf-cloudfront-certificate' # Replace if you used another certificate stack name.
aws cloudformation delete-stack --region us-east-1 --stack-name "$CERT_STACK"
aws cloudformation wait stack-delete-complete --region us-east-1 --stack-name "$CERT_STACK"
```

Keep the hosted zone. Before removing ACM validation CNAMEs, check whether another
certificate uses them, including in other Regions.

</details>

<details>
<summary>Optional: delete the tutorial resources</summary>

These commands access AWS and remove the application, including Cognito users:

```sh
npm run teardown
```

Deleting the Web Function also deletes its retained revisions and endpoints.
SAM then empties and deletes the managed code bucket stack. Retention applies to
replacement, not teardown. Any roles or functions retained by earlier replacements
need separate cleanup.

After application teardown completes, delete the separate certificate stack using
the preceding section's commands, if you created it. Keep the hosted zone and any
validation records still in use.

CloudWatch log groups can remain. Follow the
[CloudFront log cleanup instructions](../02-cloudfront/README.md#continue-or-clean-up)
if you no longer need the old or current logs.

</details>

## AWS references

- [SAM Web Function and generated routing](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-resource-webfunction.html)
- [RevisionWeights](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/sam-property-webfunction-revisionweights.html)
- [Deployment patterns and asynchronous updates](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-deployment.html)
- [Revision lifecycle and automatic cleanup](https://docs.aws.amazon.com/lambda/latest/dg/web-functions-revisions.html)
- [SAM packaging and code-bucket lifecycle](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/using-sam-cli-deploy.html)
- [Replacement retention](https://docs.aws.amazon.com/AWSCloudFormation/latest/TemplateReference/aws-attribute-updatereplacepolicy.html)
- [Web Function deletion](https://docs.aws.amazon.com/lambda/latest/lambda-web/API_DeleteWebFunction.html)
