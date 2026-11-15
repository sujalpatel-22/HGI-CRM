#!/usr/bin/env node
'use strict';
/**
 * Copies the two secrets from Google Secret Manager into the Apps Script server's Script Properties, so the Cloud Run and
 * Apps Script servers accept the same passwords and sessions. The values go straight from `gcloud` to the web app over
 * HTTPS; they are never printed or written to disk.
 *
 *   1. Apps Script editor → run hgiArmSecretImport → copy the one-time code from the execution log (valid 15 minutes)
 *   2. Cloud Shell:  node backend/scripts/import-secrets-to-gas.js <web app URL> <code> [session secret name] [pepper name]
 *                    (defaults: hgi-session-secret, hgi-password-pepper; for tests e.g. hgi-test-session-secret …)
 * The script refuses when the Apps Script server already has active accounts (their passwords would stop working).
 */
const { execFileSync } = require('child_process');
const [url, code, sName = 'hgi-session-secret', pName = 'hgi-password-pepper'] = process.argv.slice(2);
if (!/^https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec$/.test(url || '') || !code) {
  console.error('usage: node backend/scripts/import-secrets-to-gas.js https://script.google.com/macros/s/<id>/exec <one-time code> [session-secret-name] [pepper-name]');
  process.exit(2);
}
const secret = name => execFileSync('gcloud', ['secrets', 'versions', 'access', 'latest', '--secret', name], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] });
(async () => {
  const body = JSON.stringify({ m: 'POST', p: '/v1/admin/import-secrets', b: { code, sessionSecret: secret(sName), passwordPepper: secret(pName) } });
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body, redirect: 'follow' });
  const j = await r.json().catch(() => null);
  if (!j || j.status !== 200) { console.error('NOT imported:', j ? `${j.status} ${j.body && j.body.message}` : `HTTP ${r.status}`); process.exit(1); }
  console.log(`Imported ${sName} and ${pName} into the Apps Script server (values not shown).`);
})().catch(e => { console.error('NOT imported:', e.message); process.exit(1); });
