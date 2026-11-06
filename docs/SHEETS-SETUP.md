# HGI Billing 9.4: accounts and Google Sheets storage

The app now has its own accounts, with a username and password. All business data lives in one Google Spreadsheet that
the HGI server reads and writes. This replaces Sign in with Google and Firestore, neither of which was ever deployed.

None of the cloud parts below exist yet. Each step needs your Google account, and some need billing approval. The code is
tested against a stand-in for the Google Sheets API. It has **not** run against a real spreadsheet yet. Step 6 is the live
check you run once.

## How it fits together

```
 Android app / browser ──HTTPS──▶ HGI server (Cloud Run, ONE instance) ──Sheets API──▶ Google Spreadsheet "HGI Billing data"
   username + password             · checks the session on every request             Users, Sessions, Settings, Customers,
   local copy for offline work     · takes the userId from the session,               Products, Invoices, InvoiceItems,
   (uploads when online)             never from the request                           Payments, DocNumbers, Store, _Blobs, _Meta
                                   · holds the secrets (Secret Manager)
```

**Why a server and not Google Apps Script.** Apps Script has no vetted password-hashing function. It offers SHA and HMAC
digests only, so password hashing would have to be hand-made. The server already holds the e-invoice and GST-provider
secrets. It uses Node's built-in **scrypt**, OpenSSL's memory-hard function, which OWASP lists for password storage. The
Google credential never leaves the server: it is Cloud Run's own service account, with no key file.

**Why no separate authentication service.** Usernames and passwords stay in the Users sheet, as you asked. The protections
an auth service would add are built into the server:
- salted scrypt hashes, plus a pepper kept in Secret Manager;
- opaque random session tokens, stored only as an HMAC;
- revocation on log-out, password change and account deletion;
- lockout after 10 wrong passwords;
- per-IP limits on sign-up and log-in;
- identical answers for unknown users and wrong passwords.

Not included: e-mail verification and password reset by e-mail. There is no e-mail address to send to. If a user forgets
their password, an administrator deletes the account or sets its status, and the user signs up again. If you need
self-service reset, the next step is a dedicated identity service such as Google Identity Platform. The Users sheet would
then store only the profile and that service's user ID.

## The spreadsheet

The server creates every tab and its column names in row 1 on its first start. It never deletes a tab or a column, and it
finds columns by their **name**. You may reorder columns or add columns of your own: the server keeps your columns
untouched. Every tab is protected so that only the owner and the service account can edit it.

| Tab | One row per | Columns (key columns first) |
|---|---|---|
| **Users** | account | `userId` (24 hex, random), `username`, `usernameKey` (lower case, unique), `passwordHash` (`scrypt$1$N=32768,r=8,p=1$salt$hash`), `status` (active / disabled / deleted), `createdAt`, `updatedAt`, `lastLoginAt`, `failedLogins`, `lockedUntil`, `passwordChangedAt`, `seq` (change counter), `lastSyncAt`, `deletedAt` |
| **Sessions** | log-in on a device | `sessionId` (HMAC of the token — the token itself is never stored), `userId`, `createdAt`, `expiresAt`, `revokedAt`, `device`, `renewedAt` |
| **Settings** | account × kind | sync columns¹, `kind` (company / settings), `businessName`, `legalName`, `gstin`, `pan`, `address`, `state`, `stateCode`, `pin`, `phone`, `email`, bank and UPI fields, `aato`, `scheme`, `lutArn`, … `extra` |
| **Customers** | buyer / supplier | sync columns¹, `name`, `partyType`, `gstin`, `phone`, `email`, `address`, `city`, `state`, `stateCode`, `pin`, ship-to fields, `creditDays`, `creditLimit`, … `extra` |
| **Products** | item | sync columns¹, `name`, `sku`, `category`, `group`, `size`, `hsn`, `unit`, `rate`, `gst`, `trackStock`, `openingStock`, `minStock`, `specs`, … `extra` |
| **Invoices** | invoice, credit / debit note, quotation, proforma, order, purchase order | sync columns¹, `docType`, `num`, `date`, `supplyType`, `pos`, buyer and ship-to fields, `taxable`, `cgst`, `sgst`, `igst`, `roundoff`, `grandTotal`, `cancelled`, `irn`, `ewbNo`, … `extra` |
| **InvoiceItems** | document line | `userId`, `invoiceId`, `lineNo`, `invoiceNum`, `invoiceDate`, `docType`, `desc`, `hsn`, `qty`, `unit`, `rate`, `gst`, `taxability`, `discount`, `amount`, `extra` |
| **Payments** | receipt / payment | `userId`, `invoiceId`, `lineNo`, `invoiceNum`, `paymentId`, `date`, `amount`, `tds`, `mode`, `ref`, `extra` |
| **DocNumbers** | document number in use | `userId`, `numKey` (`TYPE\|number`, one per account and type), `docType`, `num`, `docId`, `claimedAt` |
| **Store** | server record | `path`, `userId`, `kind`, `data`, `updatedAt` — e-invoice / e-way bill records, the AES-256-GCM-encrypted e-invoice API logins, the PDF index, the GSTIN cache |
| **_Blobs** | piece of a long value | `id`, `owner`, `part`, `parts`, `text` — a value longer than 40,000 characters (for example a logo) is split here, because Google allows 50,000 per cell |
| **_Meta** | setting | `key`, `value` — `writeCounter` (see "One writer") and `quoteProbe` |

