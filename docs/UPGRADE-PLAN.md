# HGI Billing: production upgrade, inspection report and phase plan

_Inspected: 22 Oct 2026, branch `android-v7` @ d9188df (app v7.0.0, build 110)_

## 1. What already works (verified by automated tests)

| Area | Status | Evidence |
|---|---|---|
| Offline GST invoices, credit/debit notes, quotations → invoice | ✅ | `tests/web-smoke.mjs` (4 viewports), `tests/android-smoke.mjs` |
| GST engine (CGST/SGST/IGST, POS, round-off, GST 2.0 slabs) | ✅ | regression numbers in web test |
| Live compliance checker (GSTIN check digit, HSN, Rule 46/48, EWB limit, IRN rules) | ✅ | web test |
| Stock tracking, low-stock alerts | ✅ | web test |
| Receipts/payments, TDS, overdue interest | ✅ | (no dedicated test, so a test will be added) |
| GSTR-1 / GSTR-3B summaries, HSN summary | ✅ | web test (quotation excluded) |
| A4 PDF: native save to Downloads, share, print | ✅ | Android 11/13/15/16 emulators, valid `%PDF` checked |
| UPI scan-to-pay QR | ✅ | Android test |
| English / हिन्दी / ગુજરાતી UI, dark mode | ✅ | Android test |
| PIN lock, auto-lock | ✅ | manual only, so a test will be added |
| On-device data mirror and restore after WebView storage wipe | ✅ | Android test |
| JSON backup export/import | ✅ | manual only |
| Signed APK + AAB build in CI, targetSdk 36 | ✅ | `.github/workflows/android.yml` (signed with a **test key**) |

## 2. Defects and gaps found

### Critical
1. **Placeholder business data ships as defaults** (`src/app.template.html` → `DEFAULT_COMPANY`, `defaultState()`):
   - a fake GSTIN `24AAAFH1234F1Z5` (fails the check digit)
   - bank account `123456789012`, IFSC `SBIN0001234`
   - phone `+91 98765 43210`, `info@hariguru.com`, "Subject to Ahmedabad Jurisdiction"
   - two sample products

   The onboarding wizard **pre-fills** these values, so a user who skips the bank step prints a fake bank account on real tax invoices.
2. **No release key.** CI signs with a throw-away TEST key because the four `ANDROID_KEY*` secrets are not set. Nothing currently stops a TESTKEY build from being treated as a release.
3. **No server.** Data lives on one device only. There are no accounts, roles, sync, server backups or audit trail.
4. **E-invoice / E-way bill in the Android app is manual entry only** (IRN/EWB typed in). The v6.1 backend (`hgi-einvoice-v6.1.zip`, NIC protocol, simulator tests) exists **outside this repo**. It is single-company, uses a JSON file store, and is not wired into the Android app.

### Important
5. The web build still has a client-side default login `admin / 123` (Android uses a PIN instead). Client-side passwords are not real security. This will be replaced by server auth in Phase C.
6. `android:allowBackup` is left at the Capacitor default (true). Google auto-backup will copy the invoice database and PIN hash. Review this for Phase C (exclude, or encrypt).
7. There is no Content-Security-Policy in the page.
8. There are no tests for payments, the PIN lock, backup import, data migration from v5/v6 backups, sync, or recovery.
9. Privacy policy (`PRIVACY.md`) says "no servers". It must be rewritten **before** cloud sync ships.

## 3. Phases (each one is small, tested in CI, and shipped only after your approval)

| Phase | Scope | Needs from you |
|---|---|---|
| **A** ✅ | Remove placeholder data from production; empty fresh install; opt-in **Demo Mode** with separate storage, banner and "DEMO – NOT A VALID TAX INVOICE" watermark; placeholder-detection alert for existing installs (no data is changed without the user) | nothing |
| **B** ✅ (code) | CI release gate: `release` builds only with the owner key; TESTKEY builds are labelled *internal test*, are never named as release, and print the key fingerprint | your keystore + 4 GitHub secrets (step 1 below) |
| **C** | Backend core: Node 22 + PostgreSQL. Companies (tenant isolation with row-level security), users, roles (owner/admin/accountant/sales/viewer), Argon2/scrypt passwords, short-lived access + rotating refresh tokens, audit log, SQL migrations + rollback, rate limits, `.env.example`. Tests run in CI against a real Postgres. | nothing to build and test; a server to deploy later |
| **D** | Sync: per-record versions, change feed, offline outbox with idempotency keys, conflict rules (server-wins for issued numbers/IRN, field-merge otherwise, conflict log shown to user), first-sync migration of existing on-device data, server backups + restore, recovery tests | nothing to build; your approval before the first real data upload |
| **E** | E-invoice / E-way bill: port the v6.1 NIC client into the backend per company. IRN, signed QR, EWB, Part-B, cancellation (24 h IRN rule), status refresh, retries with back-off, duplicate-request protection (DB unique key on GSTIN+doc type+number+FY plus idempotency key). **Sandbox only** until you approve production. No simulated success, ever. | GSP/ASP account (or NIC direct API access), sandbox credentials, static Indian IP for production |
| **F** | App: login/company switch, sync status, e-invoice buttons, roles in UI; security checks (dependency audit, secret scan, CSP, OWASP MASVS basics); full test report; privacy policy update; deployment and rollback guide | Play Console account, hosted privacy-policy URL, domain + HTTPS |

## 4. External accounts, credentials and approvals required

1. **Release signing key (permanent).** Run `bash tools/make-keystore.sh` on your own computer, store the `.jks` and passwords in two safe places, and add `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD` as GitHub Actions secrets. I cannot and should not create or hold this key for you.
2. **Server** for the backend: a VPS in India (static IP, needed for NIC production allow-listing), or a managed PostgreSQL + Node host. You also need a domain name for HTTPS.
3. **GST API provider**: a GSP/ASP account (e.g. a NIC-empanelled GSP) or NIC direct API access, with sandbox credentials first and production after testing. You also need e-way bill API registration on ewaybillgst.gov.in.
4. **Google Play Console** account and a public URL for the privacy policy.
5. **Approvals** before: the first production deployment; the first upload of real business data to the server; switching e-invoice from sandbox to production.

## 5. Files that change

| Phase | Files |
|---|---|
| A | `src/app.template.html` (DEFAULT_COMPANY, defaultState, storage key, alerts, print watermark), `src/mobile.js` (onboarding, demo switch, mirror key, settings card), `src/demo-data.js` (new), `src/i18n.js`, `tools/build-web.mjs`, `tests/web-smoke.mjs`, `tests/android-smoke.mjs` |
| B | `.github/workflows/android.yml`, `tools/patch-android.mjs`, `README.md` |
| C–E | `server/` (new: `src/`, `migrations/`, `test/`, `.env.example`, `Dockerfile`), `.github/workflows/server.yml` (new) |
| D/F | `src/sync.js` (new), `src/mobile.js`, `src/app.template.html`, `native/…/HgiNativePlugin.java` (secure token storage), `PRIVACY.md`, `docs/DEPLOY.md`, `docs/ROLLBACK.md`, `docs/TEST-REPORT.md` |
