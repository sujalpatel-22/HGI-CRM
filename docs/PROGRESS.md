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

## v8.0 — "Studio" redesign (24 Oct 2026)

Why v7.5 still looked like an admin template: identical white cards on grey everywhere, one font weight ladder, a stock navy top bar with Font Awesome icons, a mostly-empty Chart.js bar chart, and an invoice form you could not see as a document until Preview.

| Change | Status |
|---|---|
| New layer `src/studio.css` + `src/studio.js` (loaded after the v7 shell; core IDs, GST maths, stored data and the printed invoice untouched) | ✅ |
| Bundled fonts (offline, OFL): Inter Display for headings/amounts, Lora Italic for accents — `src/fonts/` | ✅ |
| Custom 60-icon SVG set (saffron accent stroke) replacing Font Awesome in nav, sections, lists, toasts, sheets | ✅ |
| Shell: ink side rail with sliding indicator (desktop 252px, tablet 84px icon rail); phones: light app bar + floating ink dock | ✅ |
| Dashboard bento: statement hero with guilloche pattern + overdue heat cells, collection ring (FY % collected, avg days to get paid), 4 KPI tiles with 6-month sparklines and month-on-month change, interactive SVG cash-flow chart (scrub / keyboard, series toggles), alert feed | ✅ |
| Invoice editor: numbered section cards, sliding document-type control, phone section jump bar, item rows as two-line cards, ink action bar with live total, **live invoice paper** beside the form (desktop ≥1180px) | ✅ |
| Preview desk: dotted desk, glass toolbar, Modern/Classic segmented control, copy chips, page rise animation | ✅ |
| Documents: two-line ledger with month headings and per-month totals, hover action toolbar, labelled totals band | ✅ |
| Items / Buyers: card grids with stock meters and coloured avatars; Settings: section index + grouped cards + floating save | ✅ |
| GST Returns hero in the ink statement style; dialogs, toasts, sign-in, setup, PIN pad restyled; light + dark | ✅ |
| Android status/nav bars follow the page colour | ✅ (verify on device) |
| Web tests: 244/244 (tests updated for rail + month headings; new checks for chart, ring, KPIs, month grouping, icons) | ✅ |

## v8.0.1 — print/PDF fix + QA (29 Oct 2026)

User report: invoice 59/26-27 printed from the web app with the three copies running into each other (Duplicate split across sheets 1–2), the preview's drop shadow printed, and the page shifted sideways.

| Finding | Cause | Fix | Test |
|---|---|---|---|
| Copies not on separate A4 sheets (since v7 on browsers; same CSS drives Android print/PDF) | the screen preview wraps each page in `.page-scale-wrap`, so the print rule `.a4-page + .a4-page { page-break-before }` never matched | print rules in the core stylesheet: each wrapper/page after the first starts a new sheet | web test reads each PDF sheet: Original / Duplicate / Triplicate in order; checks break-before per copy |
| Shadow and left offset printed | v8 screen styles (paper shadow, 252/84 px rail padding) outranked the print rules | print rules use IDs + !important: paper only, no padding, shadow, transform or animation | web test: no shadow, no offset, no scaling in print |
| Old test passed while broken | it only counted pages (3 short copies run together also make ~3 sheets) | test strengthened (above) | fails on the old build, passes on the fix |
| Quotation printed "Against Invoice – dt. – / Reason: Sales Return" | note-only fields shown for every non-invoice | note fields only for credit/debit notes (paper, stored data, form load) | web test |
| Quotation compliance panel said "Select the original invoice this note is issued against" | same | same | web test |
| WhatsApp text for a quotation said "Against Invoice: (Sales Return)"; every message claimed "PDF attached" although the web button sends text only | same; wording | quotation shows "Valid till"; text says the PDF is shared separately | web test |

Print matrix verified with real Chromium PDFs: 1366 / 800 / 412 px windows × Modern / Classic × 5 / 45 items × 3 copies → one copy per sheet (45 items: 2 sheets per copy, header row repeated, totals on the last), text inside the printable area; dark mode + Hindi UI → white paper, English invoice. End-to-end QA (25 checks): intra/inter-state GST, part payment + TDS, mark paid, delete receipt, edit & re-save, duplicate, cancel, bill of supply, export under LUT, reverse charge, credit note, quotation, stock with returns + stock-in, sales register / GSTR CSV, JSON backup, settings, password change. Web tests 266/266.

