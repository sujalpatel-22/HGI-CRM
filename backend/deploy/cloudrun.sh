#!/usr/bin/env bash
# Deploys / updates the HGI Billing cloud service on Cloud Run. Asks before changing anything.
# Run deploy/setup-gcp.sh once first.
#
#   PROJECT_ID=hgi-billing REGION=asia-south1 GOOGLE_CLIENT_IDS=1234-abc.apps.googleusercontent.com \
#   FILES_BUCKET=hgi-billing-pdfs SUPPORT_EMAIL=info@hariguru.com \
#   GST_API_URL='https://<provider>/…{gstin}…' GST_API_NAME='<provider name>' [GST_API_AUTH_URL=… GST_API_TOKEN_PATH=… GST_API_TOKEN_HEADER=…] \
#   bash deploy/cloudrun.sh
#
# Secrets (Secret Manager): hgi-session-secret (always); hgi-gst-headers (when GST_API_URL is set);
# hgi-gst-auth-headers (when GST_API_AUTH_URL is set).
# E-invoice / e-way bill (optional, docs/EINVOICE-SETUP.md): EDOC_ENV=sandbox|production, IRP_BASE_URL, IRP_CLIENT_ID, EWB_BASE_URL, EWB_CLIENT_ID
#   [+ EDOC_CONFIRM_PRODUCTION=I-UNDERSTAND for production]; secrets hgi-edoc-cred-key, hgi-irp-client-secret, hgi-irp-public-key,
#   hgi-ewb-client-secret, hgi-ewb-public-key [, hgi-irp-extra-headers, hgi-ewb-extra-headers].
set -euo pipefail
cd "$(dirname "$0")/.."
: "${PROJECT_ID:?set PROJECT_ID}"; : "${REGION:=asia-south1}"; : "${GOOGLE_CLIENT_IDS:?set GOOGLE_CLIENT_IDS (OAuth Web client ID)}"
: "${SERVICE:=hgi-sync}"; : "${RUN_SA:=hgi-sync@${PROJECT_ID}.iam.gserviceaccount.com}"; : "${FILES_BUCKET:=}"; : "${GST_API_URL:=}"

node test/run-tests.js > /dev/null || { echo "Tests failed — not deploying"; exit 1; }
node scripts/build-pages.js

SECRETS="SESSION_SECRET=hgi-session-secret:latest"
[ -n "$GST_API_URL" ] && SECRETS="$SECRETS,GST_API_HEADERS=hgi-gst-headers:latest"
[ -n "${GST_API_AUTH_URL:-}" ] && SECRETS="$SECRETS,GST_API_AUTH_HEADERS=hgi-gst-auth-headers:latest"
: "${IRP_BASE_URL:=}"; : "${EWB_BASE_URL:=}"; : "${EDOC_ENV:=sandbox}"
if [ -n "$IRP_BASE_URL$EWB_BASE_URL" ]; then
  SECRETS="$SECRETS,EDOC_CRED_KEY=hgi-edoc-cred-key:latest"
  [ -n "$IRP_BASE_URL" ] && SECRETS="$SECRETS,IRP_CLIENT_SECRET=hgi-irp-client-secret:latest,IRP_PUBLIC_KEY=hgi-irp-public-key:latest"
  [ -n "$EWB_BASE_URL" ] && SECRETS="$SECRETS,EWB_CLIENT_SECRET=hgi-ewb-client-secret:latest,EWB_PUBLIC_KEY=hgi-ewb-public-key:latest"
  [ -n "${IRP_EXTRA_HEADERS_SECRET:-}" ] && SECRETS="$SECRETS,IRP_EXTRA_HEADERS=$IRP_EXTRA_HEADERS_SECRET:latest"
  [ -n "${EWB_EXTRA_HEADERS_SECRET:-}" ] && SECRETS="$SECRETS,EWB_EXTRA_HEADERS=$EWB_EXTRA_HEADERS_SECRET:latest"
fi
# '@' separates the variables (values such as URLs may contain commas)
ENVV="PROJECT_ID=$PROJECT_ID@GOOGLE_CLIENT_IDS=$GOOGLE_CLIENT_IDS@GCP_AUTH=metadata@FILES_BUCKET=$FILES_BUCKET@SUPPORT_EMAIL=${SUPPORT_EMAIL:-}"
ENVV="$ENVV@EDOC_ENV=$EDOC_ENV@EDOC_CONFIRM_PRODUCTION=${EDOC_CONFIRM_PRODUCTION:-}@IRP_BASE_URL=$IRP_BASE_URL@IRP_CLIENT_ID=${IRP_CLIENT_ID:-}@EWB_BASE_URL=$EWB_BASE_URL@EWB_CLIENT_ID=${EWB_CLIENT_ID:-}"
ENVV="$ENVV@GST_API_URL=$GST_API_URL@GST_API_NAME=${GST_API_NAME:-}@GST_API_AUTH_URL=${GST_API_AUTH_URL:-}@GST_API_TOKEN_PATH=${GST_API_TOKEN_PATH:-}@GST_API_TOKEN_HEADER=${GST_API_TOKEN_HEADER:-}"

echo "About to deploy '$SERVICE' to $PROJECT_ID ($REGION) as $RUN_SA"
echo "  PDF storage: ${FILES_BUCKET:-off} · GST look-up: ${GST_API_URL:+on}${GST_API_URL:-off}"
echo "  E-invoice (IRP): ${IRP_BASE_URL:-off} · E-way bill: ${EWB_BASE_URL:-off} · GST system: $EDOC_ENV"
read -r -p "Type DEPLOY to continue: " OK; [ "$OK" = "DEPLOY" ] || { echo "Cancelled"; exit 1; }

gcloud run deploy "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --source . \
  --service-account "$RUN_SA" --allow-unauthenticated --min-instances 0 --max-instances 4 --concurrency 40 --memory 512Mi --cpu 1 --timeout 120 \
  --set-env-vars "^@^$ENVV" --set-secrets "$SECRETS"

URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format 'value(status.url)')
echo; echo "Deployed: $URL"
curl -fsS "$URL/healthz" && echo
echo "Check: $URL/privacy · $URL/delete-account"
echo "Then: GitHub repository variable HGI_SYNC_URL=$URL; add $URL as an Authorized JavaScript origin of the Web OAuth client."
