# HGI Billing: free server on Google Apps Script

The app can use either of two servers. Both store everything in the same "HGI Billing data" Google Sheet, with the same
tabs and columns, so data can move between them.

|  | **Free server (Apps Script)** | Cloud Run server |
|---|---|---|
| Cost | ₹0, and no billing account or card | Billing account needed. Usually ₹0 within the free tier. |
| Code | `gas/dist/Code.js`, built from the **same** `backend/lib/*.js` storage and account code | `backend/server.js` |
| Passwords | PBKDF2-HMAC-SHA256 with a secret pepper, about 1 s per hash. Apps Script has no scrypt. | scrypt (memory-hard) with a secret pepper, or PBKDF2 with `KDF=pbkdf2` (needed while a switch to Apps Script is possible) |
| Spreadsheet access | **only spreadsheets the script created** (`drive.file`) | the spreadsheets shared with its service account |
| Secrets | Script Properties of the script, created on the first request and never shown | Secret Manager |
| E-invoice / e-way bill | **Not available.** Generate the IRN on the NIC portal. | Available once a GSP is contracted |
| PDF cloud copies, GSTIN look-up | Off | Available |
| Speed | Each request reads the sheet: about 1–3 s | About 0.3 s |
| Limits | Apps Script quotas (about 30 requests at the same time, 6 minutes per request) | One instance, 80 at a time |

The build turns the shared `async` server code into plain synchronous code (`tools/build-gas.mjs`). This is needed
because Apps Script cannot wait for promises inside `doPost`, and all of its Google calls are synchronous anyway.
`backend/test/gas-tests.js` runs the bundle in a simulated Apps Script, including the complete
`verify-deployment.js --gas` live check. `tests/gas-web.mjs` runs the real app against it in Chromium.

## How the app talks to it
Every call is **one POST** to `https://script.google.com/macros/s/<id>/exec`, sent as a `text/plain` JSON envelope
`{m, p, q, t, b}`: method, path, query, session token, body. The answer is `{status, body}`. A text/plain POST with no
`Authorization` header is a "simple" request, so the browser sends no CORS pre-flight, which Apps Script cannot answer.
The app switches to this automatically when `HGI_SYNC_URL` is such a script address.

Pages:
- `…/exec?p=/v1/health`
- `…/exec?p=/privacy`
- `…/exec?p=/delete-account`

## Permissions and who can reach what
- **Manifest scope: only `https://www.googleapis.com/auth/drive.file`.** The script can open only files it created itself.
  On its first run it creates its own private spreadsheet (title from Script Property `SHEET_TITLE`), and it cannot see
  any other spreadsheet or Drive file.
  - The build refuses code that uses an Apps Script service needing another permission (SpreadsheetApp, DriveApp,
    UrlFetchApp …).
- **The project is a standalone Apps Script project** owned by the HGI Google account, not bound to a spreadsheet. A
  bound project would be editable by everyone who can edit that spreadsheet.
  - Only the owner and people the project is explicitly shared with can open it. Only they can see the Script
    Properties, which hold the two secrets, and the execution logs.
  - Do not share the project.
- **The web app runs as the owner.** Anyone with the URL can call it, but they get only what the API allows: their own
  account's data after logging in.
- **The spreadsheet is private to the owner.** To let the Cloud Run server use it (for a rollback), share it with
  `hgi-sync@<project>.iam.gserviceaccount.com` as Editor.

## One server at a time: cut-over and roll-back
`_Meta.activeBackend` (`cloud-run` or `apps-script`) names the server that serves the app; `backend/lib/backend-guard.js`
enforces it.
- The other server answers every request with **410 `backend_retired`**. The app then says *install the latest update*,
  keeps all data and unsent changes on the phone, and checks again every 6 hours.
- Writes are refused inside the write transaction itself, after the copy was re-checked. A request that started just
  before the switch therefore cannot slip through.
- So an old APK (Cloud Run URL) and a new APK (Apps Script URL) can never both write to the live spreadsheet.

**Switching:** in the Apps Script editor, run `hgiActivateAppsScript` (cut-over) or `hgiActivateCloudRun` (roll-back).
Both are ordinary writes, so Cloud Run notices at its next write, and before refusing it re-reads the sheet at most every
15 s. If the Apps Script editor is unusable, the owner can type `cloud-run` into `_Meta!activeBackend` and restart the
Cloud Run service.

**Both servers must share the secrets and a hash both can check:**
- Copy the two secrets with `hgiArmSecretImport` plus `node backend/scripts/import-secrets-to-gas.js <url> <code>` in
  Cloud Shell. It works only once, within 15 minutes, and only while the Apps Script server has no active account.
- Deploy Cloud Run with `KDF=pbkdf2`, because Apps Script cannot compute scrypt.
  - Existing scrypt hashes are converted at each user's next log-in on Cloud Run.
  - Users who do not log in before the cut-over cannot log in on Apps Script and need their account reset.

## Set-up (once, as the HGI Google account)
1. Create a new standalone project at script.google.com, named "HGI Billing server". Paste `gas/dist/Code.js` into
   `Code.gs` and `gas/dist/appsscript.json` into the manifest. To show the manifest, open Project Settings and tick
   "Show appsscript.json".
2. Optional: set Script Property `SHEET_TITLE`.
3. Run **`hgiSelfTest`** and approve the access request. It asks only to "see, edit, create and delete only the
   specific Google Drive files that you use with this app". The run creates the spreadsheet, the secrets and the tabs,
   then proves:
   - create, read and update;
   - an all-or-nothing batch;
   - a one-batch invoice write.
4. **Deploy → New deployment → Web app**: execute as *Me*, access *Anyone*. The URL is
   `https://script.google.com/macros/s/<deploymentId>/exec`.
5. Run the live check: `node backend/scripts/verify-deployment.js https://script.google.com/macros/s/<id>/exec`.
6. Only after the cut-over plan above: set the GitHub variable `HGI_SYNC_URL` to that address and build the app.

**Updating the code:** paste the new `Code.js`, then **Deploy → Manage deployments → edit → New version**. The URL stays
the same.

## Operating it
- **Settings** are in the Script Properties (Project Settings):
  - `ALLOW_SIGNUP=0` closes sign-up.
  - `SUPPORT_EMAIL` is shown on the pages.
  - `SIGNUP_PER_MINUTE` defaults to 20 and `LOGIN_PER_MINUTE` to 60. These limits are for all users together, because
    Apps Script does not see callers' addresses.
  - **Never change or delete `PASSWORD_PEPPER`**: every password hash depends on it. Changing `SESSION_SECRET` logs
    everyone out.
- **Logs:** Apps Script → Executions.
- **Disable or delete an account:** the same as with Cloud Run (`docs/SHEETS-SETUP.md`). Changes take effect on the next
  request, because nothing is cached.
- **Moving to Cloud Run later:** point the Cloud Run server at the same spreadsheet. It reads PBKDF2 hashes and
  upgrades them to scrypt at each user's next log-in.
