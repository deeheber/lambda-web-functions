#!/usr/bin/env bash
set -euo pipefail

if [ $# -lt 1 ] || [ -z "$1" ]; then
  echo "usage: smoke-jwt.sh <access-token>" >&2
  exit 2
fi
TOKEN="$1"

source "$(dirname "${BASH_SOURCE[0]}")/env.sh"

BASE="$(stack_output "$STACK_NAME" PublicEndpointUrl)"
FAILED=0

pass() { echo "PASS $1"; }
fail() { echo "FAIL $1"; FAILED=1; }

json_field() { # json_field <json> <field>
  node -e 'const o = JSON.parse(process.argv[1]); const v = o[process.argv[2]]; process.stdout.write(v === null || v === undefined ? "" : String(v));' "$1" "$2"
}

# GET <path> [curl args...] -> sets STATUS and BODY
get() {
  local path="$1"
  shift
  local out
  out="$(curl -sS -w $'\n%{http_code}' "$@" "$BASE$path")"
  STATUS="${out##*$'\n'}"
  BODY="${out%$'\n'*}"
}

get /health
if [ "$STATUS" = 200 ] && [ "$(json_field "$BODY" status)" = ok ]; then pass "health without token"; else fail "health without token ($STATUS)"; fi

get /whoami
if [ "$STATUS" = 401 ]; then pass "whoami without token is 401"; else fail "whoami without token is 401 ($STATUS)"; fi

get /whoami -H "Authorization: Bearer $TOKEN"
if [ "$STATUS" = 200 ] && [ "$(json_field "$BODY" authMode)" = jwt ] && [ -n "$(json_field "$BODY" subject)" ]; then
  pass "whoami with token"
else
  fail "whoami with token ($STATUS)"
fi

HEADERS="$(mktemp)"
STREAM="$(curl -sS -N --max-time 30 -D "$HEADERS" -H "Authorization: Bearer $TOKEN" "$BASE/stream")"
if head -n 1 "$HEADERS" | grep -q ' 200' && grep -qi '^content-type: text/event-stream' "$HEADERS"; then
  if echo "$STREAM" | node -e '
    const lines = require("fs").readFileSync(0, "utf8").split("\n").filter((l) => l.startsWith("data: "));
    const ok = lines.length >= 1 && lines.every((l, i) => JSON.parse(l.slice(6)).tick === i + 1);
    process.exit(ok ? 0 : 1);
  '; then
    pass "stream with token"
  else
    fail "stream ticks are not consecutive"
  fi
else
  fail "stream with token (status or content-type)"
fi
rm -f "$HEADERS"

exit "$FAILED"
