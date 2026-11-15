'use strict';
/**
 * One server at a time on one spreadsheet. The Cloud Run server and the Google Apps Script server can both work on the
 * same spreadsheet, but only ONE may serve the app at any moment: otherwise an old APK (Cloud Run address) and a new APK
 * (Apps Script address) would write through different servers, whose write queues do not see each other.
 *
 *   _Meta row  key = activeBackend,  value = 'cloud-run' | 'apps-script'   (empty / missing = no restriction, as before)
 *
 * The server whose name is not the active one answers every /v1 request with 410 backend_retired ("install the update"),
 * and refuses every write inside the write transaction itself (after it re-checked that its copy is current), so a request
 * that started just before the switch cannot slip through. The switch is a normal write (it moves _Meta.writeCounter),
 * so the other server notices it at its next write even before its next reload.
 */
const KEY = 'activeBackend';
const NAMES = ['cloud-run', 'apps-script'];

function activeOf(db) { const m = db.t('_Meta').get({ key: KEY }); return m && m.value ? String(m.value) : ''; }
function retiredError(name, active) {
  const e = new Error('This version of HGI Billing uses a server that has been switched off. Please install the latest HGI Billing update — your data is safe on this phone and in your account.');
  e.status = 410; e.code = 'backend_retired'; e.backend = name; e.active = active;
  return e;
}
/** for SheetDB({ writeGuard }) */
function writeGuard(name) { return db => { const a = activeOf(db); return a && a !== name ? retiredError(name, a) : null; }; }
/** for requests: throws backend_retired when another server is the active one */
function checkActive(db, name) { const a = activeOf(db); if (a && a !== name) throw retiredError(name, a); }
/** makes `name` the active server (allowed from either server; it is the switch itself) */
async function activate(db, name, by) {
  if (!NAMES.includes(name)) throw new Error('unknown backend ' + name);
  await db.tx(async w => { w.put('_Meta', { key: KEY, value: name, note: `set ${new Date().toISOString()} by ${String(by || '').slice(0, 60)}` }); }, { bypassGuard: true });
  return { active: name };
}

module.exports = { KEY, NAMES, activeOf, retiredError, writeGuard, checkActive, activate };
