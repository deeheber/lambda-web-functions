#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ] || [ -z "$1" ]; then
  echo "usage: create-test-user.sh <email>" >&2
  exit 2
fi
EMAIL="$1"

source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

POOL_ID="$(stack_output "$STACK_NAME" UserPoolId)"
CLIENT_ID="$(stack_output "$STACK_NAME" UserPoolClientId)"
PASSWORD="${TEST_USER_PASSWORD:-Aa1!$(openssl rand -hex 12)}"

if ! aws cognito-idp admin-create-user \
  --user-pool-id "$POOL_ID" \
  --username "$EMAIL" \
  --message-action SUPPRESS \
  --user-attributes "Name=email,Value=$EMAIL" "Name=email_verified,Value=true" >/dev/null; then
  echo "admin-create-user failed (the user may already exist); continuing" >&2
fi

aws cognito-idp admin-set-user-password \
  --user-pool-id "$POOL_ID" \
  --username "$EMAIL" \
  --password "$PASSWORD" \
  --permanent >&2

echo "User $EMAIL ready" >&2

aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$CLIENT_ID" \
  --auth-parameters "USERNAME=$EMAIL,PASSWORD=$PASSWORD" \
  --query AuthenticationResult.AccessToken \
  --output text
