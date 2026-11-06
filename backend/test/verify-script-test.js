'use strict';
/**
 * Runs scripts/verify-deployment.js against the local server + the Sheets stand-in (test/fake-sheets.js), in both of
 * Google's apostrophe modes, including the two-phase restart check (a second server process-equivalent re-reads the
 * same spreadsheet). This only proves the SCRIPT works; it is not a substitute for running it against the real service.
 */
const path = require('path'), fs = require('fs'), os = require('os'), crypto = require('crypto'), assert = require('assert');
const { execFile } = require('child_process');
const { FakeGoogle } = require('./fake-google');
const { createServer } = require('../server');
const config = require('../lib/config');
const SCRIPT = path.join(__dirname, '..', 'scripts', 'verify-deployment.js');
const run = (a) => new Promise(r => execFile('node', [SCRIPT, ...a], { encoding: 'utf8' }, (e, out, err) => r({ code: e ? e.code : 0, out: out + err })));
const sum = (out) => (/(\d+) passed, (\d+) failed/.exec(out) || []).slice(1).map(Number);

(async () => {
  for (const mode of ['literal', 'prefix']) {
    const g = await new FakeGoogle().start(); g.sheets.quoteMode = mode; const id = g.sheets.create();
    const env = { SHEETS_SPREADSHEET_ID: id, SESSION_SECRET: crypto.randomBytes(32).toString('hex'), PASSWORD_PEPPER: crypto.randomBytes(32).toString('hex'), SIGNUP_PER_MINUTE: '1000', LOGIN_PER_MINUTE: '1000' };
    const start = async () => { const c = config.load(env); c.endpoints = g.endpoints(); const s = createServer(c, { log: () => {} }); await new Promise(r => s.listen(0, '127.0.0.1', r)); return s; };
    let s = await start(); const url = `http://127.0.0.1:${s.address().port}`;
    const one = await run([url]);
    assert.strictEqual(one.code, 0, one.out); const [p1, f1] = sum(one.out); assert.ok(p1 >= 25 && f1 === 0, one.out);
    console.log(`ok  ${mode}: single run ${p1} passed`);

    const state = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'hgi-verify-')), 'state.json');
    const k = await run([url, '--keep', state]); assert.strictEqual(k.code, 0, k.out);
    assert.strictEqual(fs.statSync(state).mode & 0o077, 0, 'state file must be private');
    assert.ok(!k.out.includes(JSON.parse(fs.readFileSync(state, 'utf8')).pw), 'the test password is never printed');
    const noRestart = await run([url, '--resume', state]);                // same instance → must FAIL the restart check
    assert.notStrictEqual(noRestart.code, 0); assert.match(noRestart.out, /FAIL {2}a NEW instance/);
    // the failed resume deleted the account and the file; run phase 1 again, then restart for real
    const k2 = await run([url, '--keep', state]); assert.strictEqual(k2.code, 0, k2.out);
    await new Promise(r => s.close(r)); await new Promise(r => setTimeout(r, 1100));
    s = await start(); const url2 = `http://127.0.0.1:${s.address().port}`;
    const st = JSON.parse(fs.readFileSync(state, 'utf8')); st.base = url2; fs.writeFileSync(state, JSON.stringify(st), { mode: 0o600 });
    const r = await run([url2, '--resume', state]);
    assert.strictEqual(r.code, 0, r.out); const [p2, f2] = sum(r.out); assert.ok(p2 >= 9 && f2 === 0, r.out);
    assert.ok(!fs.existsSync(state), 'resume removes the state file');
    console.log(`ok  ${mode}: restart check ${p2} passed (new server re-read the spreadsheet)`);
    await new Promise(r2 => s.close(r2)); await g.stop();
  }
  console.log('verify-script: all passed');
})().catch(e => { console.error(e); process.exit(1); });
