# HGI Billing: free server on Google Apps Script

The app can use either of two servers. Both store everything in the same "HGI Billing data" Google Sheet, with the same
tabs and columns, so data can move between them.

|  | **Free server (Apps Script)** | Cloud Run server |
|---|---|---|
| Cost | ₹0, and no billing account or card | Billing account needed. Usually ₹0 within the free tier. |
| Code | `gas/dist/Code.js`, built from the **same** `backend/lib/*.js` storage and account code | `backend/server.js` |
| Passwords | PBKDF2-HMAC-SHA256 with a secret pepper, about 1 s per hash. Apps Script has no scrypt. | scrypt (memory-hard) with a secret pepper |
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

## Set-up (once, as the owner of the spreadsheet)
1. Turn on **Google Apps Script API** at script.google.com/home/usersettings. This is needed by `clasp`.
2. In Cloud Shell:
   ```
   npm i -g @google/clasp@2.4.2 && clasp login --no-localhost
   cd HGI-CRM && node tools/build-gas.mjs && cd gas/dist
   clasp create --type sheets --title "HGI Billing server" --parentId <spreadsheet ID> --rootDir .
   clasp push -f
   ```
   `clasp create` binds the script to the spreadsheet.
3. Open the script (`clasp open`), choose `hgiSetup` and click **Run**. Approve the access request: the script reads
   and writes the spreadsheet. This creates the secrets, tabs and columns and measures the PBKDF2 speed.
4. Deploy: `clasp deploy -d "HGI Billing 9.4"`. The web app URL is
   `https://script.google.com/macros/s/<deploymentId>/exec`. The manifest sets it to run as the owner, with access for
   anyone.
5. Live check: `node backend/scripts/verify-deployment.js https://script.google.com/macros/s/<id>/exec`.
   Every line must say PASS.
6. Set the GitHub variable `HGI_SYNC_URL` to that address and build the app.

**Updating the code:** rebuild, run `clasp push -f`, then `clasp deploy -i <deploymentId> -d "…"`. This keeps the same
URL, so installed apps keep working.

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
