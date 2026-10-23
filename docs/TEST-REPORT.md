# HGI Billing v7.2.0: test report

_Branch `android-v7`, commit 290f6c4, build 7.2.0 (125). CI: GitHub Actions "Android build & test"; builds and logs are published to the `ci-output-*` branches._

## Automated suites
| Suite | What it covers | Result |
|---|---|---|
| Web (Chromium; phone 360 & 412, tablet 800, desktop 1366) — `tests/web-smoke.mjs` | Fresh install empty; setup wizard incl. wrong-IFSC fix flow; GST engine regression numbers; stock; invoice save; print → 3 A4 pages; quotation → invoice; compact lists + row action sheet; quick actions; live total; dark mode; Hindi/Gujarati; Demo Mode isolation and watermark; upgrade from old sample data; data-safety guards (delete/cancel/IRN lock, discount, duplicate/renamed items, backup validation + undo, revision stamps, unreadable-data recovery copy, credit-note index, paged register); CSP | **198 / 198** |
| Android emulator — `tests/android-smoke.mjs` | Native app + plugin, offline libraries/fonts, wizard covers screen on old WebViews, ₹ glyph width, no native title bar, navy status bar, GST invoice, UPI QR, A4 PDF written to Downloads and validated, back button, restart persistence, newer-copy wins, restore after WebView wipe, Demo Mode with separate native mirror, Hindi + dark | **31 / 31 on each device** (CI run 39859191752, all first attempt) |

## Android compatibility matrix (CI emulators, Google APIs x86_64)
| Device profile | Android / API | WebView | Result |
|---|---|---|---|
| Pixel 2 (5", 1080×1920) | 11 / 30 | 83 | **31/31** (₹ system-font fallback active) |
| Pixel 6 (6.4") | 13 / 33 | 109 | **31/31** |
| Pixel C (10" tablet) | 15 / 35 | 124 | **31/31** |
| Pixel 7 | 16 / 36 (target SDK) | 133 | **31/31** |

## Security checks
- No secrets in the repo or app: signing keys come only from GitHub secrets. Release builds fail without the owner key, or if the key fingerprint differs from `ANDROID_CERT_SHA256`.
- CSP blocks remote connections, frames and objects (tested). `usesCleartextTraffic=false`. No dangerous permissions (verified by the `aapt2` dump in CI).
- Financial data is excluded from Google cloud backup; Android 12+ phone-to-phone transfer is allowed (CI asserts the manifest attributes).
- No e-invoice/e-way bill submission is simulated. IRN fields are manual entry until the Phase E server integration.

## Performance (3,000 invoices, Chromium, 4× CPU throttle)
App start 7.6 s → 1.3 s · Documents 4.0 s → 0.14 s · Dashboard 1.3 s → 0.17 s · save 40 ms.

## Defects found during testing and fixed
1. Setup wizard stuck on Bank & UPI: a 10-character IFSC was rejected with an invisible error (user-reported).
2. A stale WebView copy could load over a newer native mirror.
3. Restore replaced data with no safety copy.
4. IRN invoices were editable.
5. Invoices with receipts or notes could be deleted.
6. Invoices with live notes could be cancelled.
7. Discount larger than the value was not flagged.
8. Duplicate item names; renamed items lost their stock history.
9. Restoring a backup could reopen the setup wizard.
10. O(n²) list rendering.
11. Speculative-parser requests for `${logo}` URLs under CSP.
12. Old WebView (Chrome 80–87): grey buttons and a setup wizard that didn't fill the screen.
13. Old WebView (< 100): bold Inter ₹ drawn with zero width over the first digit. ₹ now comes from the system font on those engines.
14. The Android test could hang the CI job (watchdog and timeouts added).

## Known limitations (not fixed here)
- The web build keeps a client-side `admin/123` login. Android uses a PIN. Real accounts need the planned server (Phase C).
- Stock is matched by item name (aliases cover renames). There is no product ID on invoice lines from earlier versions.
- On WebView < 105, the `:has()`-based refinements (hiding the item "check" row, the empty-row chevron) degrade gracefully.
- CI APK/AAB are signed with a throw-away **test key** until the owner adds the release-key secrets.
