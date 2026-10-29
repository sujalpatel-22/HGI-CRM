#!/usr/bin/env bash
# Deploys the HGI Billing sync service to Google Cloud Run.
# Run it yourself (or let Claude run it after you approve) — it asks before changing anything.
#
#   PROJECT_ID=hgi-billing REGION=asia-south1 \
#   GOOGLE_CLIENT_IDS=1234-abc.apps.googleusercontent.com \
#   DRIVE_FOLDER_ID=1AbC... DRIVE_AUTH=metadata SUPPORT_EMAIL=info@hariguru.com \
#   bash deploy/cloudrun.sh
#
# Secrets live in Secret Manager (created once, see docs/PLAY-RELEASE.md Part B):
#   hgi-session-secret            always
#   hgi-owner-client-id / hgi-owner-client-secret / hgi-owner-refresh-token   only for DRIVE_AUTH=owner-oauth
#   hgi-sa-key                    only for DRIVE_AUTH=sa-key
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PROJECT_ID:?set PROJECT_ID}"; : "${REGION:=asia-south1}"; : "${GOOGLE_CLIENT_IDS:?set GOOGLE_CLIENT_IDS (OAuth Web client ID)}"
: "${DRIVE_FOLDER_ID:?set DRIVE_FOLDER_ID}"; : "${DRIVE_AUTH:=metadata}"; : "${SERVICE:=hgi-sync}"; : "${RUN_SA:=hgi-sync@${PROJECT_ID}.iam.gserviceaccount.com}"

node test/run-tests.js > /dev/null || { echo "Tests failed — not deploying"; exit 1; }
node scripts/build-pages.js

SECRETS="SESSION_SECRET=hgi-session-secret:latest"
case "$DRIVE_AUTH" in
  owner-oauth) SECRETS="$SECRETS,OWNER_CLIENT_ID=hgi-owner-client-id:latest,OWNER_CLIENT_SECRET=hgi-owner-client-secret:latest,OWNER_REFRESH_TOKEN=hgi-owner-refresh-token:latest" ;;
  sa-key)      SECRETS="$SECRETS,SA_KEY_JSON=hgi-sa-key:latest" ;;
  metadata)    ;;
  *) echo "DRIVE_AUTH must be metadata, sa-key or owner-oauth"; exit 1 ;;
esac

echo "About to deploy '$SERVICE' to project $PROJECT_ID ($REGION), Drive access: $DRIVE_AUTH, runtime account: $RUN_SA"
read -r -p "Type DEPLOY to continue: " OK; [ "$OK" = "DEPLOY" ] || { echo "Cancelled"; exit 1; }

# max-instances 1: one instance keeps the per-account write order simple (it serves many users at once).
gcloud run deploy "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --source . \
  --service-account "$RUN_SA" --allow-unauthenticated --max-instances 1 --concurrency 40 --memory 512Mi --cpu 1 --timeout 120 \
  --set-env-vars "GOOGLE_CLIENT_IDS=$GOOGLE_CLIENT_IDS,DRIVE_FOLDER_ID=$DRIVE_FOLDER_ID,DRIVE_AUTH=$DRIVE_AUTH,SUPPORT_EMAIL=${SUPPORT_EMAIL:-},SHARE_WITH=${SHARE_WITH:-}" \
  --set-secrets "$SECRETS"

URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')
echo; echo "Deployed: $URL"
curl -fsS "$URL/healthz" && echo
echo "Next: set the GitHub repository variable HGI_SYNC_URL=$URL and add $URL as an Authorized JavaScript origin of the Web OAuth client."
