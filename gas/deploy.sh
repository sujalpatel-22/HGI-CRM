#!/usr/bin/env bash
# Builds and deploys the free server (Google Apps Script web app). Run in Cloud Shell as the spreadsheet's owner, after
# `npm i -g @google/clasp@2.4.2 && clasp login` (docs/FREE-SERVER.md).
#
#   SHEET_ID=<spreadsheet ID> bash gas/deploy.sh      first time: creates the script bound to that spreadsheet
#   bash gas/deploy.sh                                 later: pushes the new code to the SAME deployment (same URL)
#
# The script ID and deployment ID are kept in ~/.hgi-gas (outside the repository).
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT=$(pwd); STATE="$HOME/.hgi-gas"; mkdir -p "$STATE"
rm -rf gas/dist && mkdir -p gas/dist && cd gas/dist
if [ -f "$STATE/.clasp.json" ]; then
  cp "$STATE/.clasp.json" .
else
  : "${SHEET_ID:?first run: set SHEET_ID to the spreadsheet ID}"
  clasp create --title "HGI Billing server" --parentId "$SHEET_ID" --rootDir .
  cp .clasp.json "$STATE/"
fi
cd "$ROOT" && node tools/build-gas.mjs && cd gas/dist
cp "$STATE/.clasp.json" .
clasp push -f
if [ -s "$STATE/deployment" ]; then
  clasp deploy -i "$(cat "$STATE/deployment")" -d "HGI Billing $(date -u +%Y-%m-%dT%H:%MZ)"
else
  OUT=$(clasp deploy -d "HGI Billing 9.4"); echo "$OUT"
  echo "$OUT" | grep -o 'AKfy[A-Za-z0-9_-]*' | head -1 > "$STATE/deployment"
fi
echo "SCRIPT_ID=$(node -p "require('$STATE/.clasp.json').scriptId")"
echo "URL=https://script.google.com/macros/s/$(cat "$STATE/deployment")/exec"
