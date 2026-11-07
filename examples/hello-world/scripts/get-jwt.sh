#!/usr/bin/env bash
# TOKEN="$(npm run --silent get-jwt -- you@example.com)" (resets password)
set -euo pipefail

if [ $# -ne 1 ] || [ -z "$1" ]; then
  echo "usage: get-jwt.sh <email>" >&2
  exit 2
fi
EMAIL="$1"

source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

POOL_ID="$(stack_output "$STACK_NAME" UserPoolId)"
CLIENT_ID="$(stack_output "$STACK_NAME" UserPoolClientId)"
PASSWORD="${TEST_USER_PASSWORD:-Aa1!$(openssl rand -hex 12)}"

if ! CREATE_ERROR="$(aws cognito-idp admin-create-user \
  --user-pool-id "$POOL_ID" \
  --username "$EMAIL" \
  --message-action SUPPRESS \
  --user-attributes "Name=email,Value=$EMAIL" "Name=email_verified,Value=true" 2>&1 >/dev/null)"; then
  case "$CREATE_ERROR" in
    *"(UsernameExistsException)"*) ;;
    *) printf '%s\n' "$CREATE_ERROR" >&2; exit 1 ;;
  esac
fi

aws cognito-idp admin-set-user-password \
  --user-pool-id "$POOL_ID" \
  --username "$EMAIL" \
  --password "$PASSWORD" \
  --permanent >&2

TOKEN="$(aws cognito-idp initiate-auth \
  --auth-flow USER_PASSWORD_AUTH \
  --client-id "$CLIENT_ID" \
  --auth-parameters "USERNAME=$EMAIL,PASSWORD=$PASSWORD" \
  --query AuthenticationResult.AccessToken \
  --output text)"
if [ -z "$TOKEN" ] || [ "$TOKEN" = None ]; then
  echo "Sign-in did not return an access token" >&2
  exit 1
fi
printf '%s\n' "$TOKEN"