### v8.0.2 — phone print spill-over (29 Oct 2026)
The Android CI run for 8.0.1 passed, but the PDFs the emulators themselves produced showed 5 sheets (Android 11, Pixel 2) and 4 sheets (Android 13, Pixel 6) for 3 copies: each copy overflowed its sheet by a few pixels, adding a blank page. Tablet and Pixel 7 were exact. Cause: the page-fill row left only a 4 px margin and phone print engines lay text out slightly taller than the screen measurement. Fix (all three web versions): ~4 mm margin, print page height 284 mm. The Android test now counts the sheets in the phone's own PDF (one per copy) — before, it only checked that a valid PDF existed.

### v8.0.3 — print isolated from the phone layout (29 Oct 2026)
8.0.2 did not fix the Android 11/13 PDFs (still 5 / 4 sheets). The sheet-by-sheet reading showed: (1) Android's print engine applies `max-width: 767px` screen rules to the printout, so the phone layout's dock padding landed after the last copy (blank last sheet); (2) older WebViews set invoice text ~5 mm taller than the screen measurement. Fixes: every layout media query is now `@media screen and …`; print rules use doubled-ID selectors so no screen rule can outrank them; the page filler targets a 280 mm printed page (printable area 287 mm). The web print test now checks padding/margins on all sides at phone widths (it fails on 8.0.2, passes on 8.0.3).

### v8.0.4 — WebView 83 (Android 11 stock) (29 Oct 2026)
8.0.3 fixed Android 13 (3 sheets); Android 11's original WebView 83 still made 4: copy 2 sat ~14 pt (one table-header row) lower and pushed a blank sheet. A one-sheet copy now prints its item header as a normal row (only multi-sheet invoices repeat it). WebView 83 also lacks flexbox `gap` (Chrome 84+), so the company name ran into the logo: start-up detects this and compat.css spaces the invoice paper with margins. New Android check: company name clear of the logo.

### v8.0.5 (29 Oct 2026)
8.0.4 fixed the logo spacing on WebView 83 (verified: 9 px, margin fallback) but its PDF still had 4 sheets: copy 2 (the first copy after a page break) is laid out progressively taller than measured (+1.5 pt by the party boxes, +7 pt by the item table, +14 pt by the terms) and crosses that engine's sheet boundary. Engines without flexbox gap (Chrome < 84) now use a 270 mm page target; all others keep 280 mm.

### v8.1.0 — Google Play readiness: sign-in, per-account data, automatic cloud sync (29 Oct 2026)
- **Sign in with Google required** (Android Credential Manager). The app gets a Google ID token, the sync service verifies it
  (signature, issuer, audience, expiry, verified e-mail) and issues its own session. No Google API credential is in the app.
- **Per-account data:** storage slot `hgi_billing_u_<key>` + mirror file `state-u-<key>`, key = SHA-256 of the Google account ID.
  Data from ≤ 8.0 (`hgi_billing_v7_prod` / `state`) is offered to the first account that signs in, then marked as claimed.
- **Sync service** `backend/` (Cloud Run, no dependencies): one spreadsheet per account in the company Drive (readable tabs +
  gzip/base64 restore copy in hidden A/B tabs, checksum-verified before it goes live), version check → 409 on concurrent edits,
  account deletion (in-app + `/delete-account` web page, deletion marker revokes old sessions), `/privacy`.
- **App sync engine** (`src/account.js`): debounced upload after each save + on app background, offline retry with backoff,
  pull of other-device changes (never under an open form/dialog), conflict dialog with safety copy, Settings → Account card,
  sign out (optionally remove data from a shared phone), delete account. No backup reminders while synced.
- **Bug fixed:** with Demo Mode open, sending the app to the background wrote sample data into the real-data mirror file.
- **Release pipeline:** builds signed with the owner key must have sign-in configured; versionCode 100 + run (+ offset);
  debug APK renamed `*-debug-TESTONLY.apk`; key scripts for Windows/macOS/Linux print the SHA-1 for the Android OAuth client.
- **Tests:** backend 36/36 (fake Google); sync e2e in Chromium 44/44; web 270/270 locally (266 in CI); Android 44/44 on API 30/33/35/36 (run 40874486585; 3 of 4 needed the CI retry: WebView renderer died on reload (API 30), emulator ANR (API 33, 36)). The emulator test now signs in,
  syncs, really uninstalls + reinstalls the APK and checks the restore, separates two accounts, adopts pre-8.1 data.
- CI found that a slow first bridge reply made the app fall back to "no sign-in" — fixed (retries, never the web default on native).
- Setup for the owner: `docs/PLAY-RELEASE.md`.
