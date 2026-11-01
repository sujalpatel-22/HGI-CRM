# Privacy Policy — HGI Billing (Android)

_Last updated: 1 November 2026 — applies from app version 9.0 (cloud account)._

HGI Billing is published by HARIGURU INDUSTRIES, Ahmedabad, Gujarat, India ("HGI", "we").

## 1. Your account
You sign in with your Google account. From Google we receive your **name, e-mail address and Google account ID**.
We use them only to identify your account and keep your data separate from every other user. We never receive your Google password.

## 2. The data you enter
You enter business data: company profile (including GSTIN, bank and UPI details), buyers, products and stock,
invoices, quotations, credit/debit notes, payments and settings.

- It is stored **on your phone**, so billing works without internet.
- It is also stored in **your HGI cloud account**: a database (Google Cloud Firestore) and, for invoice PDFs you create,
  a private file store (Google Cloud Storage), both in a Google Cloud project controlled by HARIGURU INDUSTRIES and hosted
  by Google LLC as our service provider. This lets you sign in on any phone and get your data back, and keeps several
  phones in step.
- Only our sync service can read or write this data, and only for the account that is signed in. Authorised HGI staff
  can access the cloud data for support or recovery. We do not use your business data for advertising, do not sell it and
  do not share it with anyone else except where the law requires.

## 3. GSTIN look-up
When you type a GSTIN for a buyer, the app can fetch that business's registration details (legal and trade name,
address, registration status) from GST records. The GSTIN is sent through our server to our authorised GST data
provider; nothing else about you or your buyers is sent. Results may be kept for up to 7 days to avoid repeat look-ups.

## 4. When data leaves the phone
- Sync with your HGI cloud account and GSTIN look-ups, always over encrypted HTTPS.
- When you choose to share a PDF, CSV or backup file (WhatsApp, e-mail, Drive …) or open a link (WhatsApp, UPI payment).

The app contains no advertising or analytics SDKs. Android's own Google cloud backup of the app is switched off.

## 5. Security
Connections are encrypted (HTTPS). The app holds no database or storage keys: only our server, running on Google Cloud
with its own service identity, can reach the database and file store, and it checks the signed-in account on every request.
The database is encrypted at rest by Google and backed up daily. You can also protect the app with a PIN.

## 6. Keeping and deleting your data
We keep your cloud data while your account exists. You can delete it at any time:
- in the app: **Settings → Account → Delete account and cloud data**, or
- on the web: the account-deletion page linked from the app's Google Play listing (sign in with the same Google account), or
- by e-mail to info@hariguru.com from the account's e-mail address.

Deletion removes all your records and PDFs from the database and file store at once. Copies inside our encrypted
database backups expire within 7 weeks. We keep only a marker (a random-looking account code and the deletion date, no
business data) so that phones still signed in to the deleted account stop syncing.

## 7. Children
The app is a business tool and is not directed at children.

## 8. Contact
HARIGURU INDUSTRIES, Ahmedabad, Gujarat, India · info@hariguru.com
