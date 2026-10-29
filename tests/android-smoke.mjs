#!/usr/bin/env node
// Smoke test of the installed debug APK on an Android emulator/device, driving the app's WebView
// through Chrome DevTools (Playwright _android). Verifies native features: offline assets, onboarding,
// invoice + GST maths, native PDF rendering to Downloads, data mirror, restart persistence, back button.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import { _android as android } from 'playwright';

// v8.1: the debug APK signs in with TEST accounts against a local sync service (fake Google Drive/Sheets) on the
// CI host, reached from the emulator at 127.0.0.1:8787 through `adb reverse`. Release builds use Sign in with Google.
const require = createRequire(import.meta.url);
const { FakeGoogle } = require('../backend/test/fake-google.js');
const { createServer } = require('../backend/server.js');
const config = require('../backend/lib/config.js');
const g = await new FakeGoogle().start();
const syncCfg = config.load({ GOOGLE_CLIENT_IDS: 'test-web-client.apps.googleusercontent.com', SESSION_SECRET: 'emulator-test-secret-0123456789abcdef', DRIVE_FOLDER_ID: 'hgi-folder',
  DRIVE_AUTH: 'metadata', HGI_ALLOW_TEST_LOGIN: '1', ALLOWED_ORIGINS: 'https://localhost' });
syncCfg.endpoints = g.endpoints();
const syncServer = createServer(syncCfg);
await new Promise((res, rej) => { syncServer.once('error', rej); syncServer.listen(8787, '127.0.0.1', res); });
try { execFileSync('adb', ['reverse', 'tcp:8787', 'tcp:8787'], { stdio: 'pipe' }); } catch (e) { console.log('adb reverse failed:', String(e.stderr || e)); }

