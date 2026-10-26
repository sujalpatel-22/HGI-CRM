import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Exercise the shipped share handler with both native bridge outcomes.
const source = fs.readFileSync(new URL('../src/mobile.js', import.meta.url), 'utf8');
const start = source.indexOf('  async function shareBackup()');
const end = source.indexOf('  /*', start);
assert(start >= 0 && end > start);
for (const fail of [true, false]) {
  const state = { ui: { lastBackup: 'previous' } };
  let saved = 0, refreshed = 0;
  const messages = [];
  const context = vm.createContext({
    state, isNative: true, DEMO_MODE: false,
    closeMore() {}, todayISO: () => '2026-10-26',
    Native: { async shareFile(file) {
      assert.equal(file.mime, 'application/json');
      assert.deepEqual(JSON.parse(Buffer.from(file.base64, 'base64').toString()), state);
      if (fail) throw new Error('Share unavailable');
    } },
    btoa: s => Buffer.from(s, 'binary').toString('base64'),
    unescape, encodeURIComponent,
    saveState() { saved++; }, updateBackupLabel() { refreshed++; }, renderAlerts() {},
    toast(message) { messages.push(message); }
  });
  const share = vm.runInContext(source.slice(start, end) + '\nshareBackup;', context);
  await share();
  assert.equal(saved, fail ? 0 : 1);
  assert.equal(refreshed, fail ? 0 : 1);
  assert.equal(state.ui.lastBackup === 'previous', fail);
  assert.equal(messages.length, fail ? 1 : 0);
}
console.log('2 native backup bridge checks passed (mocked bridge; no emulator).');
