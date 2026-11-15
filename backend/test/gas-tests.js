'use strict';
/**
 * The Google Apps Script server (gas/dist/Code.js, built from the same modules as the Cloud Run server) in a local
 * simulation of Apps Script (test/gas-sim.js) on the Sheets API stand-in:
 *   - scripts/verify-deployment.js --gas, the complete live check, incl. --keep / --resume (both quote modes)
 *   - what is specific to Apps Script: PBKDF2 hashes, secrets in Script Properties, pages, features switched off,
 *     no nested script lock, nothing kept in memory between requests
 * Real Apps Script (quotas, speed, Google's redirects) is checked against the deployment with the same script.
 */
const path = require('path'), fs = require('fs'), os = require('os'), assert = require('assert');
const { execFile } = require('child_process');
const { FakeSheets } = require('./fake-sheets');
const { GasSim } = require('./gas-sim');

const ROOT = path.join(__dirname, '..', '..');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'verify-deployment.js');
const run = a => new Promise(r => execFile('node', [SCRIPT, ...a], { encoding: 'utf8' }, (e, out, err) => r({ code: e ? e.code : 0, out: out + err })));
const sum = out => (/(\d+) passed, (\d+) failed/.exec(out) || []).slice(1).map(Number);
let pass = 0, fail = 0;
async function test(name, fn) { try { await fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + String(e.stack || e).split('\n').slice(0, 6).join('\n      ')); } }

