> **Superseded in 9.4.** Accounts are now username + password and the database is Google Sheets — follow
> [SHEETS-SETUP.md](SHEETS-SETUP.md). The GST data provider (Step 4) and e-invoice notes below still apply.

# HGI Billing 9.0 — cloud setup (what needs your accounts and approval)

Nothing here has been created yet. Every step below needs **your** Google account, billing approval or a contract with a GST
data provider. The code is ready and tested against stand-ins and the official Firestore emulator. It has **not** been run
against your real project, because that project does not exist yet.

## What gets built (all in one Google Cloud project you own)

| Piece | Google product | What it holds | Who can reach it |
|---|---|---|---|
| Sign-in | Google Sign-In (OAuth clients) | nothing; it proves who the user is | — |
| Server | Cloud Run service `hgi-sync` (`backend/`) | no data of its own | the app, over HTTPS |
| Database | Firestore (native mode) | one record per buyer / product / invoice / note / quotation / company profile, per account | **only** the server's service account (deny-all security rules for everyone else) |
| PDFs | Cloud Storage bucket (private) | invoice PDFs made on phones | only the server's service account |
| Secrets | Secret Manager | session-signing key, GST provider credentials | only the server |
| Backups | Firestore scheduled backups (daily, 7 weeks) + point-in-time recovery (7 days); bucket soft-delete 30 days | — | project owners |

The app holds no keys: it knows only the server URL and the public OAuth client ID. Each account's data lives under its own
key (a hash of the Google account ID), and the server takes that key from the verified session on every request. No request
can name another account.

**Why Firestore rather than Supabase.** You already chose Google Cloud and Google Sign-In, so Firestore keeps everything in
one project and one bill, under one set of permissions. The server reaches it with Cloud Run's own identity, so there is no
database password to leak. Scheduled backups and point-in-time recovery are built in, and CI tests against Google's official
Firestore emulator.

## Step 1 — Google Cloud project and billing (you)
1. Go to console.cloud.google.com, create the project (for example `hgi-billing`) and **link a billing account**.
   Backups, Cloud Run and Cloud Storage need billing.
2. Optional: set a budget alert (Billing → Budgets) at, say, ₹1,000 a month.
   At small-business volume this setup normally stays within free tiers plus a few hundred rupees. Check the current prices
   for your usage on the Google Cloud pricing pages before you approve.

## Step 2 — Sign-in clients (you, in the console: Google Auth Platform)
1. **OAuth consent screen:**
   - Type External; app name HGI Billing; support e-mail info@hariguru.com.
   - Privacy policy `https://<server url>/privacy`. Fill this in after Step 5.
   - Scopes: only the defaults (openid, email, profile).
   - Publishing status: **In production**.
2. **Credentials → Create OAuth client → Web application** "HGI Billing server".
   - Its client ID is `GOOGLE_CLIENT_IDS` (server) and the GitHub variable `HGI_GOOGLE_WEB_CLIENT_ID` (app).
   - After Step 5, add the server URL under *Authorized JavaScript origins* for the account-deletion web page.
3. **Credentials → OAuth client → Android**, package `in.hariguru.billing`, created twice:
   - with the SHA-1 printed by the release-key script (`docs/PLAY-RELEASE.md` Part A);
   - after the first upload to Google Play, again with the SHA-1 of Play's app-signing key (Play Console → App integrity).
     Without it, copies installed from Play cannot sign in.

## Step 3 — Infrastructure (Cloud Shell, run by you or by Claude after your OK)
```
git clone <this repo> && cd <repo>/backend
PROJECT_ID=hgi-billing REGION=asia-south1 BUCKET=hgi-billing-pdfs bash deploy/setup-gcp.sh
```
The script shows each command and asks `y/N` before running it. It:
- enables the APIs;
- creates the Firestore database in Mumbai (**the location cannot be changed later**);
- deploys the deny-all rules;
- schedules daily backups and turns on point-in-time recovery;
- creates the `hgi-sync` service account with only *Datastore User*, *Secret Accessor* and object access on the PDF bucket;
- creates the private bucket and the session secret.

## Step 4 — GST data provider (you: contract + credentials)
GSTIN look-up needs an authorised GST Suvidha Provider (GSP) or GST API provider with access to the GST Network's
**Search Taxpayer** API. Examples to compare on price and terms: Masters India, ClearTax, Vayana, MasterGST, Sandbox (by Quicko).
I have not tested any of them live. Their answer format is the GST Network's (`lgnm`, `tradeNam`, `pradr`, `sts` …), which
the server reads, also when it is wrapped as `{data: …}`.

From the provider's documentation you need:
- the request URL with the GSTIN in it, written with `{gstin}` where the GSTIN goes →
  `GST_API_URL`, for example `https://api.provider.example/search?gstin={gstin}&action=TP`;
- the headers they require (API key, client id/secret …) → store them as JSON in Secret Manager:
  `echo -n '{"x-api-key":"…"}' | gcloud secrets create hgi-gst-headers --data-file=-`;
- only if they first issue a token: `GST_API_AUTH_URL`, the token's location in the reply (`GST_API_TOKEN_PATH`, e.g.
  `data.token`), and how to send it (`GST_API_TOKEN_HEADER`, e.g. `Authorization: Bearer {token}`).
  The headers for the token request go in the secret `hgi-gst-auth-headers`.

Until this is set, the app says "GST look-up is not set up on the HGI server yet — enter the details manually". It never
fills anything it did not receive from GST records.

## Step 5 — Deploy the server (Cloud Shell, after your OK)
```
PROJECT_ID=hgi-billing REGION=asia-south1 GOOGLE_CLIENT_IDS=<web client id> FILES_BUCKET=hgi-billing-pdfs \
SUPPORT_EMAIL=info@hariguru.com GST_API_URL='<from step 4>' GST_API_NAME='<provider>' bash deploy/cloudrun.sh
```
The script runs the tests, asks you to type `DEPLOY`, then prints the URL. Check that `<url>/healthz` answers
`{"ok":true}`. Then sign in once in a test build and look at **Settings → Account**. It shows whether "GST look-up" and
"PDF cloud copies" are **on** — the server reports what is actually configured.

## Step 6 — Connect the app builds (GitHub, you)
Repository **variables**: `HGI_SYNC_URL` = the Cloud Run URL, `HGI_GOOGLE_WEB_CLIENT_ID`. Plus the release key secrets from
`docs/PLAY-RELEASE.md` Part A. The next tagged build is the store build, with sign-in required.

## After launch
- **Restore:** Firestore → Backups or point-in-time recovery restore into a new database. Ask before restoring over live data.
- **Look at a customer's data:** Firestore console → `users/<key>/records`. The key is shown nowhere in the app;
  find it with `gcloud logging read` on `sign_in` events, which log only the key, never the e-mail.
- **Delete on request:** the in-app button and `<url>/delete-account` remove everything. Backups expire within 7 weeks.