¹ Sync columns, in every business tab: `userId`, `id`, `rev`, `seq`, `deleted`, `hash`, `modifiedAt`, `device`, `updatedAt`.

There is no **Expenses** tab, because the app has no expenses feature. Adding one later is a new tab definition in
`backend/lib/sheets-schema.js` plus a record kind.

**Exact storage.** Each record is split into readable columns and child rows. Everything else goes into the `extra` JSON
cell: the field order, nested data, empty texts, e-invoice data and correction history. On every save the server rebuilds
the record from those rows. If the result is not byte-for-byte the text the app sent, it keeps the whole record in
`extra` instead. A record is never stored in a form that would come back changed.

**Formula injection.** Every cell is written as a typed literal (`stringValue` / `numberValue` / `boolValue`), so Google
never evaluates anything as a formula. Text starting with `= + - @`, a tab, a line break or an apostrophe also gets a
leading apostrophe, so a CSV downloaded from the sheet is safe in Excel. The apostrophe is removed again when the
record is read. On start-up the server checks how Google keeps that apostrophe (`/healthz` → `quoteMode`). The app's own
CSV exports apply the same guard.

**Deleted rows.** A removed line or record row is blanked, not deleted, and blank rows are reused. A write whose answer
was lost therefore can never shift other rows. Deleted documents stay as a tombstone row holding only the sync columns,
so other phones learn about the deletion.

## One writer

Google Sheets has no transactions across separate writers. The server is therefore deployed with
`--max-instances=1`, and inside it all writes run one after another. Each write is **one** `spreadsheets.batchUpdate`,
which Google applies completely or not at all. It contains the records, their lines and payments, the document numbers,
the account's change counter and `_Meta.writeCounter`.

Before every write the server reads `writeCounter`. If it changed, something else wrote: the server reloads the
spreadsheet and re-checks the operation against the real data, so nothing is overwritten. That something could be a
second instance or a script.

This is what makes the following safe:
- two phones saving the same invoice number (one gets `number_taken`);
- two phones editing the same record (one gets `conflict`, and the app merges or keeps both versions);
- 20 uploads at once (every sequence number is unique).

**Do not edit the data tabs by hand while the service runs.** The protection warns anyone who tries. The server reloads
the sheet every 10 minutes, so a hand edit is picked up eventually, but edits between reloads are not detected.

**Limits to plan for:**
- **Cells:** 10 million per spreadsheet. `/healthz` reports cells used and warns above 70 %. At roughly 100 cells per
  invoice with its lines, that is on the order of 90,000 invoices across all accounts.
- **API quota:** about 60 write and 60 read requests a minute for the service account. Reads are served from the server's
  in-memory copy, so each sync costs one read and one write. Ask Google for a quota increase if many people use it at
  once.

## Set-up, step by step

1. **Google Cloud project with billing**, if you don't have one: console.cloud.google.com → new project, link billing.
2. **Infrastructure** (Cloud Shell). The script shows each command and asks `y/N` before running it:
   ```
   git clone https://github.com/sujalpatel-22/hgi-crm && cd hgi-crm && git checkout android-v7 && cd backend
   PROJECT_ID=hgi-billing REGION=asia-south1 BUCKET=hgi-billing-pdfs bash deploy/setup-gcp.sh
   ```
   It:
   - enables Cloud Run, Cloud Build, Secret Manager, the **Google Sheets API** and Cloud Storage;
   - creates the `hgi-sync` service account;
   - creates two random secrets, `hgi-session-secret` and `hgi-password-pepper`. **Never delete or change the pepper**:
     every password hash depends on it;
   - creates the optional private PDF bucket.
