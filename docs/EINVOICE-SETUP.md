# HGI Billing 9.1 — E-Invoice (IRN) and E-Way Bill: what must be registered and approved

**Status today:** the code is built and tested end to end against a local copy of the NIC protocol (test simulator). It has
**not** talked to the real NIC sandbox or production systems, because no GSP contract, client ID or API login exists yet.
Until the steps below are done, the app shows *"E-invoice and e-way bill access is not set up on the HGI server yet"* and
never shows an IRN, QR code or e-way bill number. Numbers made on the government portal can still be typed in by hand.

## How it works

```
phone (HGI Billing) ──HTTPS, signed-in session──► HGI server (Cloud Run) ──► GSP pass-through ──► NIC IRP / NIC e-way bill system
                                                    · HGI's GSP client ID / secret (Secret Manager)
                                                    · each business's own API user + password (encrypted in Firestore)
```

* The app never holds a GSP secret or an API password. It sends the saved invoice; the server recalculates the totals,
  validates the JSON (INV-01 schema 1.1 / EWB API 1.03), encrypts it (RSA + AES-256 with the session key) and calls the IRP.
* IRN, acknowledgement number/date, signed QR code and e-way bill number/validity are taken **only** from the IRP / EWB
  answer, stored server-side (Firestore `users/{uid}/edocs`) and written into the invoice, which then syncs to every phone.
* One IRN per document: a 2-minute per-document lease (all server instances), the stored record, and recovery of the
  existing IRN when the IRP answers *duplicate IRN (2150)* after a lost reply. Cancelled-IRN numbers are blocked.
* Cancellation windows enforced: IRN and e-way bill within 24 hours; an IRN only after its e-way bill is cancelled.
* Sandbox and test results are stamped *"SANDBOX / TEST — NOT A VALID TAX INVOICE"* on every page.

## Who must do what

| # | Step | Who | Notes |
|---|---|---|---|
| 1 | Choose and sign with a **GSP** (GST Suvidha Provider) that offers NIC-identical "pass-through" APIs for e-invoice and e-way bill | HGI (owner) | The GSP gives HGI a client ID, client secret, the base URLs (sandbox + production), the NIC public key(s) and any extra headers it needs. If the GSP's API is *not* NIC-identical (own auth/token flow), the clients in `backend/lib/irp-client.js` / `ewb-client.js` need a small adapter — tell us which GSP. Going **direct to NIC** instead needs HGI's own registration and a whitelisted static Indian IP (Cloud Run has none by default). |
| 2 | Sandbox access | HGI + GSP | Get the sandbox URL/keys from the GSP. Create sandbox API users on the NIC sandbox portal for a test GSTIN. |
| 3 | Configure the server (sandbox) | HGI | `backend/deploy/setup-gcp.sh` (creates `hgi-edoc-cred-key`), then put the GSP secret and public keys in Secret Manager (`hgi-irp-client-secret`, `hgi-irp-public-key`, `hgi-ewb-client-secret`, `hgi-ewb-public-key`) and deploy with `EDOC_ENV=sandbox IRP_BASE_URL=… IRP_CLIENT_ID=… EWB_BASE_URL=… EWB_CLIENT_ID=… bash deploy/cloudrun.sh`. |
| 4 | Sandbox testing | HGI | Generate / cancel IRNs and e-way bills in the app against the sandbox (B2B, SEZ, export, credit note, IRN + EWB together, EWB alone, Part-B update). Keep the results: GSPs / NIC usually ask for a set of successful **and** failed test cases before production access. |
| 5 | Production approval | GSP / NIC | Production keys and URLs are issued after the sandbox tests are accepted. |
| 6 | Switch to production | HGI | Deploy again with `EDOC_ENV=production EDOC_CONFIRM_PRODUCTION=I-UNDERSTAND` and the production URLs/keys. The server refuses production without that confirmation. Sandbox logins saved by users stop working there and must be entered again (the app says so). |
| 7 | Each business (every app user) | the user | On **einvoice1.gst.gov.in** → API Registration → User Credentials → Create API User → *Through GSP* → select HGI's GSP; on **ewaybillgst.gov.in** → Registration → For GSP → same GSP. Then in the app: Settings → *E-Invoice & E-Way Bill* → enter the two API logins → *Verify & save* (the server logs in to the GST system first and never saves a wrong login). |

## Rules the app applies (check with your CA — GST rules change)

* E-invoicing applies only when the business's aggregate turnover is **above ₹5 crore** (Settings → GST Compliance
  Profile). Below that the IRN buttons are not offered.
* IRN only for B2B, SEZ, export and deemed-export invoices, credit notes and debit notes — not B2C, quotations, proforma
  invoices or purchase orders.
* E-way bill: goods only; the app reminds above the threshold in Settings (default ₹50,000). Without a vehicle number only
  Part-A is made; Part-B can be added later (*Update vehicle*).
* Turnover ₹10 crore and above: IRN must be generated within 30 days of the document date (the compliance panel warns).

## Not included yet

* E-way bill validity extension (EXTENDVALIDITY) and consolidated e-way bills — use the e-way bill portal.
* GSPs with a non-NIC request format (needs the adapter mentioned in step 1).

## Environment variables (server)

| Variable | Where | Meaning |
|---|---|---|
| `EDOC_ENV` | env | `sandbox` (default) or `production` (`test` only for the automated tests, refused on Cloud Run) |
| `EDOC_CONFIRM_PRODUCTION` | env | must be `I-UNDERSTAND` for production |
| `EDOC_CRED_KEY` | secret `hgi-edoc-cred-key` | 32 random bytes (base64) — encrypts each business's API login (AES-256-GCM) |
| `IRP_BASE_URL`, `IRP_CLIENT_ID` | env | GSP / NIC e-invoice base URL and client ID |
| `IRP_CLIENT_SECRET`, `IRP_PUBLIC_KEY` | secrets | GSP client secret; NIC public key (PEM, certificate or base64) |
| `IRP_EXTRA_HEADERS` | secret (optional) | JSON of extra headers the GSP requires |
| `IRP_AUTH_PAYLOAD` | env (optional) | `base64json` (NIC v1.04, default) or `json` |
| `IRP_PATH_*` | env (optional) | override an API path, e.g. `IRP_PATH_GENERATE` |
| `EWB_BASE_URL`, `EWB_CLIENT_ID`, `EWB_CLIENT_SECRET`, `EWB_PUBLIC_KEY`, `EWB_EXTRA_HEADERS`, `EWB_APPKEY_RSA_INPUT`, `EWB_DATA_ENCODING`, `EWB_PATH_*` | env / secrets | the same for the e-way bill system |
