#!/usr/bin/env bash
set -euo pipefail

if [ $# -ne 1 ] || [ -z "$1" ]; then
  echo "usage: smoke-jwt-user.sh <email>" >&2
  exit 2
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TOKEN="$(bash "$SCRIPT_DIR/create-test-user.sh" "$1")"
bash "$SCRIPT_DIR/smoke-jwt.sh" "$TOKEN"
