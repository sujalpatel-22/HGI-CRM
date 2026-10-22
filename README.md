# HGI Billing — Android app (v7, Phase 1)

HARIGURU INDUSTRIES GST Billing & ERP as an Android app. It is built with **Capacitor 8** around the proven v6 web app:
every GST calculation, print layout and report from v6 is kept unchanged.

## What's in the app

| Area | Features |
|---|---|
| Billing (from v6) | Tax invoice, bill of supply, credit / debit notes, per-item GST, place of supply, IGST vs CGST+SGST, RCM, SEZ / export / LUT, compliance checker, UPI QR, Modern & Classic A4 layouts, 3 copies |
| New in v7 | **Quotations / estimates** with one-tap *Convert to Invoice*; **stock tracking** (opening stock, stock-in, auto deduction, low-stock alerts, oversell warning) |
| Money | Receipts with TDS, partial payments, overdue + interest, outstanding by buyer |
| Reports | GSTR-1 tables, GSTR-3B 3.1/3.2, HSN summary, sales register CSV |
| Mobile UX | Bottom tab bar, card lists, phone-friendly invoice form, sticky save bar, invoice preview scaled to screen, bottom-sheet dialogs, Android back button, edge-to-edge safe areas |
| Native Android | System print dialog, **Share PDF** (WhatsApp / Gmail / Drive…), **Save PDF** to *Downloads/HGI Billing*, CSV / backup to Downloads, links open in WhatsApp / UPI apps |
| Personalisation | English / हिन्दी / ગુજરાતી interface (invoices stay in English), light / dark / system theme, onboarding wizard |
| Security & data | Optional app **PIN lock** (auto-locks after 2 min in background), data stored only on the phone with a second copy in private app storage, JSON backup / restore |
| Offline | All libraries and fonts are bundled. No internet is needed to bill |

## Project layout

```
src/app.template.html   core app (v6 + quotations + inventory), logos inlined at build time
src/mobile.js|css       mobile shell, native bridge, onboarding, lock, theme
src/i18n.js             Hindi / Gujarati UI strings
native/java/…           HgiNative Capacitor plugin (print, PDF, share, save, state mirror) + MainActivity
native/res/…            launcher icons, splash
tools/build-web.mjs     builds www/ (bundles Tailwind, Font Awesome, Inter, Chart.js, QR)
tools/patch-android.mjs applies plugin, icons, signing, version to the generated android/ project
tests/web-smoke.mjs     Chromium E2E at 360 / 412 / 800 / 1366 px (122 checks)
tests/android-smoke.mjs emulator E2E through the app's WebView
.github/workflows/android.yml   CI: build → sign → verify → emulator tests (Android 11, 13, 15 tablet, 16)
store/                  Play Store icon, feature graphic, listing text
```

## Build the APK / AAB (GitHub Actions — recommended)

1. Push this folder to a GitHub repository (private is fine).
2. **Signing key** (do this once and keep the key forever; Play updates require the same key):
   ```bash
   ./tools/make-keystore.sh          # needs Java (keytool); prints the 4 values below
   ```
   In GitHub, go to **Settings → Secrets and variables → Actions** and add the secrets
   `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`,
   plus the **variable** `ANDROID_CERT_SHA256` (the fingerprint the script prints).
   Without the secrets, ordinary CI runs sign with a throw-away key. Those files are named `-INTERNAL-TESTKEY`
   and are only for testing on your own phone: never Play, never customers.
3. **Production release:** push a version tag (`git tag v7.1.0 && git push origin v7.1.0`) or use
   **Actions → Android build & test → Run workflow** with *Production release* ticked. A release build **fails** unless the owner's key
   is configured, and also if the key's fingerprint differs from `ANDROID_CERT_SHA256`. `dist/SIGNING.txt` records which key signed the build.
4. Download the **hgi-billing-android** artifact:
   - `HGI-Billing-<version>-<n>.apk` — signed with your release key, install directly
   - `HGI-Billing-<version>-<n>.aab` — upload to Google Play
   - `…-debug.apk` — for testing
   - `SHA256SUMS.txt`

   Emulator screenshots and test logs are in the `emulator-*` artifacts.

### Build locally instead (Android Studio)
Requirements: Node 22+, JDK 21, and Android Studio Otter (2025.2.1+) with SDK 36.
```bash
npm install
npm run android:prepare      # builds www/, creates android/, applies patches
cd android && ./gradlew assembleRelease bundleRelease
```

## Install on a phone (APK)
1. Copy the `.apk` to the phone, or download it there from the GitHub artifact.
2. Open it. Android asks to **allow installs from this source**: allow it for your browser or file manager.
3. Tap **Install**. On first launch the setup wizard asks for business details, bank/UPI and an optional PIN.

Requires Android 7.0+ (API 24) with **Android System WebView 80 or newer**. WebView updates through the Play Store, and older WebViews get an "update WebView" message.

**Moving your existing data:** in the v6 HTML app, go to **Settings → Export Backup (JSON)**. Then in the app's setup wizard tap **Restore from a backup** (or later in **Settings → Restore Backup**).

## Publish on Google Play
1. Create a Play Console developer account (one-time US$25).
2. **Create app**, then upload the `.aab` under **Testing → Internal testing** first. Play App Signing is recommended; keep your upload key from step 2 above.
3. **Store listing:** use `store/listing.md`, `store/play-icon-512.png` and `store/feature-graphic-1024x500.png`. Phone screenshots come from the CI emulator artifacts.
4. **App content:**
   - **Privacy policy URL:** host `PRIVACY.md` (for example on GitHub Pages).
   - **Data safety:** use the answers in `store/listing.md`.
   - Target audience: 18+, business.
5. Target SDK is **36 (Android 16)**, as Play requires since 31 Aug 2026. CI fails the build if it isn't.

## Known limits (Phase 1)
* Data lives on one phone; there is no cloud sync between devices yet (Phase 2). Use **Share Backup** regularly.
* Translations cover menus, labels and statuses. Compliance messages and the invoice itself stay in English.
* E-invoice / e-way bill API is not in the Android app yet. The v6.1 secure backend is web-only for now and will be connected in Phase 2.
* Indian GST only. Other countries' tax modules are Phase 3.

## Demo Mode

A fresh install has **no** business data. To show the app to someone, open **Welcome → "Explore with sample data"** or
**Settings → App Preferences → Demo Mode**. Demo data is stored separately from your data (`hgi_billing_demo` / native mirror `state-demo`).
Every demo page prints with a *DEMO — NOT A VALID TAX INVOICE* watermark, and "Exit demo" deletes the sample data and returns to your own.
