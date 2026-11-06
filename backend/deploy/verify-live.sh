#!/usr/bin/env bash
# Live check of the deployed service against the REAL spreadsheet, including a restart. Run it in Cloud Shell after
# deploy/cloudrun.sh. It needs no secret: it creates throw-away accounts with random passwords and deletes them again.
#
#   PROJECT_ID=hgi-billing REGION=asia-south1 bash deploy/verify-live.sh
#
#   1. full check (sign-up, log-in, upload, byte-for-byte read-back, two accounts kept apart, log-out / log-in) and
#      keeps one test account;
#   2. restarts the service by starting a new revision (asks first; no setting changes except a marker variable);
#   3. checks that the NEW instance, which can only have read the spreadsheet, serves the same data; deletes the account.
# Paste the PASS / FAIL lines back to Claude if you like — they contain no password or key.
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PROJECT_ID:?set PROJECT_ID}"; : "${REGION:=asia-south1}"; : "${SERVICE:=hgi-sync}"
URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')
[ -n "$URL" ] || { echo "Service $SERVICE not found in $PROJECT_ID/$REGION"; exit 1; }
STATE=$(mktemp -d)/hgi-verify.json            # private temp file; removed by phase 3
trap 'rm -rf "$(dirname "$STATE")"' EXIT
echo "Service: $URL"; echo
echo "── Phase 1: full check, keeping one test account"
node scripts/verify-deployment.js "$URL" --keep "$STATE" || { echo "Phase 1 failed — stopping (the kept test account, if any, is named verify-… in Users)."; exit 1; }
echo
read -r -p "── Phase 2: restart the service now (new revision, a few seconds; it sets only HGI_VERIFY_RESTART)? [y/N] " a
[ "$a" = "y" ] || { echo "Skipped — the test account stays until you run: node scripts/verify-deployment.js $URL --resume $STATE"; trap - EXIT; exit 0; }
gcloud run services update "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --update-env-vars "HGI_VERIFY_RESTART=$(date -u +%Y%m%dT%H%M%SZ)" --quiet
sleep 5
echo; echo "── Phase 3: the new instance must serve the same data from the spreadsheet"
node scripts/verify-deployment.js "$URL" --resume "$STATE"
