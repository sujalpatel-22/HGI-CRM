#!/usr/bin/env node
// Smoke test of the installed debug APK on an Android emulator/device, driving the app's WebView
// through Chrome DevTools (Playwright _android). Verifies native features: offline assets, onboarding,
// invoice + GST maths, native PDF rendering to Downloads, data mirror, restart persistence, back button.
import fs from 'node:fs';
import path from 'node:path';
import { _android as android } from 'playwright';

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

async function launch() {
  // the DevTools socket of a freshly started WebView is sometimes not picked up on slow CI emulators → retry
  for (let attempt = 1; ; attempt++) {
    try {
      await device.shell(`am force-stop ${PKG}`);
      await device.shell(`am start -W -n ${PKG}/.MainActivity`);
      const webview = await device.webView({ pkg: PKG }, { timeout: 60000 });
      const page = await webview.page();
      await page.waitForFunction(() => window.HGI_READY === true, null, { timeout: 60000 });
      return page;
    } catch (e) {
      if (attempt >= 3) throw e;
      console.log(`    (launch attempt ${attempt} failed: ${String(e).split('\n')[0]} — retrying)`);
    }
  }
}

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
check(await page.isVisible('#onboarding'), 'onboarding shown on first launch');

// onboarding
await page.click('#ob-next');
await page.fill('#ob-name', 'Emulator Test Traders'); await page.fill('#ob-gstin', '24AAPFU0939F1ZV'); await page.dispatchEvent('#ob-gstin', 'input');
await page.fill('#ob-addr', 'GIDC Naroda, Ahmedabad'); await page.fill('#ob-pin', '382330');
await page.click('#ob-next'); await page.fill('#ob-upi', 'test@upi'); await page.click('#ob-next'); await page.click('#ob-next');
await page.waitForTimeout(500);
const phone = await page.evaluate(() => window.innerWidth < 768);
check(!(await page.isVisible('#onboarding')) && (await page.isVisible('#bottom-nav')) === phone, `onboarding done, ${phone ? 'bottom tab bar' : 'tablet top navigation'} shown`);
await shot('02-dashboard');
const ui = (await device.shell('uiautomator dump /sdcard/hgi-ui.xml >/dev/null 2>&1; cat /sdcard/hgi-ui.xml')).toString();
fs.writeFileSync(path.join(OUT, `${label}-ui.xml`), ui);
check(ui.includes('<hierarchy') && !/<node[^>]*text="HGI Billing"[^>]*class="android.widget.TextView"/.test(ui), 'no native title bar over the app');
// pixel just under the top edge of the screen (inside the status bar): must be the navy header colour, not grey/white
const raw = await device.shell('screencap');
const W = raw.readUInt32LE(0), H = raw.readUInt32LE(4), hdrLen = raw.length - W * H * 4;
const px = y => { const o = hdrLen + (y * W + Math.floor(W / 2)) * 4; return [raw[o], raw[o + 1], raw[o + 2]]; };
const top = px(8), below = px(Math.round(H * 0.06));
console.log('    status-bar pixel', top, 'header pixel', below, 'insets', JSON.stringify(await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--safe-area-inset-top'))));
check(top[2] > top[0] + 40 && top[0] + top[1] + top[2] < 330, `status bar area is navy (rgb ${top.join(',')})`);

// invoice
await page.evaluate(() => newDocument('INV'));
await page.fill('#inv-buyer-name', 'Shree Ram Engineering'); await page.fill('#inv-buyer-gstin', '27AAPFU0939F1ZV'); await page.dispatchEvent('#inv-buyer-gstin', 'input');
await page.fill('#inv-buyer-address', 'MIDC Bhosari, Pune'); await page.fill('#inv-buyer-pin', '411026');
const row = page.locator('#invoice-items-body tr').first();
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
  try { fs.writeFileSync(path.join(OUT, `${label}-invoice.pdf`), await device.shell('cat /data/local/tmp/hgi.pdf')); } catch (e) { /* best effort */ }
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
// simulate the WebView's storage being wiped (e.g. WebView update/reset): delete its Local Storage on disk while
// the app is stopped (debug build → run-as), keep the app's own files dir where the native mirror lives
await page.evaluate(() => localStorage.clear()); await page.waitForTimeout(500);
await device.shell(`am force-stop ${PKG}`);
await device.shell(`run-as ${PKG} sh -c 'rm -rf app_webview/Default/"Local Storage" app_webview/"Local Storage"; ls files'`).then(b => console.log('    files dir:', b.toString().trim()));
page = await launch();
check(await page.evaluate(() => state.invoices.length === 1 && window.__restoredFromMirror === true), 'data restored from on-device mirror when WebView storage is wiped');

// dark mode + Hindi
await page.evaluate(() => { HGI_M.setTheme('dark'); HGI_M.setLang('hi'); }); await page.waitForTimeout(800);
await shot('05-dark-hindi');
check(await page.evaluate(() => document.querySelector('#bottom-nav button[data-tab="customers"] span').textContent === 'ग्राहक'), 'Hindi UI');

check(errors.length === 0, `no JavaScript errors${errors.length ? ': ' + errors.slice(0, 3).join(' | ') : ''}`);
console.log(`\n${label}: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