const PKG = 'in.hariguru.billing';
const label = process.env.HGI_TEST_LABEL || 'device';
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'out-android');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const check = (c, m) => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${m}`); };

const [device] = await android.devices();
if (!device) { console.error('no device'); process.exit(1); }
const sdk = (await device.shell('getprop ro.build.version.sdk')).toString().trim();
const wv = (await device.shell('dumpsys package com.google.android.webview | grep versionName | head -1')).toString().trim();
console.log(`▶ ${label}: ${device.model()} · Android SDK ${sdk} · WebView ${wv}`);
const shot = async n => fs.writeFileSync(path.join(OUT, `${label}-${n}.png`), await device.screenshot());

// watchdog: a hung adb/WebView call must fail this run (so the CI retry can start), not eat the whole job timeout
setTimeout(() => { console.log('✗ watchdog: smoke test exceeded 15 minutes'); process.exit(3); }, 15 * 60 * 1000);
const within = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms))]);
let lastLaunchAttempts = 1;
// after an in-app reload (Demo Mode switch) the DevTools page target can be replaced: re-attach until cond() holds
async function afterReload(cond, timeoutMs = 90000) {
  const end = Date.now() + timeoutMs;
  let pg = page;
  while (Date.now() < end) {
    try {
      if (await pg.evaluate(cond)) return pg;
    } catch (e) {
      try { pg = await (await device.webView({ pkg: PKG }, { timeout: 15000 })).page(); } catch (e2) { /* not back yet */ }
    }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('app did not come back after reload');
}
async function launch() {
  // the DevTools socket of a freshly started WebView is sometimes not picked up on slow CI emulators → retry
  for (let attempt = 1; ; attempt++) {
    try {
      await within(device.shell(`am force-stop ${PKG}`), 30000, 'force-stop');
      await within(device.shell(`am start -W -n ${PKG}/.MainActivity`), 60000, 'am start');
      const webview = await device.webView({ pkg: PKG }, { timeout: 60000 });
      const page = await webview.page();
      await page.waitForFunction(() => window.HGI_READY === true || window.HGI_SIGNIN_READY === true, null, { timeout: 60000 });
      lastLaunchAttempts = attempt;
      return page;
    } catch (e) {
      if (attempt >= 3) throw e;
      console.log(`    (launch attempt ${attempt} failed: ${String(e).split('\n')[0]} — retrying)`);
    }
  }
}

// test sign-in on the device; returns the page after the app reloaded into the account
async function signIn(email, choose) {
  await page.waitForSelector('#signin-screen #si-go', { timeout: 30000 });
  await page.fill('#si-email', email);
  await page.click('#si-go');
  if (choose) { await page.waitForSelector('.acct-dlg', { timeout: 30000 }); await page.click(choose); }
  return afterReload(() => window.HGI_READY === true && !!window.HGI_ACCOUNT && !document.getElementById('signin-screen'));
}
const mirrorKey = () => page.evaluate(() => 'state-u-' + HGI_ACCOUNT.key);

let page = await launch();
const errors = [];
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
await page.waitForTimeout(1500);
await shot('01-start');

check(await page.evaluate(() => window.HGI_APP && window.HGI_APP.isNative === true), 'runs as native Capacitor app');
check(await page.evaluate(() => window.HGI_APP.hasNativePlugin === true), 'HgiNative plugin reachable from JavaScript');
check(await page.evaluate(async () => { await Capacitor.Plugins.HgiNative.writeState({ key: 'selftest', data: 'ok-123' }); const r = await Capacitor.Plugins.HgiNative.readState({ key: 'selftest' }); return r.data === 'ok-123'; }), 'native writeState/readState round trip');
check(await page.evaluate(() => typeof window.QRCode === 'function' && typeof window.Chart === 'function'), 'bundled QR + Chart libraries loaded (offline)');
check(await page.evaluate(async () => { await document.fonts.ready; return getComputedStyle(document.querySelector('.fa-solid') || document.body).fontFamily.includes('Font Awesome'); }), 'bundled Font Awesome icons');
check(await page.evaluate(() => getComputedStyle(document.body).fontFamily.includes('Inter') && document.fonts.check('12px Inter')), 'bundled Inter font');
check(await page.evaluate(() => [...document.styleSheets].some(s => { try { return [...s.cssRules].some(r => r.selectorText === '.bg-white'); } catch (e) { return false; } })), 'compiled Tailwind CSS loaded');
check(!(await page.isVisible('#login-overlay')), 'no username/password screen on Android');
const ncfg = await page.evaluate(() => Capacitor.Plugins.HgiNative.getConfig());
check(ncfg.auth === 'test' && ncfg.syncUrl === 'http://127.0.0.1:8787', `debug build: test sign-in against the local test service (${JSON.stringify(ncfg)})`);
check(await page.isVisible('#signin-screen') && !(await page.isVisible('#app-container')), 'sign-in required before the app opens');
await shot('00-signin');
page = await signIn('emulator@example.com');
page.on('pageerror', e => errors.push(String(e)));
page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
check(await page.evaluate(() => /^hgi_billing_u_[a-f0-9]{24}$/.test(STORAGE_KEY)), 'signed in: data opens in the account\'s own slot');
check(await page.isVisible('#onboarding'), 'onboarding shown on first launch');
check(await page.evaluate(() => !state.products.length && !state.customers.length && !state.invoices.length && !state.company.gstin && !state.company.bankAcc && !state.company.name),
  'fresh install starts with no business data (no sample company, items, buyers or invoices)');

// layout engine compatibility (older WebViews drop Tailwind rules that use :where() / inset)
const lay = await page.evaluate(() => ({ h: document.getElementById('onboarding').getBoundingClientRect().height, vh: innerHeight,
  bg: getComputedStyle(document.getElementById('ob-demo')).backgroundColor }));
check(lay.h >= lay.vh - 1 && /rgba\(0, 0, 0, 0\)|transparent/.test(lay.bg), `setup wizard covers the screen, buttons unstyled by default (${Math.round(lay.h)}/${lay.vh}px, ${lay.bg})`);
// onboarding
await page.click('#ob-next');
await page.fill('#ob-name', 'Emulator Test Traders'); await page.fill('#ob-gstin', '24AAPFU0939F1Z1'); await page.dispatchEvent('#ob-gstin', 'input');
await page.fill('#ob-addr', 'GIDC Naroda, Ahmedabad'); await page.fill('#ob-pin', '382330');
await page.click('#ob-next'); await page.fill('#ob-upi', 'test@upi'); await page.click('#ob-next'); await page.click('#ob-next');
await page.waitForTimeout(500);
const phone = await page.evaluate(() => window.innerWidth < 768);
check(!(await page.isVisible('#onboarding')) && (await page.isVisible('#bottom-nav')) === phone, `onboarding done, ${phone ? 'bottom tab bar' : 'tablet top navigation'} shown`);
await shot('02-dashboard');
// ₹ must take its own space (old WebViews drew the fallback-font glyph on top of the first digit)
const rupee = await page.evaluate(async () => { await document.fonts.ready; await new Promise(r => setTimeout(r, 300)); const h = document.getElementById('hero-amount'); const sp = document.createElement('span'); sp.textContent = '₹'; h.appendChild(sp);
  const w = sp.getBoundingClientRect().width, fs = parseFloat(getComputedStyle(h).fontSize); sp.remove(); return { w, fs, fix: !!window.HGI_APP.rupeeFix, probe: window.HGI_APP.rupeeWidths }; });
check(rupee.w > rupee.fs * 0.35, `₹ sign has its own width (${rupee.w.toFixed(1)}px at ${rupee.fs}px${rupee.fix ? ', system-font fallback active' : ''}, probe ${JSON.stringify(rupee.probe)})`);
const ui = (await device.shell('uiautomator dump /sdcard/hgi-ui.xml >/dev/null 2>&1; cat /sdcard/hgi-ui.xml')).toString();
fs.writeFileSync(path.join(OUT, `${label}-ui.xml`), ui);
check(ui.includes('<hierarchy') && !/<node[^>]*text="HGI Billing"[^>]*class="android.widget.TextView"/.test(ui), 'no native title bar over the app');
// pixel just under the top edge of the screen (inside the status bar): must be the navy header colour, not grey/white
const raw = await device.shell('screencap');
const W = raw.readUInt32LE(0), H = raw.readUInt32LE(4), hdrLen = raw.length - W * H * 4;
const px = y => { const o = hdrLen + (y * W + Math.floor(W / 2)) * 4; return [raw[o], raw[o + 1], raw[o + 2]]; };
const top = px(8), below = px(Math.round(H * 0.06));
console.log('    status-bar pixel', top, 'header pixel', below, 'insets', JSON.stringify(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top'))));
// v8: the app bar is the page colour, so the status bar must be painted that colour (not Android's default grey / black / white)
const pageRgb = await page.evaluate(() => (getComputedStyle(document.body).backgroundColor.match(/\d+/g) || []).slice(0, 3).map(Number));
check(pageRgb.length === 3 && top.every((c, i) => Math.abs(c - pageRgb[i]) <= 14) && !(top[0] > 250 && top[1] > 250 && top[2] > 250),
  `status bar painted the page colour (rgb ${top.join(',')} vs page ${pageRgb.join(',')})`);

// invoice
await page.evaluate(() => newDocument('INV'));
await page.fill('#inv-buyer-name', 'Shree Ram Engineering'); await page.fill('#inv-buyer-gstin', '27AAPFU0939F1ZV'); await page.dispatchEvent('#inv-buyer-gstin', 'input');
await page.fill('#inv-buyer-address', 'MIDC Bhosari, Pune'); await page.fill('#inv-buyer-pin', '411026');
const row = page.locator('#invoice-items-body tr').first();
await page.evaluate(() => { state.products.push({ id: uid('PROD'), name: 'Industrial Machine Components', hsn: '848390', unit: 'NOS', rate: 2500, gst: 18 }); saveState(); refreshProductDatalist(); });
await row.locator('.item-desc').fill('Industrial Machine Components'); await row.locator('.item-desc').dispatchEvent('change');
await row.locator('.item-qty').fill('4');
await page.waitForTimeout(600);
await shot('03-invoice-form');
check(await page.evaluate(() => saveCurrentInvoice()) === true, 'invoice saved');
check(await page.evaluate(() => { const d = state.invoices[0]; return d.igst === 1800 && d.grandTotal === 11800; }), 'GST: inter-state IGST 18% on ₹10,000 = ₹1,800, total ₹11,800');

// preview + UPI QR + native PDF
await page.evaluate(() => renderPreview()); await page.waitForTimeout(1200);
check(await page.evaluate(() => [...document.querySelectorAll('#invoice-preview-container img')].some(i => i.src.startsWith('data:image/png') && i.naturalWidth > 100)), 'UPI scan-to-pay QR rendered');
await shot('04-preview');
const hdr = await page.evaluate(() => { const pg = document.querySelector('#invoice-preview-container .a4-page'), h = pg && pg.querySelector('.modern-header');
  const img = h && h.querySelector('img'); const name = h && [...h.querySelectorAll('*')].find(e => e.children.length === 0 && e.textContent.trim() === state.company.name);
  if (!img || !name) return { skip: true, flexGap: window.HGI_APP.flexGap };
  const a = img.getBoundingClientRect(), b = name.getBoundingClientRect(); return { gap: Math.round(b.left - a.right), flexGap: window.HGI_APP.flexGap }; });
check(hdr.skip || hdr.gap >= 4, `invoice header: company name clear of the logo (${hdr.skip ? 'n/a' : hdr.gap + 'px'}, flex gap ${hdr.flexGap ? 'native' : 'margin fallback'})`);
const sdkNum = Number(sdk);
await device.shell(`rm -rf "/sdcard/Download/HGI Billing"`);
const saveRes = await page.evaluate(async () => { try { await HGI_M.savePdf(); return 'ok'; } catch (e) { return String(e); } });
await page.waitForTimeout(1500);
const toastText = await page.evaluate(() => document.getElementById('toast-container').innerText);
console.log('    save toast:', toastText.replace(/\n/g, ' / '));
if (sdkNum >= 29) {
  const ls = (await device.shell(`ls -l "/sdcard/Download/HGI Billing/"`)).toString();
  const m = ls.match(/\s(\d{4,})\s.*\.pdf/);
  check(saveRes === 'ok' && m && Number(m[1]) > 20000, `native A4 PDF written to Downloads/HGI Billing (${m ? m[1] + ' bytes' : ls.trim() || 'not found'})`);
  const head = (await device.shell(`head -c 8 "/sdcard/Download/HGI Billing/"*.pdf`)).toString();
  check(head.startsWith('%PDF-'), 'file is a valid PDF');
  await device.shell(`cp "/sdcard/Download/HGI Billing/"*.pdf /data/local/tmp/hgi.pdf`);
  let pdfBuf = null;
  try { pdfBuf = await device.shell('cat /data/local/tmp/hgi.pdf'); fs.writeFileSync(path.join(OUT, `${label}-invoice.pdf`), pdfBuf); } catch (e) { /* best effort */ }
  // one A4 sheet per copy: a copy that overflows its sheet by a few pixels adds a blank page (seen on small phones, v8.0.1 CI)
  const copies = await page.evaluate(() => selectedCopies().length);
  const pdfText = pdfBuf ? Buffer.from(pdfBuf).toString('latin1') : '';
  const counts = [...pdfText.matchAll(/\/Type\s*\/Pages\b[^>]*?\/Count\s+(\d+)|\/Count\s+(\d+)[^>]*?\/Type\s*\/Pages\b/g)].map(m => Number(m[1] || m[2]));
  const sheets = counts.length ? Math.max(...counts) : (pdfText.match(/\/Type\s*\/Page[^s]/g) || []).length;
  check(sheets === copies, `native PDF: ${copies} copies → ${sheets} A4 sheets (one per copy, no spill-over pages)`);
}

// back button closes the open modal instead of leaving the app
await page.evaluate(() => { switchTab('items'); openItemModal(); });
await page.waitForTimeout(400);
await device.shell('input keyevent 4');
await page.waitForTimeout(600);
check(await page.evaluate(() => document.getElementById('item-modal').classList.contains('hidden')), 'Android back button closes dialog');
await device.shell('input keyevent 4'); await page.waitForTimeout(500);
check(await page.evaluate(() => !document.getElementById('tab-dashboard').classList.contains('hidden')), 'back button returns to dashboard');

// data mirror → survives restart
await page.evaluate(() => saveState()); await page.waitForTimeout(1500);
page = await launch();
check(await page.evaluate(() => state.invoices.length === 1 && state.company.name === 'Emulator Test Traders'), 'data persists after app restart');
// WebView storage behind the app-file mirror (e.g. storage full): the newer copy must win at start-up
await page.evaluate(async () => { const s = JSON.parse(JSON.stringify(state)); s.company.tagline = 'from-newer-mirror'; s.ui.rev = (Number(state.ui.rev) || 0) + 100;
  await Capacitor.Plugins.HgiNative.writeState({ key: 'state-u-' + HGI_ACCOUNT.key, data: JSON.stringify(s) }); });
page = await launch();
check(await page.evaluate(retried => state.company.tagline === 'from-newer-mirror' && (window.__restoredFromMirror === true || retried) && state.invoices.length === 1, lastLaunchAttempts > 1), 'newer on-device copy wins over older WebView storage');
// simulate the WebView's storage being wiped (e.g. WebView update/reset): delete its Local Storage on disk while
// the app is stopped (debug build → run-as), keep the app's own files dir where the native mirror lives
await page.evaluate(() => localStorage.clear()); await page.waitForTimeout(500);
await device.shell(`am force-stop ${PKG}`);
await device.shell(`run-as ${PKG} sh -c 'rm -rf app_webview/Default/"Local Storage" app_webview/"Local Storage"; ls files'`).then(b => console.log('    files dir:', b.toString().trim()));
page = await launch();
// (if the first launch attempt timed out, that attempt already restored the data — the retry then finds it in WebView storage)
check(await page.evaluate(retried => state.invoices.length === 1 && (window.__restoredFromMirror === true || retried), lastLaunchAttempts > 1), 'data restored from on-device mirror when WebView storage is wiped');

// Demo Mode: opt-in, separate storage + separate native mirror file; real data untouched; exit deletes sample data
// confirmation dialogs are covered by the web test; native AlertDialogs can't be driven reliably over DevTools
await page.evaluate(() => { HGI_M.enterDemo({ confirmed: true }); });
page = await afterReload(() => window.HGI_READY === true && typeof DEMO_MODE !== 'undefined' && DEMO_MODE === true);
check(await page.evaluate(() => state.invoices.length === 5 && state.invoices.every(d => d.demo) && !!document.getElementById('demo-banner')), 'Demo Mode shows sample data with a DEMO banner');
await page.waitForTimeout(1500);
check(await page.evaluate(async () => { const r = await Capacitor.Plugins.HgiNative.readState({ key: 'state-u-' + HGI_ACCOUNT.key }); const s = JSON.parse(r.data); return s.invoices.length === 1 && s.company.name === 'Emulator Test Traders'; }),
  'real data in the native mirror untouched while Demo Mode is open');
await shot('05a-demo');
await page.evaluate(() => { HGI_M.exitDemo({ confirmed: true }); });
page = await afterReload(() => window.HGI_READY === true && typeof DEMO_MODE !== 'undefined' && DEMO_MODE === false);
await page.waitForTimeout(3000);
check(await page.evaluate(async () => { const r = await Capacitor.Plugins.HgiNative.readState({ key: 'state-demo' }); return state.invoices.length === 1 && !state.invoices.some(d => d.demo) && !r.data && !document.getElementById('demo-banner'); }),
  'exit Demo Mode returns to real data and deletes the sample data');
page = await launch();
check(await page.evaluate(() => DEMO_MODE === false && state.invoices.length === 1), 'after restart the app opens real data, not demo');

// dark mode + Hindi
await page.evaluate(() => { HGI_M.setTheme('dark'); HGI_M.setLang('hi'); }); await page.waitForTimeout(800);
await shot('05-dark-hindi');
check(await page.evaluate(() => document.querySelector('#bottom-nav button[data-tab="customers"] span').textContent === 'ग्राहक'), 'Hindi UI');

/* ---------------------------------------------------------------- v8.1 cloud sync on the device */
await page.evaluate(() => { HGI_M.setTheme('light'); HGI_M.setLang('en'); });
const synced = await page.evaluate(() => HGI_SYNC._syncNow().then(() => HGI_SYNC.status()));
const acctKey = synced.account && synced.account.key;
const sheet = acctKey && g.spreadsheetOf(acctKey);
check(synced.status === 'ok' && sheet && g.rows(sheet.id, 'Invoices').length === 2 && g.rows(sheet.id, 'Company')[1][1] === 'Emulator Test Traders',
  `data synced from the phone to the account's spreadsheet (status ${synced.status}${synced.error ? ': ' + synced.error : ''})`);
