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
