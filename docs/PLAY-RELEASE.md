# HGI Billing 8.1 — Google Play release checklist

What changed in 8.1:
- **Sign in with Google is required.** Each Google account has its own data on the phone and its own cloud copy.
- **Automatic cloud sync.** Every change uploads in the background (and when the app goes to the background) to the
  HGI sync service on Google Cloud Run. The service keeps each account's data in **its own Google Sheets spreadsheet in the
  HGI company Drive**. Manual JSON backups are no longer needed. "Share Backup" still exists as an optional file export.
- **Reinstall = sign in.** After uninstalling and reinstalling (or on a new phone), signing in with the same Google account
  restores everything.
- **One permanent release key** created on your PC, consistent package ID `in.hariguru.billing`, versionCode that only goes up.

Nothing secret is inside the app: it only knows the public sync-service URL and the public OAuth web client ID.

---

## Part A — one-time: permanent release key (on your PC)

1. Install a Java JDK 17 or newer (for example Eclipse Temurin).
2. In the project folder run **one** of:
   - Windows PowerShell: `powershell -ExecutionPolicy Bypass -File tools\make-keystore.ps1`
   - macOS / Linux: `bash tools/make-keystore.sh`
3. It creates `hgi-release.jks` and prints what to add in GitHub (repo → Settings → Secrets and variables → Actions):
   - **Secrets:** `ANDROID_KEYSTORE_BASE64` (contents of `hgi-release.jks.base64.txt`), `ANDROID_KEYSTORE_PASSWORD`,
     `ANDROID_KEY_ALIAS` = `hgi-release`, `ANDROID_KEY_PASSWORD`.
   - **Variable:** `ANDROID_CERT_SHA256` = the printed SHA-256. CI then refuses any other key.
   - Note the printed **SHA-1**. You need it for the Android OAuth client in Part B.
4. Delete `hgi-release.jks.base64.txt`. Keep `hgi-release.jks` and its password in two safe places, for example a
   password manager plus an offline copy. **If the key is lost, the app can never be updated.**

Never use the CI test key for customers. CI already refuses: a build signed with your key fails unless sign-in is configured.

## Part B — one-time: Google Cloud (sign-in + sync service)

Use the HGI company Google account.

1. **Project.** In console.cloud.google.com create a project, for example `hgi-billing`, and attach billing.
   Cloud Run's free tier normally covers a small business.
2. **APIs.** Enable Cloud Run Admin, Cloud Build, Artifact Registry, Secret Manager, Google Drive API and Google Sheets API.
3. **OAuth consent screen** (Google Auth Platform → Branding / Audience):
   - Type: External. App name: HGI Billing. Support e-mail: info@hariguru.com.
   - Privacy policy: `https://<sync-url>/privacy`. Fill this in after the first deploy (step 8).
   - Scopes: only the defaults (openid, email, profile).
   - Publishing status: **In production**.
4. **OAuth clients** (Credentials → Create credentials → OAuth client ID):
   - **Web application** "HGI Billing sync". Its client ID is used by both the app and the server.
     After deploying, add `https://<sync-url>` under *Authorized JavaScript origins*; the account-deletion web page needs it.
   - **Android** "HGI Billing (upload key)": package `in.hariguru.billing`, SHA-1 from Part A.
   - **Android** "HGI Billing (Play signing)": the same package with the SHA-1 of Google Play's **app signing key**
     (Play Console → Test and release → App integrity → App signing). Add this after the first upload; without it,
     sign-in fails in copies installed from Google Play.
