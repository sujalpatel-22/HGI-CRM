#!/usr/bin/env node
// LIVE check of the Android app against the DEPLOYED cloud service and the REAL Google Spreadsheet.
// Runs only on the CI branch `live-check` (see .github/workflows/android.yml → live-app-test). Needs no secret: it creates a
// throw-away account (livecheck-<random>, random password, never printed) and deletes it again at the end.
//
//   HGI_LIVE_URL=https://… HGI_APK=…-debug-LIVE-TESTONLY.apk node tests/android-live.mjs
//
// The LIVE-TESTONLY APK is the normal debug build with its sign-in pointed at the live service (same web app, same native
// code as the release APK; debug only so the test can drive the WebView). It checks: sign-up in the app, company set-up,
// an invoice saved and uploaded, the invoice read back through the public API from a second "device" (byte-for-byte),
// then the app's data wiped (pm clear = a new phone) and a log-in that brings the invoice back, and finally deletion.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { _android as android } from 'playwright';

const LIVE = String(process.env.HGI_LIVE_URL || '').replace(/\/$/, '');
if (!/^https:\/\//.test(LIVE)) { console.error('HGI_LIVE_URL (https) is required'); process.exit(2); }
const PKG = 'in.hariguru.billing';
const label = process.env.HGI_TEST_LABEL || 'live';
const OUT = path.resolve(path.dirname(new URL(import.meta.url).pathname), 'out-android');
fs.mkdirSync(OUT, { recursive: true });
let pass = 0, fail = 0;
const check = (c, m, extra = '') => { c ? pass++ : fail++; console.log(`  ${c ? '✓' : '✗'} ${m}${!c && extra ? ' — ' + extra : ''}`); return c; };
setTimeout(() => { console.log('✗ watchdog: live test exceeded 20 minutes'); finish(3); }, 20 * 60 * 1000);
const within = (p, ms, what) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error(`${what} timed out after ${ms / 1000}s`)), ms))]);
async function api(method, p, { body, token } = {}) {
  const r = await fetch(LIVE + p, { method, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
  const text = await r.text(); let json = null; try { json = JSON.parse(text); } catch (e) { /* not json */ }
  return { status: r.status, json, text };
}

const user = 'livecheck-' + crypto.randomBytes(4).toString('hex');
const password = 'Live-' + crypto.randomBytes(12).toString('base64url');
let accountMade = false;

const [device] = await android.devices();
if (!device) { console.error('no device'); process.exit(1); }
await device.shell('settings put global hide_error_dialogs 1').catch(() => null);
const shot = async n => fs.writeFileSync(path.join(OUT, `${label}-${n}.png`), await device.screenshot());
console.log(`▶ ${label}: ${device.model()} · Android SDK ${(await device.shell('getprop ro.build.version.sdk')).toString().trim()} · service ${LIVE}`);

let page;
async function attach(cond, timeoutMs = 90000) {
  const end = Date.now() + timeoutMs; let pg = page;
  while (Date.now() < end) {
    try { if (pg && await pg.evaluate(cond)) return pg; }
    catch (e) { /* page target replaced by a reload */ }
    try { pg = await (await device.webView({ pkg: PKG }, { timeout: 15000 })).page(); } catch (e) { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error('app did not reach the expected state');
}
async function launch() {
  for (let attempt = 1; ; attempt++) {
    try {
      await within(device.shell(`am force-stop ${PKG}`), 30000, 'force-stop');
      await within(device.shell(`am start -W -n ${PKG}/.MainActivity`), 60000, 'am start');
      page = null;
      return await attach(() => window.HGI_READY === true || window.HGI_SIGNIN_READY === true, 90000);
    } catch (e) { if (attempt >= 3) throw e; console.log(`    (launch attempt ${attempt} failed: ${String(e).split('\n')[0]} — retrying)`); }
  }
}
async function signIn(mode) {
  await page.waitForSelector('#signin-screen #si-go', { timeout: 30000 });
  await page.click(mode === 'signup' ? '#si-tab-signup' : '#si-tab-login');
  await page.waitForSelector(mode === 'signup' ? '#si-pass2' : '#si-form:not(:has(#si-pass2))', { timeout: 10000 });
  await page.fill('#si-user', user);
  await page.fill('#si-pass', password);
  if (mode === 'signup') await page.fill('#si-pass2', password);
  await page.evaluate(() => { if (document.activeElement) document.activeElement.blur(); });
  await page.evaluate(() => document.getElementById('si-go').click());
  // a real network round trip to Cloud Run (cold start possible) + scrypt
  const res = await Promise.race([
    attach(() => window.HGI_READY === true && !!window.HGI_ACCOUNT && !document.getElementById('signin-screen'), 120000).then(pg => ({ pg })),
    (async () => { for (let i = 0; i < 240; i++) { await new Promise(r => setTimeout(r, 500)); try { const m = await page.evaluate(() => { const e = document.getElementById('si-msg'); return e && e.getAttribute('role') === 'alert' ? e.textContent : ''; }); if (m) return { err: m }; } catch (e) { return new Promise(() => {}); } } return new Promise(() => {}); })()
  ]);
  if (res.err) throw new Error('sign-in screen says: ' + res.err);
  page = res.pg;
}

let invNum = null, sentText = null;
try {
  page = await launch();
  await shot('01-start');
  const ncfg = await page.evaluate(() => Capacitor.Plugins.HgiNative.getConfig());
  check(ncfg.auth === 'password' && ncfg.syncUrl === LIVE, `app is configured for username + password accounts on the live service (${JSON.stringify(ncfg)})`);
  check(await page.isVisible('#signin-screen'), 'sign-in screen shown before the app opens');
  const h = await api('GET', '/v1/health');
  check(h.status === 200 && h.json && h.json.storage === 'google-sheets', 'live service healthy, storage google-sheets', h.text.slice(0, 200));

  // 1. sign-up in the app
  await signIn('signup'); accountMade = true;
  check(await page.evaluate(() => /^hgi_billing_u_[a-f0-9]{24}$/.test(STORAGE_KEY)), `signed up in the app as ${user} (account's own data slot)`);
  await shot('02-signed-up');

  // 2. company set-up (onboarding) and one invoice
  if (await page.isVisible('#onboarding')) {
    await page.click('#ob-next');
    await page.fill('#ob-name', 'Live Check Traders'); await page.fill('#ob-gstin', '24AAPFU0939F1Z1'); await page.dispatchEvent('#ob-gstin', 'input');
    await page.fill('#ob-addr', 'GIDC Naroda, Ahmedabad'); await page.fill('#ob-pin', '382330');
    await page.click('#ob-next'); await page.fill('#ob-upi', 'livecheck@upi'); await page.click('#ob-next'); await page.click('#ob-next');
    await page.waitForTimeout(500);
  }
  check(!(await page.isVisible('#onboarding')), 'company set-up done');
  await page.evaluate(() => newDocument('INV'));
  await page.fill('#inv-buyer-name', 'Shree Ram Engineering'); await page.fill('#inv-buyer-gstin', '27AAPFU0939F1ZV'); await page.dispatchEvent('#inv-buyer-gstin', 'input');
  await page.fill('#inv-buyer-address', 'MIDC Bhosari, Pune'); await page.fill('#inv-buyer-pin', '411026');
  await page.evaluate(() => { state.products.push({ id: uid('PROD'), name: 'Industrial Machine Components', hsn: '848390', unit: 'NOS', rate: 2500, gst: 18 }); saveState(); refreshProductDatalist(); });
  const row = page.locator('#invoice-items-body tr').first();
  await row.locator('.item-desc').fill('Industrial Machine Components'); await row.locator('.item-desc').dispatchEvent('change');
  await row.locator('.item-qty').fill('4');
  await page.waitForTimeout(600);
  check(await page.evaluate(() => saveCurrentInvoice()) === true, 'invoice saved in the app');
  const d = await page.evaluate(() => ({ num: state.invoices[0].num, id: state.invoices[0].id, total: state.invoices[0].grandTotal, igst: state.invoices[0].igst }));
  invNum = d.num;
  check(d.igst === 1800 && d.total === 11800, `GST computed: IGST ₹${d.igst}, total ₹${d.total} (invoice ${d.num})`);
  await shot('03-invoice');

  // 3. upload
  const st = await page.evaluate(() => HGI_SYNC._syncNow().then(() => HGI_SYNC.status()));
  await page.waitForFunction(() => HGI_SYNC.status().pending === 0 && HGI_SYNC.status().status === 'ok', null, { timeout: 60000 }).catch(() => null);
  const st2 = await page.evaluate(() => HGI_SYNC.status());
  check(st2.status === 'ok' && st2.pending === 0, `app reports everything uploaded (status ${st2.status}, pending ${st2.pending}${st2.error ? ', error ' + st2.error : ''})`, JSON.stringify(st));
  sentText = await page.evaluate(id => JSON.stringify(state.invoices.find(x => x.id === id)), d.id);

  // 4. a second "device": the public API with a fresh log-in
  const li = await api('POST', '/v1/auth/login', { body: { username: user, password, device: 'ci-runner' } });
  check(li.status === 200, 'log-in from a second device (the CI runner) works', li.text.slice(0, 200));
  const T = li.json && li.json.session;
  const pulled = T ? await api('GET', '/v1/sync/pull?since=0&limit=300', { token: T }) : { json: null };
  const recs = (pulled.json && pulled.json.records) || [];
  const inv = recs.find(r => r.kind === 'invoice' && r.id === d.id);
  check(!!inv && inv.data === sentText, `the invoice is stored in the cloud byte-for-byte (${recs.length} records for this account)`, inv ? 'stored text differs' : 'missing');
  check(recs.some(r => r.kind === 'company' && JSON.parse(r.data).name === 'Live Check Traders'), 'the company profile is stored in the cloud');
  if (T) await api('POST', '/v1/auth/logout', { token: T });

  // 5. a new phone: wipe the app's data, log in again, the invoice comes back
  await within(device.shell(`pm clear ${PKG}`), 60000, 'pm clear');
  page = await launch();
  check(await page.isVisible('#signin-screen'), 'after wiping the app, the sign-in screen is shown again');
  await signIn('login');
  await page.waitForFunction(n => state.invoices.some(x => x.num === n), invNum, { timeout: 60000 }).catch(() => null);
  const back = await page.evaluate(id => { const x = state.invoices.find(v => v.id === id); return x ? JSON.stringify(x) : null; }, d.id);
  check(back === sentText, `after logging in on a wiped app, invoice ${invNum} is back exactly as saved`);
  check(await page.evaluate(() => state.company.name === 'Live Check Traders'), 'company profile restored');
  await shot('04-restored');
} catch (e) {
  check(false, 'live test aborted: ' + String(e).split('\n')[0]);
  try { await shot('99-error'); } catch (e2) { /* no screen */ }
} finally {
  // 6. clean up: delete the throw-away account (removes its rows from the spreadsheet)
  if (accountMade) {
    const li = await api('POST', '/v1/auth/login', { body: { username: user, password, device: 'ci-cleanup' } });
    const del = li.json && li.json.session ? await api('DELETE', '/v1/account', { token: li.json.session, body: { password } }) : { status: li.status, text: li.text };
    check(del.status === 200, 'test account deleted from the live service', String(del.text).slice(0, 200));
    if (li.json && li.json.session) check((await api('GET', '/v1/me', { token: li.json.session })).status === 401, 'its session no longer works');
  }
  finish(fail ? 1 : 0);
}
function finish(code) { console.log(`\n${label}: ${pass} passed, ${fail} failed`); process.exit(code); }
