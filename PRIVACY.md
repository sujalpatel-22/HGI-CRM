# Privacy Policy — HGI Billing (Android)

_Last updated: 6 November 2026 — applies from app version 9.4 (username and password accounts, data kept in Google Sheets)._

HGI Billing is published by HARIGURU INDUSTRIES, Ahmedabad, Gujarat, India ("HGI", "we").

## 1. Your account
You create an account with a **username and password** of your choice. We store the username, a random account ID, the
date the account was created, its status and the time of your last log-in. Your password itself is never stored: we keep
only a one-way **scrypt** hash of it, made with a random salt and a secret key that exists only on our server. For each
device you log in on we keep a session record (a hashed session code, the device model, start and expiry time), so that
logging out ends the session on our server too.

## 2. The data you enter
You enter business data: company profile (including GSTIN, bank and UPI details), buyers, products and stock,
invoices, quotations, credit/debit notes, payments and settings.

- It is stored **on your phone**, so billing works without internet.
- It is also stored in **your HGI cloud account**: a Google Sheets spreadsheet owned by HARIGURU INDUSTRIES and, for
  invoice PDFs you create, a private file store (Google Cloud Storage), hosted by Google LLC as our service provider.
  Every row is marked with your account ID. This lets you log in on any phone and get your data back, and keeps several
  phones in step.
- Only our sync service can read or write this data, and only for the account that is signed in. Authorised HGI staff
  can access the cloud data for support or recovery. We do not use your business data for advertising, do not sell it and
  do not share it with anyone else except where the law requires.

## 3. GSTIN look-up
When you type a GSTIN for a buyer, the app can fetch that business's registration details (legal and trade name,
address, registration status) from GST records. The GSTIN is sent through our server to our authorised GST data
provider; nothing else about you or your buyers is sent. Results may be kept for up to 7 days to avoid repeat look-ups.

## 3a. E-invoice (IRN) and e-way bill
Only when you tap *Generate* (or check a status / cancel), the document's details — your business, the buyer and consignee,
items, amounts and transport details — are sent through our server and our GST Suvidha Provider (GSP) to the government's
e-invoice (IRP) and e-way bill systems, as the GST law requires. The answer (IRN, acknowledgement, signed QR code, e-way bill
number and validity) is stored with the invoice in your account. The e-invoice / e-way bill API user name and password you
enter are checked with the government system and kept only on our server, encrypted; they are never stored on the phone or
shown again. You can remove them at any time in Settings; deleting your account removes them.

## 3b. PIN codes
State, state code and district are found from a PIN code using the India Post PIN directory stored inside the app. No PIN
code is sent anywhere for this.

## 4. When data leaves the phone
- Sync with your HGI cloud account, GSTIN look-ups and e-invoice / e-way bill requests you start, always over encrypted HTTPS.
- When you choose to share a PDF, CSV or backup file (WhatsApp, e-mail, Drive …) or open a link (WhatsApp, UPI payment).

The app contains no advertising or analytics SDKs. Android's own Google cloud backup of the app is switched off.

## 5. Security
Connections are encrypted (HTTPS). The app holds no database or storage keys: only our server, running on Google Cloud
with its own service identity, writes to the spreadsheet and file store, and it checks the signed-in account on every
request, so an account can only see and change its own rows. The spreadsheet is shared only with HGI staff who administer
it; Google encrypts it at rest and keeps its version history. You can also protect the app with a PIN.

## 6. Keeping and deleting your data
We keep your cloud data while your account exists. You can delete it at any time:
- in the app: **Settings → Account & sync → Delete account and cloud data**, or
- on the web: the account-deletion page linked from the app's Google Play listing (enter your username and password), or
- by e-mail to info@hariguru.com.

Deletion removes all your rows from the spreadsheet and your PDFs from the file store at once, and ends all your sessions.
Earlier versions inside the spreadsheet's version history are kept by Google for a limited time. We keep only the account
row marked "deleted" (account ID, username, creation and deletion dates — no business data and no password hash) so that
phones still logged in to the deleted account stop syncing; the username can then be registered again.

## 7. Children
The app is a business tool and is not directed at children.

## 8. Contact
HARIGURU INDUSTRIES, Ahmedabad, Gujarat, India · info@hariguru.com
