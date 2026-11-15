#!/usr/bin/env bash
# Read-only status of the HGI Billing cloud set-up (prints names and settings, never secret values).
#   PROJECT_ID=hgi-billing [REGION=asia-south1] [BUCKET=hgi-billing-pdfs] bash deploy/status.sh
: "${PROJECT_ID:?set PROJECT_ID}"; : "${REGION:=asia-south1}"; : "${SERVICE:=hgi-sync}"; : "${BUCKET:=}"
SA="hgi-sync@${PROJECT_ID}.iam.gserviceaccount.com"
ok() { echo "OK    $*"; }; no() { echo "MISS  $*"; }
echo "== HGI status for $PROJECT_ID ($REGION)"
gcloud billing projects describe "$PROJECT_ID" --format='value(billingEnabled)' 2>/dev/null | grep -qi true && ok "billing enabled" || no "billing"
EN=$(gcloud services list --enabled --project "$PROJECT_ID" --format='value(config.name)' 2>/dev/null)
for a in run cloudbuild artifactregistry secretmanager sheets storage; do echo "$EN" | grep -q "^$a.googleapis.com$" && ok "API $a" || no "API $a"; done
gcloud iam service-accounts describe "$SA" --project "$PROJECT_ID" >/dev/null 2>&1 && ok "service account $SA" || no "service account $SA"
gcloud projects get-iam-policy "$PROJECT_ID" --flatten='bindings[].members' --filter="bindings.members:serviceAccount:$SA" --format='value(bindings.role)' 2>/dev/null | grep -q secretmanager.secretAccessor && ok "SA can read secrets" || no "SA secretAccessor role"
for s in hgi-session-secret hgi-password-pepper; do n=$(gcloud secrets versions list "$s" --project "$PROJECT_ID" --filter='state=enabled' --format='value(name)' 2>/dev/null | wc -l); [ "$n" -ge 1 ] && ok "secret $s ($n enabled version)" || no "secret $s"; done
if [ -n "$BUCKET" ]; then
  d=$(gcloud storage buckets describe "gs://$BUCKET" --format='value(public_access_prevention,uniform_bucket_level_access,location)' 2>/dev/null)
  [ -n "$d" ] && ok "bucket gs://$BUCKET [$d]" || no "bucket gs://$BUCKET"
  gcloud storage buckets get-iam-policy "gs://$BUCKET" --format=json 2>/dev/null | grep -q "serviceAccount:$SA" && ok "SA has access to the bucket" || no "SA bucket access"
fi
URL=$(gcloud run services describe "$SERVICE" --project "$PROJECT_ID" --region "$REGION" --format='value(status.url)' 2>/dev/null)
if [ -n "$URL" ]; then ok "Cloud Run $URL"; echo "      healthz: $(curl -s --max-time 30 "$URL/healthz")"; else no "Cloud Run service $SERVICE"; fi
echo "== end"
