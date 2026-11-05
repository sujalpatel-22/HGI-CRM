#!/usr/bin/env bash
# ONE-TIME Google Cloud setup for HGI Billing's cloud service (service identity, secrets, PDF storage). The database is a
# Google Spreadsheet that YOU create and share with the service account (printed at the end) — docs/SHEETS-SETUP.md.
# Run it yourself in Cloud Shell (or let Claude run it after you approve). It shows every step and asks before changing anything.
#
#   PROJECT_ID=hgi-billing REGION=asia-south1 BUCKET=hgi-billing-pdfs bash deploy/setup-gcp.sh
#
# Needs: a Google Cloud project with BILLING ENABLED (Cloud Run and Cloud Storage need it),
# and an account with Owner (or Editor + Security Admin) on the project.
set -euo pipefail
: "${PROJECT_ID:?set PROJECT_ID}"; : "${REGION:=asia-south1}"; : "${BUCKET:=${PROJECT_ID}-hgi-pdfs}"
SA="hgi-sync@${PROJECT_ID}.iam.gserviceaccount.com"
step() { echo; echo "── $1"; shift; echo "   $*"; read -r -p "   Run this? [y/N] " a; [ "$a" = "y" ] && eval "$@" || echo "   skipped"; }

echo "Project $PROJECT_ID · region $REGION · PDF bucket gs://$BUCKET · service account $SA"
gcloud config set project "$PROJECT_ID" >/dev/null
step "Enable the APIs" gcloud services enable run.googleapis.com cloudbuild.googleapis.com artifactregistry.googleapis.com secretmanager.googleapis.com sheets.googleapis.com storage.googleapis.com
step "Service identity for the server" gcloud iam service-accounts create hgi-sync --display-name="HGI Billing sync service"
step "Let it read its secrets" gcloud projects add-iam-policy-binding "$PROJECT_ID" --member="serviceAccount:$SA" --role=roles/secretmanager.secretAccessor --condition=None
step "Private bucket for invoice PDFs (no public access, 30-day soft delete)" gcloud storage buckets create "gs://$BUCKET" --location="$REGION" --uniform-bucket-level-access --public-access-prevention --soft-delete-duration=30d
step "Let the server read/write PDFs in that bucket only" gcloud storage buckets add-iam-policy-binding "gs://$BUCKET" --member="serviceAccount:$SA" --role=roles/storage.objectAdmin
step "Session-ID signing secret (random, never leaves Secret Manager)" "openssl rand -base64 48 | tr -d '\n' | gcloud secrets create hgi-session-secret --data-file=-"
step "Password pepper (random; every password hash depends on it — NEVER delete or change it)" "openssl rand -base64 48 | tr -d '\n' | gcloud secrets create hgi-password-pepper --data-file=-"
echo
echo "GST look-up (optional now, needed for auto-fetch): put your GST provider's request headers in a secret, e.g."
echo "   echo -n '{\"x-api-key\":\"…\"}' | gcloud secrets create hgi-gst-headers --data-file=-"
echo "(and hgi-gst-auth-headers if the provider has a token step). See docs/CLOUD-SETUP.md."
step "E-invoice API-login encryption key (random 32 bytes; only for e-invoice / e-way bill)" "openssl rand -base64 32 | tr -d '\n' | gcloud secrets create hgi-edoc-cred-key --data-file=-"
echo "E-invoice / e-way bill through your GSP (after the GSP contract — docs/EINVOICE-SETUP.md):"
echo "   gcloud secrets create hgi-irp-client-secret --data-file=<file with the GSP client secret>"
echo "   gcloud secrets create hgi-irp-public-key   --data-file=<NIC / GSP public key .pem>"
echo "   (same for hgi-ewb-client-secret / hgi-ewb-public-key)"
echo
echo "Now the database:"
echo "  1. In Google Drive (the HGI company account), create a new, empty Google Sheets spreadsheet, e.g. 'HGI Billing data'."
echo "  2. Share it with   $SA   as Editor (untick 'Notify people'). Share it with nobody else except HGI administrators."
echo "  3. Copy its ID from the address bar: docs.google.com/spreadsheets/d/<ID>/edit"
echo
echo "Next: deploy the service with deploy/cloudrun.sh (SHEETS_SPREADSHEET_ID=<ID> FILES_BUCKET=$BUCKET)."
echo "The service creates the tabs and column headings itself on its first start."