(async () => {
  const { build } = await import(path.join(ROOT, 'tools', 'build-gas.mjs'));
  const b = build();
  console.log(`▶ Apps Script bundle ${Math.round(b.bytes / 1024)} KB`);
  for (const mode of ['literal', 'prefix']) {
    const fake = new FakeSheets(); fake.quoteMode = mode;
    const id = fake.create('HGI Billing data');
    const sim = new GasSim({ fake, spreadsheetId: id, props: { PBKDF2_ITER: '20000' } });
    const srv = await sim.listen();
    const tab = name => fake.dump(id, name);
    console.log(`▶ quote mode ${mode} · ${sim.url}`);

    await test('first request creates the secrets, the tabs and the columns; health says google-sheets / apps-script', async () => {
      const h = sim.post({ m: 'GET', p: '/v1/health' });
      assert.strictEqual(h.status, 200, JSON.stringify(h)); assert.strictEqual(h.body.storage, 'google-sheets'); assert.strictEqual(h.body.runtime, 'apps-script');
      assert.strictEqual(h.body.quoteMode, mode);
      assert.ok(sim.props.SESSION_SECRET.length >= 60 && sim.props.PASSWORD_PEPPER.length >= 60 && sim.props.SESSION_SECRET !== sim.props.PASSWORD_PEPPER);
      assert.strictEqual(sim.props.SHEETS_SPREADSHEET_ID, id);
      for (const t of ['Users', 'Sessions', 'Settings', 'Customers', 'Products', 'Invoices', 'InvoiceItems', 'Payments', 'DocNumbers', 'Store', '_Meta', '_Blobs']) assert.ok(tab(t)[0] && tab(t)[0].length, 'tab ' + t);
      assert.ok(!sim.logs.join('\n').includes(sim.props.PASSWORD_PEPPER) && !sim.logs.join('\n').includes(sim.props.SESSION_SECRET), 'secrets never logged');
    });
    await test('scripts/verify-deployment.js --gas: the complete live check passes', async () => {
      const r = await run([sim.url, '--gas']);
      const [p, f] = sum(r.out); assert.ok(r.code === 0 && f === 0 && p >= 30, r.out.split('\n').filter(l => /FAIL|ERROR|passed/.test(l)).join('\n') || r.out.slice(-800));
    });
    await test('keep → resume: a kept account logs in and reads its data byte-for-byte in later executions', async () => {
      const st = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hgi-gas-')), 's.json');
      const k = await run([sim.url, '--gas', '--keep', st]); assert.strictEqual(k.code, 0, k.out.slice(-600));
      const users = tab('Users'), h = users[0], kept = users.slice(1).find(r => r[h.indexOf('status')] === 'active');
      assert.match(String(kept[h.indexOf('passwordHash')]), /^pbkdf2\$1\$i=20000\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}$/, 'PBKDF2 hash in the Users tab');
      const pw = JSON.parse(fs.readFileSync(st, 'utf8')).pw;
      assert.ok(!JSON.stringify(fake.books.get(id)).includes(pw), 'the password text appears nowhere in the spreadsheet');
      const r = await run([sim.url, '--gas', '--resume', st]); const [p, f] = sum(r.out);
      assert.ok(r.code === 0 && f === 0 && p >= 9, r.out.slice(-800)); assert.ok(!fs.existsSync(st));
    });
    await test('the Cloud Run server and the Apps Script server read each other\'s data (same spreadsheet layout)', async () => {
      // a record written through Apps Script, read back by the Node storage engine on the same spreadsheet
      const su = sim.post({ m: 'POST', p: '/v1/auth/signup', b: { username: 'cross.check', password: 'Cross-Pass-9182', device: 't' } });
      assert.strictEqual(su.status, 201, JSON.stringify(su));
      const doc = { id: 'X1', docType: 'INV', num: 'X/1', date: '2026-11-15', items: [{ desc: '=SUM(A1)', qty: 2, rate: 10, gst: 18 }], grandTotal: 23.6 };
      const p = sim.post({ m: 'POST', p: '/v1/sync/push', t: su.body.session, b: { device: 't', records: [{ kind: 'invoice', id: 'X1', baseRev: 0, data: JSON.stringify(doc) }] } });
      assert.strictEqual(p.body.results[0].status, 'ok', JSON.stringify(p));
      const { SheetDB } = require('../lib/sheet-db'); const { TABLES } = require('../lib/sheets-schema'); const { SheetsRecordStore } = require('../lib/sheets-record-store'); const { SheetsDocStore } = require('../lib/sheets-doc-store');
      const client = { meta: async () => fake.run(id, '', { method: 'GET' }, new URL('https://x/'), null), batchGet: async ranges => { const u = new URL('https://x/?valueRenderOption=UNFORMATTED_VALUE'); ranges.forEach(r => u.searchParams.append('ranges', r)); return fake.run(id, '/values:batchGet', { method: 'GET' }, u, null).valueRanges.map(v => v.values || []); },
        getValue: async r => { const v = fake.run(id, '/values/' + r, { method: 'GET' }, new URL('https://x/'), null).values; return v && v[0] ? v[0][0] : undefined; }, batchUpdate: async reqs => fake.run(id, ':batchUpdate', { method: 'POST' }, new URL('https://x/'), { requests: reqs }) };
      const db = new SheetDB({ client, tables: TABLES }); db.quoteMode = sim.props.QUOTE_MODE; await db.load();
      const store = new SheetsRecordStore(db, new SheetsDocStore(db));
      const r = await store.pull(su.body.user.key, 0, 50);
      assert.strictEqual(r.records.find(x => x.id === 'X1').data, JSON.stringify(doc));
      sim.post({ m: 'DELETE', p: '/v1/account', t: su.body.session, b: { password: 'Cross-Pass-9182' } });
    });
    await test('features switched off on Apps Script: e-invoice 503 EDOC_NOT_CONFIGURED (nothing sent), PDF copies and GST look-up off', async () => {
      const su = sim.post({ m: 'POST', p: '/v1/auth/signup', b: { username: 'feat.check', password: 'Feat-Pass-77123', device: 't' } });
      const T = su.body.session;
      const me = sim.post({ m: 'GET', p: '/v1/me', t: T });
      assert.deepStrictEqual(me.body.features, { gst: false, files: false, edoc: { irp: false, ewb: false, env: null } });
      const g = sim.post({ m: 'POST', p: '/v1/edoc/generate', t: T, b: { doc: {}, company: {}, mode: 'irn' } });
      assert.strictEqual(g.status, 503); assert.strictEqual(g.body.error, 'EDOC_NOT_CONFIGURED');
      assert.strictEqual(sim.post({ m: 'PUT', p: '/v1/files/pdf/D1', t: T, b: { base64: 'x' } }).status, 503);
      assert.strictEqual(sim.post({ m: 'GET', p: '/v1/gstin/24AAACH7409R1Z7', t: T }).status, 503);
      assert.strictEqual(sim.post({ m: 'GET', p: '/v1/me' }).status, 401, 'no token → not signed in');
      assert.strictEqual(sim.post({ m: 'GET', p: '/v1/me', t: 'hgi1.' + 'A'.repeat(43) }).status, 401, 'made-up token');
      sim.post({ m: 'DELETE', p: '/v1/account', t: T, b: { password: 'Feat-Pass-77123' } });
    });
    await test('pages: privacy and delete-account served by doGet, links point back to the web app; bad envelope → 400', async () => {
      const pr = sim.get({ p: '/privacy' }); assert.match(pr.html, /Privacy Policy/);
      const del = sim.get({ p: '/delete-account' }); assert.match(del.html, /Delete/); assert.ok(del.html.includes(sim.url + '?p=/privacy'), 'link rewritten');
      assert.ok(del.html.includes(`const API = ${JSON.stringify(sim.url)}`) || del.html.includes(sim.url), 'page knows the web app address');
      assert.strictEqual(sim.post('not json').status, 400);
      assert.strictEqual(sim.post({ m: 'GET', p: '/nothing' }).status, 404);
    });
    await test('each request is a fresh execution (nothing kept in memory) and no execution ends holding the lock', async () => {
      assert.ok(sim.executions > 50, `${sim.executions} executions`); assert.strictEqual(sim.locked, false);
    });
    srv.close();
  }
  console.log(`\nApps Script (simulated): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
