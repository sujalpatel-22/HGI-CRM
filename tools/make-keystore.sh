#!/usr/bin/env bash
# Creates the Android upload/signing key for HGI Billing and prints the GitHub Actions secrets.
# KEEP hgi-release.jks AND THE PASSWORD SAFE (e.g. password manager + offline copy):
# without them you can never publish an update of the app on Google Play.
set -euo pipefail
command -v keytool >/dev/null || { echo "keytool not found — install a Java JDK (17+)"; exit 1; }
OUT="${1:-hgi-release.jks}"
[ -e "$OUT" ] && { echo "$OUT already exists — refusing to overwrite"; exit 1; }
read -r -s -p "Choose a keystore password (min 8 chars): " PW; echo
[ ${#PW} -ge 8 ] || { echo "too short"; exit 1; }
read -r -s -p "Repeat password: " PW2; echo
[ "$PW" = "$PW2" ] || { echo "passwords differ"; exit 1; }
keytool -genkeypair -keystore "$OUT" -storepass "$PW" -keypass "$PW" -alias hgi-release \
  -keyalg RSA -keysize 4096 -validity 10000 -dname "CN=HARIGURU INDUSTRIES, O=HARIGURU INDUSTRIES, L=Ahmedabad, ST=Gujarat, C=IN" -noprompt
echo
echo "Created $OUT. Add these GitHub secrets (Settings → Secrets and variables → Actions):"
echo "  ANDROID_KEYSTORE_BASE64 = (contents of $OUT.base64.txt)"
echo "  ANDROID_KEYSTORE_PASSWORD = <the password you chose>"
echo "  ANDROID_KEY_ALIAS = hgi-release"
echo "  ANDROID_KEY_PASSWORD = <the same password>"
base64 -w0 "$OUT" > "$OUT.base64.txt" 2>/dev/null || base64 "$OUT" | tr -d '\n' > "$OUT.base64.txt"
FP=$(keytool -list -v -keystore "$OUT" -storepass "$PW" -alias hgi-release | sed -n 's/.*SHA256: //p' | head -1)
SHA1=$(keytool -list -v -keystore "$OUT" -storepass "$PW" -alias hgi-release | sed -n 's/.*SHA1: //p' | head -1)
echo "Delete $OUT.base64.txt after adding the secret."
echo
echo "Also add a repository VARIABLE (Settings → Secrets and variables → Actions → Variables):"
echo "  ANDROID_CERT_SHA256 = $FP"
echo "CI then refuses to publish a release signed with any other key."
echo
echo "For Sign in with Google, register this key in Google Cloud → APIs & Services → Credentials → Create OAuth client → Android:"
echo "  package name: in.hariguru.billing    SHA-1: $SHA1"
echo "(After the first upload to Google Play, also add the SHA-1 of Play's *app signing* key — Play Console → Test and release → App integrity.)"
