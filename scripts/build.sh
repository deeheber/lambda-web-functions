#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUT_DIR="${1:-$ROOT/dist}"
mkdir -p "$OUT_DIR"
OUT_DIR="$(cd "$OUT_DIR" && pwd)"

rm -f "$OUT_DIR/index.js" "$OUT_DIR/app.zip"

"$ROOT/node_modules/.bin/esbuild" "$ROOT/src/server.ts" \
  --bundle --platform=node --target=node24 --format=cjs \
  --outfile="$OUT_DIR/index.js"

# Lets `node dist/index.js` run the CJS bundle locally. Not zipped.
printf '{"type":"commonjs"}' > "$OUT_DIR/package.json"

(cd "$OUT_DIR" && zip -q -X app.zip index.js)

echo "zip: $OUT_DIR/app.zip"
echo "sha256: $(shasum -a 256 "$OUT_DIR/app.zip" | cut -d' ' -f1)"