// real uninstall + reinstall of the same APK, then sign in again → everything back
const apk = process.env.HGI_APK;
if (apk && fs.existsSync(apk)) {
  await device.shell(`am force-stop ${PKG}`);
  await within(device.shell(`pm uninstall ${PKG}`), 60000, 'uninstall');
  check(!(await device.shell(`pm list packages ${PKG}`)).toString().includes(PKG), 'app uninstalled (all on-device data gone)');
  await within(device.installApk(fs.readFileSync(apk)), 180000, 'install');
  try { execFileSync('adb', ['reverse', 'tcp:8787', 'tcp:8787'], { stdio: 'pipe' }); } catch (e) { /* kept from before */ }
  page = await launch();
  check(await page.isVisible('#signin-screen'), 'reinstalled app asks for sign-in');
  page = await signIn('emulator@example.com');
  check(await page.evaluate(() => state.invoices.length === 1 && state.company.name === 'Emulator Test Traders' && state.invoices[0].grandTotal === 11800 && !document.getElementById('onboarding')),
    'after reinstall + sign-in all data is restored from the cloud (invoice, company, no setup wizard)');
  await shot('06-restored-after-reinstall');
  page = await launch();
  check(await page.evaluate(() => !!window.HGI_ACCOUNT && state.invoices.length === 1), 'stays signed in and keeps the data after restart');
} else console.log('    (HGI_APK not set — reinstall check skipped)');
// second account on the same phone sees nothing of the first
await page.evaluate(() => { HGI_SYNC.signOut(); }); await page.waitForSelector('.acct-dlg'); await page.click('.acct-dlg .acct-btn-primary');
page = await afterReload(() => window.HGI_SIGNIN_READY === true && !!document.getElementById('signin-screen'));
page = await signIn('second@example.com');
check(await page.evaluate(() => state.invoices.length === 0 && !state.company.name), 'another account on the same phone starts empty (data separated)');
// upgrade from v8.0 (no accounts): data in the old slot + old mirror file is adopted by the first account that signs in
await page.evaluate(() => { HGI_SYNC.signOut(); }); await page.waitForSelector('.acct-dlg'); await page.click('.acct-dlg .acct-btn-primary');
page = await afterReload(() => window.HGI_SIGNIN_READY === true && !!document.getElementById('signin-screen'));
await page.evaluate(async () => {
  localStorage.removeItem('hgi_legacy_owner');
  const old = { credentials: {}, company: { name: 'Pre-8.1 Traders' }, products: [], customers: [], ui: { rev: 900, onboarded: true },
    invoices: [{ id: 'OLD1', docType: 'INV', num: 'OLD/1', date: '2026-09-01', buyerName: 'Old Buyer', items: [{ desc: 'Valve', hsn: '8481', gst: 18, qty: 1, unit: 'NOS', rate: 100 }], payments: [], grandTotal: 118 }] };
  await Capacitor.Plugins.HgiNative.writeState({ key: 'state', data: JSON.stringify(old) });
});
page = await signIn('upgrader@example.com');
check(await page.evaluate(() => state.company.name === 'Pre-8.1 Traders' && state.invoices.length === 1), 'upgrade: data saved before sign-in existed is kept and opened in the account');
const up = await page.evaluate(() => HGI_SYNC._syncNow().then(() => HGI_SYNC.status()));
check(up.status === 'ok' && g.rows(g.spreadsheetOf(up.account.key).id, 'Invoices').some(r => r[1] === 'OLD/1'), 'upgrade: that data is uploaded to the account');
await shot('07-upgraded');

check(errors.length === 0, `no JavaScript errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
console.log(`\n${label}: ${pass} passed, ${fail} failed`);
syncServer.close(); await g.stop();
process.exit(fail ? 1 : 0);
