#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

aws cloudformation delete-stack --stack-name "$STACK_NAME"
aws cloudformation wait stack-delete-complete --stack-name "$STACK_NAME"
echo "Deleted stack $STACK_NAME"

BUCKET="$(stack_output "$ARTIFACTS_STACK_NAME" BucketName 2>/dev/null || true)"
if [ -n "$BUCKET" ] && [ "$BUCKET" != "None" ]; then
  aws s3 rm "s3://${BUCKET}" --recursive
  echo "Emptied bucket $BUCKET"
fi

aws cloudformation delete-stack --stack-name "$ARTIFACTS_STACK_NAME"
aws cloudformation wait stack-delete-complete --stack-name "$ARTIFACTS_STACK_NAME"
echo "Deleted stack $ARTIFACTS_STACK_NAME"
