#!/usr/bin/env bash
# Idempotent repair for setup-gcp.sh: creates the hgi-sync service account if missing and (re)applies its two grants.
#   PROJECT_ID=hgi-billing [BUCKET=hgi-billing-pdfs] bash deploy/fix-service-account.sh
set -uo pipefail
: "${PROJECT_ID:?set PROJECT_ID}"; : "${BUCKET:=}"
SA="hgi-sync@${PROJECT_ID}.iam.gserviceaccount.com"
if ! gcloud iam service-accounts describe "$SA" --project "$PROJECT_ID" >/dev/null 2>&1; then
  gcloud iam service-accounts create hgi-sync --project "$PROJECT_ID" --display-name="HGI Billing sync service" || exit 1
fi
for i in $(seq 1 12); do gcloud iam service-accounts describe "$SA" --project "$PROJECT_ID" >/dev/null 2>&1 && break; sleep 5; done
for i in 1 2 3; do gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor --condition=None --format=none && break; sleep 10; done
[ -n "$BUCKET" ] && for i in 1 2 3; do gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role=roles/storage.objectAdmin --format=none && break; sleep 10; done
echo "FIX-DONE $SA"
