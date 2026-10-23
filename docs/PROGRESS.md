# Work log: UI/UX + QA upgrade (continue from here if a session ends)

Branch `android-v7`. Local web test: build `www/` (see the `node -e` snippet in tools/build-web.mjs, or CI), copy vendor files from a CI debug APK
(`assets/public/vendor/*`) into `www/vendor/`, symlink `node_modules/playwright` → global playwright, then run `node tests/web-smoke.mjs`.

| Phase | Status | Commit |
|---|---|---|
| 0. Onboarding stuck on Bank & UPI (user-reported) | ✅ fixed, web test | 1e679b1 |
| 1. Critical bugs + GST/data accuracy (AUDIT items 2–10) | ✅ web 183/183 locally | 1f3a4e7 |
| 2. UI/UX redesign (`src/theme.css`, mobile.js: quick actions, row action sheets, live total) | ✅ web 193/193 locally | 9ecc2e2 |
| 3. Security / performance / Android: CSP, no cloud backup of financial data, cleartext off, aria-labels, O(n²)→O(n) notes index, paged register (3000 docs: boot 7.6s→1.3s, register 4.0s→0.14s at 4× CPU throttle) | ✅ web 198/198 | 7275de3 |
| 4. Regression + APK: old-WebView fixes (compat.css, ₹ fallback), hang-proof Android test | ✅ web 198/198, Android 31/31 on API 30/33/35/36, build 7.2.0 (125) | 290f6c4 |

Next (needs owner input): release key secrets → tag `v7.2.0`; Phase C backend (see UPGRADE-PLAN.md).

## v7.3 'Ledger' design (f34e7ab, 40e02bc) → v7.4 refinements
| Step | Status |
|---|---|
| v7.3: theme.css rewritten (ink navy, saffron primary, grouped lists), dashboard hero + stat strip, sectioned editor, preview toolbar, ink login/setup/lock | ✅ CI 39939614533: web + Android 31/31 ×4 (API 30/33 needed the retry: Demo Mode reload, fixed below) |
| v7.4 dashboard: overdue-by-age in the hero (replaces month spark; trend stays in the chart), chart key/tooltip, "Needs attention", "Who owes you" with avatars, recent documents with avatars + See all | ✅ web |
| v7.4 editor: segmented document type (Invoice / Quotation / Credit note / Debit note), consignee collapses when same as billing, item card with amount footer, placeholder case | ✅ web |
| Fix: start-up could hang after the Demo Mode reload when the first native reply was lost → mirror read times out (2.5 s) and retries once | ✅ CI 39941265173: all first attempt |
| Phase B: Documents filter chips with counts, Settings groups with icons, dialogs in sentence case, buyers list cleanup | ✅ CI 39942266663: web 226/226, Android 31/31 on API 30/33/35/36 (first attempt), build 7.4.0 (128) |
| v7.5: GST Returns (output-tax hero with IGST/CGST/SGST split + due dates, period stepper, sections as disclosures with GSTR table chips, empty sections listed once, scroll shadows) | ✅ web |
| v7.5: dialogs as sheets (grab handle, slide-up, full-width Cancel / primary), full-height setup steps with fixed action row, More menu icon chips | ✅ web |
| v7.5: motion (screen fade on tab change, press scale), small-phone demo banner, tablet one-row icon navigation, wider item description on tablets, live total outside phones | ✅ CI 40010536181: web 235/235, Android 31/31 on API 30/33/35/36 (first attempt), build 7.5.0 (129) |