3. **The spreadsheet** (Google Drive of the HGI company account):
   - create an empty Google Sheets file, for example "HGI Billing data";
   - **Share** it with `hgi-sync@<project>.iam.gserviceaccount.com` as **Editor**, with "Notify" unticked;
   - share it with no one else except HGI administrators;
   - copy the ID from the address bar: `docs.google.com/spreadsheets/d/<ID>/edit`.
4. **Deploy** (Cloud Shell). The script runs the tests first, asks you to type `DEPLOY`, and deploys one instance:
   ```
   PROJECT_ID=hgi-billing REGION=asia-south1 SHEETS_SPREADSHEET_ID=<ID> FILES_BUCKET=hgi-billing-pdfs \
   SUPPORT_EMAIL=info@hariguru.com bash deploy/cloudrun.sh
   ```
   - optional: `ALLOW_SIGNUP=0` closes sign-up;
   - optional: `MIN_INSTANCES=1` avoids a cold start, for a small always-on cost.
5. **Check** `https://<url>/healthz`. It should answer `{"ok":true,"storage":"google-sheets","startedAt":…,…}`. The tabs should now
   be in the spreadsheet.
6. **Live check against the real spreadsheet, including a restart** (Cloud Shell, in `backend/`):
   ```
   PROJECT_ID=hgi-billing REGION=asia-south1 bash deploy/verify-live.sh
   ```
   It needs no password or key from you. It:
   - creates throw-away accounts (`verify-<random>`) with random passwords that are never printed;
   - checks that the same username cannot be taken twice (also in capitals), that a weak or wrong password is refused,
     and that a log-in on a second device reaches the same account;
   - uploads tricky data: formula-like texts, apostrophes, unicode, a 45,000-character text and a 90 KB logo, and reads
     it back byte-for-byte on the second device;
   - checks that a second account sees none of the first account's data, cannot change it, and may use the same
     invoice number for itself;
   - checks a duplicate number, a conflict, log-out, and that the data is still there after logging in again;
   - **restarts the service** (asks first) and checks that the new instance, which can only have read the spreadsheet,
     lets the account log in and serves the same data byte-for-byte; then deletes the test accounts.

   Every line must say PASS. **Do this before giving the app to anyone.** Then open the spreadsheet and look at the
   Users tab yourself: `passwordHash` must start with `scrypt$1$` and no column may hold a readable password.

   Without Cloud Shell, the same check minus the restart runs on GitHub against the repository variable `HGI_SYNC_URL`:
   push any commit to the branch `live-check` (`git push -f origin HEAD:live-check`). Once the workflow file is on the
   default branch it can also be started from Actions → "Live check (real spreadsheet)" → Run workflow. Its PASS / FAIL
   log is published to the branch `ci-output-verify`, so Claude can read it.
7. **App builds:**
   - in GitHub, set the repository variable `HGI_SYNC_URL` to the Cloud Run URL. Builds signed with the release key then
     require accounts;
   - `HGI_GOOGLE_WEB_CLIENT_ID` is no longer used and can be deleted.

## Existing data (migration)

There is no cloud data to migrate, because the earlier cloud service was never deployed. Business data from versions up
to 9.3 lives on the phones. The first time an account logs in on a phone that has such data, the app shows what it found
("Move this phone's data into your account?") and acts only after the user agrees:

- **"Move":** the data becomes the account's and uploads.
  - A safety copy of exactly what was on the phone is first written to the app's files (`legacy-backup-<date>`); the
    original app file also stays.
  - If the account already has data, records that exist in both are not doubled, and the account's company profile is
    kept.
  - Once the upload is complete, the app says "All your data is saved in your cloud account: N documents, N buyers,
    N products".
- **"Not now":** nothing is uploaded and the phone's data stays untouched.

Before upgrading a phone with important data, it is still sensible to take a backup file: Settings → Share Backup.

## Operating it

- **Disable an account:** set its `status` in Users to `disabled`. Its sessions stop working at the next reload (10
  minutes), or at once after a service restart.
- **Delete an account:** in the app (password required), on `<url>/delete-account`, or by setting `status` to `deleted`.
  The app path removes every row of the account in every tab, plus its PDFs, and ends all sessions. The username becomes
  free again.
- **Back up:** Google Sheets keeps a version history. For a nightly copy, File → Make a copy on a schedule (Apps Script),
  or export with the Drive API. Restore into a **new** spreadsheet and point `SHEETS_SPREADSHEET_ID` at it. Ask before
  restoring over live data.
- **Secrets:** `hgi-session-secret`, if changed, logs everyone out. `hgi-password-pepper`, if changed, means nobody can
  log in. Neither may ever be put in the app or in git.
