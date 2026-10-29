#!/usr/bin/env node
'use strict';
/**
 * Only for DRIVE_AUTH=owner-oauth (company Drive is a normal Gmail account, no Shared Drive).
 * Run ON YOUR OWN PC, signed in to the HGI company Google account in your browser:
 *
 *   node scripts/owner-token.js <OAuth "Desktop app" client ID> <client secret>
 *
 * It opens Google's consent page, receives the answer on http://127.0.0.1, and prints a refresh token.
 * Store that token in Secret Manager as OWNER_REFRESH_TOKEN — never in the app, never in git.
 */
const http = require('http');
const crypto = require('crypto');
const [clientId, clientSecret] = process.argv.slice(2);
if (!clientId || !clientSecret) { console.error('usage: node scripts/owner-token.js <client-id> <client-secret>'); process.exit(1); }
const verifier = crypto.randomBytes(32).toString('base64url');
const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
const state = crypto.randomBytes(12).toString('hex');
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname !== '/cb') { res.writeHead(404); return res.end(); }
  if (u.searchParams.get('state') !== state) { res.writeHead(400); return res.end('state mismatch'); }
  const code = u.searchParams.get('code');
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ code, client_id: clientId, client_secret: clientSecret, redirect_uri: redirect, grant_type: 'authorization_code', code_verifier: verifier }) });
  const j = await r.json();
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  if (!j.refresh_token) { res.end('No refresh token received — see the terminal.'); console.error('Google answered:', j); process.exit(1); }
  res.end('Done. You can close this tab and go back to the terminal.');
  console.log('\nOWNER_REFRESH_TOKEN (store in Secret Manager, then clear your terminal):\n\n' + j.refresh_token + '\n');
  console.log('Important: in Google Cloud → OAuth consent screen, set "Publishing status" to "In production".');
  console.log('While the app is in "Testing", Google expires this refresh token after 7 days and sync stops.');
  server.close();
});
let redirect;
server.listen(0, '127.0.0.1', () => {
  redirect = `http://127.0.0.1:${server.address().port}/cb`;
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: clientId, redirect_uri: redirect, response_type: 'code',
    scope: 'https://www.googleapis.com/auth/drive', access_type: 'offline', prompt: 'consent', state, code_challenge: challenge, code_challenge_method: 'S256' });
  console.log('Open this link in the browser where the HGI company Google account is signed in:\n\n' + url + '\n');
});
