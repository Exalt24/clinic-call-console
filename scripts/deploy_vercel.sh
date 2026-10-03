#!/usr/bin/env bash
# Builds the Angular app for production and deploys the static output to Vercel.
#   bash scripts/deploy_vercel.sh <api_base_url>        e.g. https://clinic-call-console-api.onrender.com
# The API URL goes into the deployed copy of /config.json only, so the committed config stays pointed at localhost and one build
# can serve any API. The Vercel token is read from VERCEL_TOKEN_FILE (the workspace's Operations/.secrets/vercel_token.txt).
set -euo pipefail
API="${1:?usage: deploy_vercel.sh <api_base_url>}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TOKEN_FILE="${VERCEL_TOKEN_FILE:-C:/Projects/Professional/Operations/.secrets/vercel_token.txt}"
OUT="$ROOT/web/dist/web/browser"

cd "$ROOT/web"
npx ng build --configuration production
printf '{ "apiBaseUrl": "%s" }\n' "$API" > "$OUT/config.json"
cp vercel.json "$OUT/vercel.json"

cd "$OUT"
export VERCEL_TOKEN="$(tr -d '\r\n ' < "$TOKEN_FILE")"
npx --yes vercel@latest deploy --prod --yes --token "$VERCEL_TOKEN" --name clinic-call-console 2>&1 | tail -8