5. **Runtime service account.** IAM → Service accounts → create `hgi-sync`. Give it *Secret Manager Secret Accessor*.
6. **Where the spreadsheets live.** Choose one:
   - **A. Google Workspace (recommended if you have it).** Create a Shared drive "HGI Billing customers". Add
     `hgi-sync@<project>.iam.gserviceaccount.com` as **Manager** (Manager rights are needed for permanent deletion).
     Make a folder inside it and copy the folder ID from its URL. Use `DRIVE_AUTH=metadata`. No key file is needed.
   - **B. Normal Gmail account.** Create a folder "HGI Billing customers" in My Drive and copy its ID.
     Service accounts cannot own files in a personal Drive, so the server writes as the HGI account:
     1. Create an OAuth client of type **Desktop app**.
     2. On your PC run `node backend/scripts/owner-token.js <client-id> <client-secret>` and approve access with the HGI account.
     3. Store the client ID, the client secret and the printed refresh token as secrets (step 7).
     4. Use `DRIVE_AUTH=owner-oauth`. Do not add the Drive scope to the consent screen. Google shows an "unverified app" warning only to you, once.
7. **Secret Manager.** Create:
   - `hgi-session-secret`: a random 48+ character value, for example from `openssl rand -base64 48`.
   - For option B only: `hgi-owner-client-id`, `hgi-owner-client-secret`, `hgi-owner-refresh-token`.
8. **Deploy (only with your go-ahead).** In Cloud Shell or on your PC, with `gcloud` signed in to the project:
   ```
   cd backend
   PROJECT_ID=hgi-billing REGION=asia-south1 GOOGLE_CLIENT_IDS=<web-client-id> \
   DRIVE_FOLDER_ID=<folder-id> DRIVE_AUTH=metadata SUPPORT_EMAIL=info@hariguru.com \
   bash deploy/cloudrun.sh
   ```
   The script runs the tests first, asks you to type `DEPLOY`, and prints the service URL. Open `<url>/healthz`,
   `<url>/privacy` and `<url>/delete-account` to check.
9. **GitHub variables:** `HGI_SYNC_URL` = the service URL, and `HGI_GOOGLE_WEB_CLIENT_ID` = the Web client ID.

## Part C — build and upload

1. Push a tag `v8.1.0` (or run the workflow with "release" ticked). CI then:
   - builds and signs with your key;
   - refuses to build if the key, `ANDROID_CERT_SHA256`, `HGI_SYNC_URL` or the client ID is missing or wrong;
   - runs the web, sync-service and emulator tests.
2. Download `HGI-Billing-8.1.0-<code>.aab` from the run's artifacts.
3. Play Console → create the app (package `in.hariguru.billing`). Upload the AAB to **Internal testing** first.
4. Add the Play app-signing SHA-1 to Google Cloud (Part B step 4), then test sign-in from the Play-installed copy.
5. Fill in the store listing from `store/listing.md`:
   - Privacy policy URL: `<sync-url>/privacy`.
   - Account deletion URL: `<sync-url>/delete-account`.
   - App access: "Sign in with any Google account".
   - Data safety answers: see `store/listing.md`.

### Version codes
versionCode = 100 + the CI run number, plus the repository variable `VERSION_CODE_OFFSET` (default 0). Play refuses any
code that is not higher than the last upload. Never rename or recreate the workflow file, because that restarts the run number.
If you have to, set `VERSION_CODE_OFFSET` higher than the last uploaded code.

## Part D — moving existing installs to the release key (one time)

Copies installed from earlier APKs are signed with **throw-away CI test keys**. That is why updates failed with
"package conflicts". Android never lets an app signed with one key update an app signed with another, so each existing
phone needs **one** uninstall. Data in those old copies is only on the phone, so save it first:

1. In the old app: Settings → **Share Backup** (save the `.json` file to Drive or WhatsApp yourself).
2. Uninstall the old app.
3. Install 8.1 from Google Play (or the release-key APK) and sign in with Google.
4. Settings → Data Backup & Recovery → **Restore Backup** and pick the file. It syncs to the cloud automatically.

Once the app is on Google Play, give customers **only the Play Store link**. Play re-signs apps with its own app-signing
key, so an APK you send directly (signed with your upload key) and a copy installed from Play cannot update each other.

From 8.1 on, every update uses the same key and installs over the existing app, keeping all data. If a phone is ever
reset, signing in brings the data back.

When a release build is installed over an 8.0.x build signed with the **same** key (for example a release-key APK you
built yourself), no backup is needed. On first sign-in the app offers the existing phone data to that account and uploads it.
