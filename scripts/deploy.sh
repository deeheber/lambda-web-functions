#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

bash "$ROOT/scripts/build.sh"

aws cloudformation deploy \
  --stack-name "$ARTIFACTS_STACK_NAME" \
  --template-file "$ROOT/infra/artifacts.yaml" \
  --no-fail-on-empty-changeset

BUCKET="$(stack_output "$ARTIFACTS_STACK_NAME" BucketName)"
SHA="$(shasum -a 256 "$ROOT/dist/app.zip" | cut -d' ' -f1)"
KEY="app-${SHA}.zip"

aws s3 cp "$ROOT/dist/app.zip" "s3://${BUCKET}/${KEY}"

# Extra Name=Value arguments pass through to the stack parameters.
aws cloudformation deploy \
  --stack-name "$STACK_NAME" \
  --template-file "$ROOT/infra/app.yaml" \
  --capabilities CAPABILITY_IAM \
  --no-fail-on-empty-changeset \
  --parameter-overrides "CodeBucket=$BUCKET" "CodeKey=$KEY" "$@"

aws cloudformation describe-stacks --stack-name "$STACK_NAME" \
  --query "Stacks[0].Outputs[].[OutputKey,OutputValue]" --output table
