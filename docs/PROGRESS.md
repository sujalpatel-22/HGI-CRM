# Work log: UI/UX + QA upgrade (continue from here if a session ends)

Branch `android-v7`. Local web test: build `www/` (see the `node -e` snippet in tools/build-web.mjs, or CI), copy vendor files from a CI debug APK
(`assets/public/vendor/*`) into `www/vendor/`, symlink `node_modules/playwright` → global playwright, then run `node tests/web-smoke.mjs`.

| Phase | Status | Commit |
|---|---|---|
| 0. Onboarding stuck on Bank & UPI (user-reported) | ✅ fixed, web test | 1e679b1 |
| 1. Critical bugs + GST/data accuracy (AUDIT items 2–10) | ✅ web 183/183 locally; Android CI pending | (this commit) |
| 2. UI/UX redesign | ⏳ | |
| 3. Security / performance / Android | ⏳ | |
| 4. Regression + APK | ⏳ | |
