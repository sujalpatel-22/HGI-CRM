/* =====================================================================
   HGI Billing — account (Sign in with Google) + automatic cloud sync
   Loaded BEFORE the core app script: it decides whose data slot is opened.

   - Every signed-in Google account has its own data slot on the phone
     (localStorage "hgi_billing_u_<key>" + app-file mirror "state-u-<key>"),
     so two people using one phone never see each other's data.
   - Each account's data is synced to the HGI sync service, which keeps it in
     the account's own spreadsheet in the HGI company Drive. The app holds no
     Google API key — only the public service URL and OAuth client ID.
   - Data saved by versions before 8.1 (no account) is offered to the first
     account that signs in on the phone, so nothing is lost on upgrade.
   ===================================================================== */
(function () {
  'use strict';
  const ACCOUNT_KEY = 'hgi_account';
  const LEGACY_KEY = 'hgi_billing_v7_prod';
  const LEGACY_OWNER = 'hgi_legacy_owner';
  const ls = {
    get(k) { try { return localStorage.getItem(k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } },
    del(k) { try { localStorage.removeItem(k); } catch (e) { /* ignore */ } }
  };
  let account = null;
  try { account = JSON.parse(ls.get(ACCOUNT_KEY) || 'null'); } catch (e) { account = null; }
  if (!account || !/^[a-f0-9]{24}$/.test(String(account.key || ''))) account = null;
  // read by the core app (STORAGE_KEY) and the Android shell (mirror file name)
  window.HGI_ACCOUNT = account ? { key: account.key, email: account.email } : null;
  const slotKey = key => 'hgi_billing_u_' + key;
  const mirrorKey = key => 'state-u-' + key;
  const syncKey = key => 'hgi_sync_u_' + key;

  /* ------------------------------------------------------------------ environment */
  const cap = window.Capacitor;
  const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  const Native = () => isNative ? ((cap.Plugins && cap.Plugins.HgiNative) || null) : null;
  const AppPlugin = () => isNative && cap.Plugins ? cap.Plugins.App : null;
  const t = s => (window.HGI_I18N ? window.HGI_I18N.t(s) : s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const timeout = (p, ms, v = null) => Promise.race([p, new Promise(res => setTimeout(() => res(v), ms))]);
  // Bridge calls can go unanswered on a slow cold start or right after an in-app reload (seen on Android 11/13/15
  // emulators): wait generously and retry instead of acting on a missing answer.
  const LOST = { lost: true };
  async function bridge(call, tries = 3, ms = 5000) {
    for (let i = 0; i < tries; i++) {
      try { const r = await timeout(call(), ms, LOST); if (r !== LOST) return r; } catch (e) { return { error: e }; }
      console.warn('[HGI] native call not answered — retrying');
    }
    return LOST;
  }
  const nativeWrite = async (key, data) => { const N = Native(); if (!N) return; await bridge(() => N.writeState({ key, data }), 2, 5000); };
  const nativeRead = async key => { const N = Native(); if (!N) return null; const r = await bridge(() => N.readState({ key })); return r && r !== LOST && !r.error && r.data ? r.data : null; };
  const device = () => { const m = /Android [\d.]+; ([^;)]+)/.exec(navigator.userAgent || ''); return (m ? m[1].replace(/ Build.*/, '') : (isNative ? 'Android' : 'Browser')).slice(0, 60); };

  let config = { auth: 'off' };
  async function loadConfig() {
    let c = window.HGI_CONFIG || {};
    const N = Native();
    if (isNative) {
      // the Android build's own settings decide — never fall back to the web default ("off") when the answer is missing
      const r = N && typeof N.getConfig === 'function' ? await bridge(() => N.getConfig(), 4, 5000) : LOST;
      c = r && r !== LOST && !r.error && r.auth ? r : { auth: 'unavailable' };
      // automated tests of the debug APK may switch to the no-sign-in mode; ignored by release builds (debug === false)
      if (c.debug === true) { try { const o = localStorage.getItem('hgi_test_auth'); if (o === 'off') c = Object.assign({}, c, { auth: 'off' }); } catch (e) { /* ignore */ } }
    }
    config = { auth: c.auth || 'off', syncUrl: String(c.syncUrl || '').replace(/\/$/, ''), webClientId: c.webClientId || '' };
    if (config.auth !== 'off' && config.auth !== 'unavailable' && !config.syncUrl) config.auth = 'misconfigured';
    if (config.auth === 'google' && !config.webClientId) config.auth = 'misconfigured';
    return config;
  }

  /* ------------------------------------------------------------------ talking to the sync service */
  class ApiErr extends Error { constructor(m, status, code, body) { super(m); this.status = status; this.code = code; this.body = body; } }
  async function api(method, path, body, session) {
    let r;
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const timer = setTimeout(() => ctrl && ctrl.abort(), 60000);
    try {
      r = await fetch(config.syncUrl + path, { method, signal: ctrl ? ctrl.signal : undefined, headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(session ? { Authorization: 'Bearer ' + session } : {}) }, body: body !== undefined ? JSON.stringify(body) : undefined });
    } catch (e) { throw new ApiErr(t('No internet connection'), 0, 'offline'); }
    finally { clearTimeout(timer); }
    let j = {}; try { j = await r.json(); } catch (e) { /* empty */ }
    const renewed = r.headers.get('X-HGI-Session');
    if (renewed && account) { account.session = renewed; saveAccount(account); }
    if (!r.ok) throw new ApiErr(j.message || ('HTTP ' + r.status), r.status, j.error || 'error', j);
    return j;
  }
  function saveAccount(a) {
    ls.set(ACCOUNT_KEY, JSON.stringify(a));
    nativeWrite('account', JSON.stringify(a));
  }

  /* ------------------------------------------------------------------ data helpers */
  // content fingerprint: what decides whether there is anything new to upload (not the save counter or timestamps)
  const VOLATILE = ['rev', 'savedAt', 'lastBackup', 'restoredAt'];
  function contentOf(obj) {
    const ui = Object.assign({}, obj.ui || {}); VOLATILE.forEach(k => delete ui[k]);
    return JSON.stringify(Object.assign({}, obj, { ui }));
  }
  async function fingerprint(text) {
    if (window.crypto && crypto.subtle && window.TextEncoder) {
      const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2, '0')).join('');
    }
    let h1 = 0x811c9dc5, h2 = 0; for (let i = 0; i < text.length; i++) { h1 = Math.imul(h1 ^ text.charCodeAt(i), 16777619); h2 = (h2 * 31 + text.charCodeAt(i)) | 0; }
    return 'f' + (h1 >>> 0).toString(16) + (h2 >>> 0).toString(16) + text.length;
  }
  const meaningful = s => !!s && ((Array.isArray(s.invoices) && s.invoices.length) || (Array.isArray(s.customers) && s.customers.length) || (Array.isArray(s.products) && s.products.length) || (s.company && s.company.name));
  const parse = txt => { try { const o = JSON.parse(txt); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } };
  const count = (n, one, many) => `${n} ${t(n === 1 ? one : many)}`;
  const summary = s => `${count((s.invoices || []).length, 'document', 'documents')}, ${count((s.customers || []).length, 'buyer', 'buyers')}${s.company && s.company.name ? ' — ' + s.company.name : ''}`;
  const revOf = s => Number(s && s.ui && s.ui.rev) || 0;

  function readSync(key) { try { return JSON.parse(ls.get(syncKey(key)) || 'null') || { version: 0, hash: '' }; } catch (e) { return { version: 0, hash: '' }; } }
  function writeSync(key, s) { ls.set(syncKey(key), JSON.stringify(s)); nativeWrite('sync-u-' + key, JSON.stringify(s)); }

  /* ------------------------------------------------------------------ small dialogs (no browser confirm(): it blocks the WebView) */
  function dialog({ title, body, buttons, danger }) {
    return new Promise(resolve => {
      const el = document.createElement('div');
      el.className = 'acct-dlg no-print'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
      el.innerHTML = `<div class="acct-dlg-card"><h3>${esc(title)}</h3><div class="acct-dlg-body">${body}</div><div class="acct-dlg-actions">${buttons.map((b, i) =>
        `<button type="button" data-i="${i}" class="${b.primary ? 'acct-btn-primary' : b.danger ? 'acct-btn-danger' : 'acct-btn'}">${esc(b.label)}</button>`).join('')}</div></div>`;
      el.addEventListener('click', e => { const b = e.target.closest('button[data-i]'); if (!b) return; const v = buttons[Number(b.dataset.i)].value; const inp = el.querySelector('input[type=text]'); const chk = el.querySelector('input[type=checkbox]');
        dialog.last = { text: inp ? inp.value : '', checked: !!(chk && chk.checked) }; el.remove(); resolve(v); });
      document.body.appendChild(el);
      const first = el.querySelector('input, .acct-btn-primary'); if (first) first.focus();
    });
  }

  window.HGI_DIALOG = dialog;   // shared with the Android shell (logout, bulk export)

  /* ------------------------------------------------------------------ sign-in screen */
  const G_LOGO = '<svg viewBox="0 0 48 48" width="20" height="20" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59A14.5 14.5 0 0 1 9.5 24c0-1.59.28-3.14.76-4.59l-7.98-6.19A23.99 23.99 0 0 0 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';
  function signInScreen(note) {
    let el = document.getElementById('signin-screen');
    if (!el) { el = document.createElement('div'); el.id = 'signin-screen'; el.className = 'brand-bg no-print'; document.body.appendChild(el); }
    const lo = document.getElementById('login-overlay'); if (lo) lo.classList.add('hidden');
    const test = config.auth === 'test';
    el.innerHTML = `<div class="si-card">
      <img src="${esc((document.getElementById('login-logo') || {}).src || '')}" alt="" class="si-logo">
      <h1>HGI Billing</h1>
      <p class="si-sub">${esc(t('Sign in to open your business data. It is saved on this phone and synced automatically to your HGI cloud account, so a reinstall or a new phone brings everything back.'))}</p>
      ${config.auth === 'unavailable' ? `<button type="button" id="si-retry" class="si-google">${esc(t('Try again'))}</button>` : config.auth === 'misconfigured' ? `<p class="si-err">${esc(t('This build is not set up for sign-in (sync service address or Google client ID missing). Please install the official app from Google Play.'))}</p>` : test
        ? `<p class="si-test">TEST BUILD — test accounts only</p><input id="si-email" type="email" class="inp" placeholder="name@example.com" value="qa@example.com" autocomplete="off"><button type="button" id="si-go" class="si-google">${esc(t('Test sign-in'))}</button>`
        : `<button type="button" id="si-go" class="si-google">${G_LOGO}<span>${esc(t('Continue with Google'))}</span></button>`}
      <p id="si-msg" class="si-msg" role="status">${note ? esc(note) : ''}</p>
      <p class="si-foot">${esc(t('Your data is visible only to you and authorised HGI support staff.'))} ${config.syncUrl ? `<a href="#" id="si-privacy">${esc(t('Privacy policy'))}</a>` : ''}</p>
    </div>`;
    const go = el.querySelector('#si-go'); if (go) go.onclick = () => signInFlow(go);
    const rt = el.querySelector('#si-retry'); if (rt) rt.onclick = () => { try { sessionStorage.removeItem('hgi_cfg_retry'); } catch (e) { /* ignore */ } location.reload(); };
    const pp = el.querySelector('#si-privacy'); if (pp) pp.onclick = e => { e.preventDefault(); openUrl(config.syncUrl + '/privacy'); };
    if (window.HGI_I18N && window.HGI_I18N.translateTree) window.HGI_I18N.translateTree(el);
  }
  function openUrl(u) { const N = Native(); if (N && N.openUrl) N.openUrl({ url: u }).catch(() => {}); else window.open(u, '_blank', 'noopener'); }
  const msg = (s, err) => { const m = document.getElementById('si-msg'); if (m) { m.textContent = s || ''; m.classList.toggle('err', !!err); } };

  // → { session, expiresAt, user:{key,email,name} }
  async function obtainSession() {
    if (config.auth === 'test') {
      const email = ((document.getElementById('si-email') || {}).value || '').trim();
      return api('POST', '/v1/auth/test', { email });
    }
    const N = Native();
    if (!N || typeof N.googleSignIn !== 'function') throw new ApiErr(t('Google sign-in is available in the Android app.'), 0, 'unsupported');
    let r;
    try { r = await N.googleSignIn({ serverClientId: config.webClientId }); }
    catch (e) {
      const code = (e && (e.code || e.message)) || '';
      if (/cancel/i.test(code)) throw new ApiErr('', 0, 'cancelled');
      if (/no_account|NoCredential/i.test(code)) throw new ApiErr(t('No Google account on this phone. Add one in Android Settings → Accounts, then try again.'), 0, 'no_account');
      throw new ApiErr(t('Google sign-in failed') + ': ' + (e.message || e), 0, 'google_failed');
    }
    return api('POST', '/v1/auth/google', { idToken: r.idToken });
  }

  let busy = false;
  async function signInFlow(btn) {
    if (busy) return; busy = true;
    if (btn) btn.disabled = true;
    msg(t('Signing in…'));
    try {
      const s = await obtainSession();
      msg(t('Checking your cloud data…'));
      await openAccount(s);           // reloads the app on success
    } catch (e) {
      busy = false; if (btn) btn.disabled = false;
      msg(e.code === 'cancelled' ? '' : e.code === 'offline'
        ? (config.auth === 'test' ? t('This TEST build signs in only to the automatic test server, which is not reachable from a normal phone. Install the INTERNAL-TESTKEY APK instead.')
          : t('No internet connection. You need internet to sign in the first time on this phone.'))
        : e.message, e.code !== 'cancelled');
    }
  }

  // After a successful sign-in: decide which data this account opens with, then reload into the account's slot.
  async function openAccount(s) {
    const key = s.user.key;
    const reauth = account && account.key;
    if (reauth && reauth !== key) throw new ApiErr(t('This app is signed in with another account. Sign out first.'), 0, 'other_account');
    const next = { key, email: s.user.email, name: s.user.name || '', session: s.session, expiresAt: s.expiresAt };
    if (reauth) { account = next; saveAccount(next); setStatus('idle'); hideSignIn(); kick(0); return; }   // session renewed, same account

    let local = ls.get(slotKey(key));
    if (!local) { const m = await nativeRead(mirrorKey(key)); if (m) { local = m; ls.set(slotKey(key), m); } }
    const cloud = await api('GET', '/v1/sync', undefined, s.session);
    const cloudState = cloud.data ? parse(cloud.data) : null;
    const cv = Number(cloud.cloud && cloud.cloud.version) || 0;

    if (local) {
      // this account has used this phone before: keep the phone copy; the sync engine reconciles after the reload
      const sync = readSync(key);
      if (!sync.version && cv) writeSync(key, { version: 0, hash: '' });
    } else {
      // data from before accounts existed (v8.0 and older), not yet claimed by any account on this phone
      let legacy = null;
      if (!ls.get(LEGACY_OWNER)) {
        let lt = ls.get(LEGACY_KEY); const mt = await nativeRead('state');
        if (mt && (!lt || revOf(parse(mt)) > revOf(parse(lt)))) lt = mt;
        const lo = lt ? parse(lt) : null;
        if (meaningful(lo)) legacy = { text: lt, obj: lo };
      }
      let use = null, safety = null, pushNeeded = false;
      if (cloudState && legacy) {
        const pick = await dialog({ title: t('Which data should this account use?'),
          body: `<p>${esc(t('This phone has business data from before sign-in, and your account already has a cloud copy.'))}</p>
            <ul><li><strong>${esc(t('Cloud copy'))}:</strong> ${esc(summary(cloudState))}${cloud.cloud.updatedAt ? ' · ' + esc(new Date(cloud.cloud.updatedAt).toLocaleString('en-IN')) : ''}</li>
            <li><strong>${esc(t('On this phone'))}:</strong> ${esc(summary(legacy.obj))}</li></ul>
            <p class="acct-note">${esc(t('The other copy is kept on this phone as a safety copy (Settings → Undo restore).'))}</p>`,
          buttons: [{ label: t('Use data on this phone'), value: 'phone' }, { label: t('Use cloud copy'), value: 'cloud', primary: true }] });
        if (pick === 'phone') { use = legacy.text; safety = cloud.data; pushNeeded = true; } else { use = cloud.data; safety = legacy.text; }
      } else if (cloudState) use = cloud.data;
      else if (legacy) { use = legacy.text; pushNeeded = true; }
      if (legacy) ls.set(LEGACY_OWNER, key);                 // the pre-sign-in data now belongs to this account only
      if (use) {
        const o = parse(use); o.ui = Object.assign({}, o.ui || {}, { onboarded: true });
        if (safety) o.ui.restoredAt = new Date().toISOString();
        use = JSON.stringify(o);
        ls.set(slotKey(key), use);                         // if WebView storage is full, the app-file copy below is loaded at start
        await nativeWrite(mirrorKey(key), use);
        if (safety) { ls.set(slotKey(key) + '_before_restore', safety); await nativeWrite('u-' + key + '-before-restore', safety); }
      }
      // the pre-sign-in data now lives in this account (as its data or its safety copy); the app-file copy stays as an upgrade safety copy
      if (legacy && use) ls.del(LEGACY_KEY);
      const fp = use && !pushNeeded ? await fingerprint(contentOf(parse(use))) : '';
      writeSync(key, { version: cv, hash: fp, at: cloudState && !pushNeeded ? Date.now() : 0 });
    }
    account = next;
    saveAccount(next);
    location.reload();
  }
  function hideSignIn() { const el = document.getElementById('signin-screen'); if (el) el.remove(); }

  /* ------------------------------------------------------------------ gate (called by the Android shell before the app starts) */
  async function gate() {
    await loadConfig();
    if (config.auth === 'off') return true;                       // web versions without cloud sync: unchanged behaviour
    if (config.auth === 'unavailable') {
      // the app shell did not answer: start again (twice), then offer a retry button — the data stays closed meanwhile
      let n = 0; try { n = Number(sessionStorage.getItem('hgi_cfg_retry') || 0); sessionStorage.setItem('hgi_cfg_retry', String(n + 1)); } catch (e) { /* ignore */ }
      if (n < 2) { location.reload(); return false; }
      document.documentElement.classList.add('signed-out');
      signInScreen(t('The app could not start properly. Please try again.'));
      window.HGI_READY = true; window.HGI_SIGNIN_READY = true; document.documentElement.classList.add('booted');
      return false;
    }
    try { sessionStorage.removeItem('hgi_cfg_retry'); } catch (e) { /* ignore */ }
    if (account && account.session) return true;
    // WebView storage was cleared but the app files survived: pick the account up again
    const saved = parse(await nativeRead('account'));
    if (saved && /^[a-f0-9]{24}$/.test(String(saved.key || '')) && saved.session) {
      ls.set(ACCOUNT_KEY, JSON.stringify(saved));
      const sy = await nativeRead('sync-u-' + saved.key); if (sy && !ls.get(syncKey(saved.key))) ls.set(syncKey(saved.key), sy);
      location.reload(); return false;
    }
    document.documentElement.classList.add('signed-out');
    signInScreen();
    window.HGI_READY = true; window.HGI_SIGNIN_READY = true; document.documentElement.classList.add('booted');
    return false;
  }

  /* ------------------------------------------------------------------ sync engine */
  let status = 'idle', lastErr = '', timer = null, running = false, again = false, backoff = 0, conflictOpen = false;
  const active = () => config.auth !== 'off' && !!account && !(typeof DEMO_MODE !== 'undefined' && DEMO_MODE);
  function setStatus(s, e) { status = s; lastErr = e || ''; renderCard(); }
  function kick(ms) { if (!active()) return; clearTimeout(timer); timer = setTimeout(syncNow, ms == null ? 4000 : ms); }

  function applyCloud(text, cv, note) {
    const o = parse(text); if (!o) return false;
    o.ui = Object.assign({}, o.ui || {}, { rev: Math.max(revOf(o), revOf(state)) });
    state = migrateState(o); saveState(); initApp(state);
    const ob = document.getElementById('onboarding'); if (ob && !needsOnboarding()) ob.remove();
    if (note) toast(note);
    return true;
  }
  async function conflict(cloud) {
    if (conflictOpen) return 'later';
    conflictOpen = true;
    try {
      const full = await api('GET', '/v1/sync', undefined, account.session);
      const co = parse(full.data);
      // both devices ended up with the same content (e.g. both opened the same restored copy): no real conflict
      if (co && await fingerprint(contentOf(co)) === await fingerprint(contentOf(state))) {
        writeSync(account.key, { version: Number(full.cloud.version) || 0, hash: await fingerprint(contentOf(state)), at: Date.now() });
        return 'same';
      }
      const pick = await dialog({ title: t('Data changed on two devices'),
        body: `<p>${esc(t('Your account was updated from another device while this phone also had changes that were not synced yet.'))}</p>
          <ul><li><strong>${esc(t('Cloud copy'))}:</strong> ${co ? esc(summary(co)) : ''}${full.cloud.device ? ' · ' + esc(full.cloud.device) : ''}${full.cloud.updatedAt ? ' · ' + esc(new Date(full.cloud.updatedAt).toLocaleString('en-IN')) : ''}</li>
          <li><strong>${esc(t('This phone'))}:</strong> ${esc(summary(state))}</li></ul>
          <p class="acct-note">${esc(t('The copy you do not choose is kept on this phone as a safety copy (Settings → Undo restore).'))}</p>`,
        buttons: [{ label: t('Keep this phone\'s data'), value: 'phone' }, { label: t('Use cloud copy'), value: 'cloud', primary: true }] });
      const cv = Number(full.cloud.version) || 0;
      if (pick === 'cloud') {
        snapshotBeforeRestore();
        applyCloud(full.data, cv, t('Cloud copy opened'));
        state.ui.restoredAt = new Date().toISOString(); saveState();
        writeSync(account.key, { version: cv, hash: await fingerprint(contentOf(state)), at: Date.now() });
        if (window.HGI_M && HGI_M.renderPrefs) HGI_M.renderPrefs();
        return 'cloud';
      }
      if (full.data) { ls.set(STORAGE_KEY + '_before_restore', full.data); if (window.HGI_nativeSnapshot) window.HGI_nativeSnapshot('before-restore', full.data); }
      state.ui.restoredAt = new Date().toISOString(); saveState();
      writeSync(account.key, Object.assign(readSync(account.key), { version: cv }));   // next upload is based on the cloud's version
      if (window.HGI_M && HGI_M.renderPrefs) HGI_M.renderPrefs();
      return 'phone';
    } finally { conflictOpen = false; }
  }

  // the user is in the middle of something an in-place refresh would throw away
  function editing() {
    const ed = document.getElementById('tab-create-invoice');
    const formOpen = ed && !ed.classList.contains('hidden');
    const modal = Array.from(document.querySelectorAll('.fixed.inset-0.z-50.flex')).some(m => !m.classList.contains('hidden') && m.id !== 'login-overlay');
    return formOpen || modal || !!document.querySelector('.acct-dlg, #onboarding');
  }
  let currentRun = null;
  function syncNow() {
    if (!active()) return Promise.resolve();
    if (running) { again = true; return currentRun; }
    running = true; clearTimeout(timer);
    currentRun = runSync();
    return currentRun;
  }
  async function runSync() {
    try {
      do {
        again = false;
        const sync = readSync(account.key);
        const snapshot = JSON.stringify(state);
        const fp = await fingerprint(contentOf(parse(snapshot)));
        const dirty = fp !== sync.hash;
        setStatus('syncing');
        const meta = (await api('GET', '/v1/sync/meta', undefined, account.session)).cloud || { version: 0 };
        const cv = Number(meta.version) || 0;
        if (cv > sync.version && !dirty && editing()) { kick(60000); break; }   // never replace data under an open form or dialog
        if (cv > sync.version && !dirty) {
          // changed on another device, nothing new here → download
          const full = await api('GET', '/v1/sync', undefined, account.session);
          if (full.data && applyCloud(full.data, cv, t('Updated with changes from your other device'))) {
            writeSync(account.key, { version: Number(full.cloud.version) || cv, hash: await fingerprint(contentOf(state)), at: Date.now() });
          }
        } else if (cv > sync.version && dirty) {
          const r = await conflict(meta);
          if (r !== 'later') again = true;
        } else if (dirty || cv < sync.version) {
          try {
            const r = await api('PUT', '/v1/sync', { baseVersion: cv < sync.version ? cv : sync.version, clientRev: revOf(state), device: device(), data: snapshot }, account.session);
            writeSync(account.key, { version: Number(r.cloud.version) || 0, hash: fp, at: Date.now() });
            if (JSON.stringify(state) !== snapshot) again = true;   // edited while uploading
          } catch (e) {
            if (e.status === 409) { const r = await conflict(e.body && e.body.cloud); if (r !== 'later') again = true; }
            else throw e;
          }
        } else writeSync(account.key, Object.assign(sync, { at: Date.now() }));
      } while (again);
      backoff = 0; setStatus('ok');
    } catch (e) {
      if (e.status === 401 && e.code === 'account_deleted') { await wipeLocal(account.key); await clearAccount(); toast(t('This account was deleted. Its data was removed from this phone.'), 'error'); return location.reload(); }
      if (e.status === 401) { setStatus('signin', t('Sign in again to keep syncing. Your data is safe on this phone.')); return; }
      backoff = Math.min(backoff ? backoff * 2 : 15000, 10 * 60000);
      setStatus(e.code === 'offline' ? 'offline' : 'error', e.code === 'offline' ? t('Waiting for internet — changes are saved on this phone and will sync automatically.') : e.message);
      kick(backoff);
    } finally { running = false; }
  }

  async function wipeLocal(key) {
    [slotKey(key), slotKey(key) + '_before_restore', syncKey(key)].forEach(ls.del);
    for (const k of [mirrorKey(key), 'u-' + key + '-before-restore', 'sync-u-' + key]) await nativeWrite(k, '');
  }
  async function clearAccount() {
    ls.del(ACCOUNT_KEY); await nativeWrite('account', '');
    const N = Native(); if (N && N.googleSignOut) { try { await timeout(N.googleSignOut(), 3000); } catch (e) { /* ignore */ } }
    account = null;
  }

  /* ------------------------------------------------------------------ account actions (Settings) */
  async function signOutFlow() {
    const v = await dialog({ title: t('Sign out?'),
      body: `<p>${esc(t('Your data stays in your cloud account and comes back when you sign in again.'))}</p><label class="acct-check"><input type="checkbox" id="so-wipe"> ${esc(t('Also remove this account\'s data from this phone (shared phone)'))}</label>`,
      buttons: [{ label: t('Cancel'), value: false }, { label: t('Sign out'), value: true, primary: true }] });
    const box = { wipe: dialog.last.checked };
    if (!v) return;
    saveState(); await syncNow();
    const sync = readSync(account.key);
    const unsynced = (await fingerprint(contentOf(state))) !== sync.hash;
    if (unsynced) {
      const go = await dialog({ title: t('Not synced yet'), body: `<p>${esc(t('Some changes could not be uploaded yet (no internet?).'))} ${box.wipe ? esc(t('If you remove the data from this phone now, those changes are lost.')) : esc(t('They stay on this phone and upload when you sign in again.'))}</p>`,
        buttons: [{ label: t('Cancel'), value: false }, { label: t('Sign out anyway'), value: true, danger: true }] });
      if (!go) return;
    }
    if (window.HGI_M && HGI_M.flushMirror) await HGI_M.flushMirror();
    if (box.wipe) await wipeLocal(account.key);
    await clearAccount();
    location.reload();
  }
  async function deleteAccount() {
    const r = await dialog({ title: t('Delete account and cloud data?'), danger: true,
      body: `<p>${esc(t('This permanently deletes the cloud copy of all business data of'))} <strong>${esc(account.email)}</strong> ${esc(t('and removes it from this phone. It cannot be undone.'))}</p>
        <p class="acct-note">${esc(t('Tip: share a backup file first if you may need the invoices later.'))}</p><p>${esc(t('Type DELETE to confirm:'))}</p><input type="text" class="inp" autocomplete="off" autocapitalize="characters">`,
      buttons: [{ label: t('Cancel'), value: false }, { label: t('Delete permanently'), value: true, danger: true }] });
    if (!r) return;
    if (String(dialog.last.text).trim().toUpperCase() !== 'DELETE') return toast(t('Not deleted — type DELETE to confirm.'), 'info');
    try {
      await api('DELETE', '/v1/account', undefined, account.session);
    } catch (e) {
      if (!(e.status === 401 && e.code === 'account_deleted')) return toast(t('Could not delete the account') + ': ' + e.message, 'error');
    }
    clearTimeout(timer);
    await wipeLocal(account.key);
    await clearAccount();
    toast(t('Account and cloud data deleted'));
    setTimeout(() => location.reload(), 600);
  }
  async function reSignIn() {
    signInScreen(t('Sign in again with') + ' ' + account.email);
    const el = document.getElementById('signin-screen');
    const close = document.createElement('button'); close.type = 'button'; close.className = 'si-close'; close.textContent = t('Not now');
    close.onclick = hideSignIn; el.querySelector('.si-card').appendChild(close);
  }

  /* ------------------------------------------------------------------ Settings card */
  function ago(ms) { if (!ms) return ''; const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? t('just now') : m < 60 ? m + ' ' + t('min ago') : new Date(ms).toLocaleString('en-IN'); }
  function renderCard() {
    if (!account) return;
    const col = document.querySelector('#tab-settings .set-col') || document.getElementById('tab-settings');
    if (!col) return;
    let card = document.getElementById('acct-card');
    if (!card) {
      card = document.createElement('div'); card.id = 'acct-card'; card.className = 'bg-white p-6 rounded-lg shadow-sm border border-slate-200 set-card';
      col.prepend(card);
      const nav = document.querySelector('#tab-settings .set-index');
      if (nav && !nav.querySelector('[data-t="acct-card"]')) { const b = document.createElement('button'); b.type = 'button'; b.dataset.t = 'acct-card'; b.innerHTML = `<span>${esc(t('Account & sync'))}</span>`; nav.prepend(b); }
    }
    const sync = readSync(account.key);
    const demo = typeof DEMO_MODE !== 'undefined' && DEMO_MODE;
    const line = demo ? t('Demo Mode — sample data is not synced.')
      : status === 'syncing' ? t('Syncing…')
      : status === 'ok' ? `${t('Synced')} ${ago(sync.at)}`
      : status === 'idle' ? (sync.at ? `${t('Last synced')} ${ago(sync.at)}` : t('Not synced yet'))
      : lastErr;
    const tone = demo ? 'muted' : status === 'ok' ? 'ok' : status === 'syncing' || status === 'idle' ? 'muted' : 'warn';
    card.innerHTML = `<h3 class="set-group"><i class="fa-solid fa-cloud-arrow-up"></i>${esc(t('Account & cloud sync'))}</h3>
      <div class="acct-row"><div class="acct-avatar" aria-hidden="true">${esc((account.name || account.email || '?').trim().charAt(0).toUpperCase())}</div>
        <div class="acct-who"><strong>${esc(account.name || account.email)}</strong><span>${esc(account.email)}</span></div></div>
      <p class="acct-status acct-${tone}" id="acct-status" role="status">${esc(line)}</p>
      <p class="text-[11px] text-slate-500 mt-1">${esc(t('Every change is saved on this phone and synced automatically to your HGI cloud account. After a reinstall, sign in with this Google account to get everything back. No manual backups needed.'))}</p>
      <div class="flex flex-wrap gap-2 mt-3">
        ${status === 'signin' ? `<button type="button" class="px-3 py-2 bg-orange-600 text-white rounded text-xs font-bold" onclick="HGI_SYNC.reSignIn()">${esc(t('Sign in again'))}</button>` : ''}
        <button type="button" id="acct-sync-now" class="px-3 py-2 bg-slate-800 text-white rounded text-xs font-bold" onclick="HGI_SYNC.syncNow()" ${demo ? 'disabled' : ''}>${esc(t('Sync now'))}</button>
        <button type="button" id="acct-signout" class="px-3 py-2 border rounded text-xs font-bold" onclick="HGI_SYNC.signOut()">${esc(t('Sign out'))}</button>
        <button type="button" id="acct-delete" class="px-3 py-2 border border-rose-300 text-rose-700 rounded text-xs font-bold" onclick="HGI_SYNC.deleteAccount()">${esc(t('Delete account and cloud data'))}</button>
      </div>`;
  }

  /* ------------------------------------------------------------------ start (after the app is up) */
  function start() {
    if (!active()) { renderCard(); return; }
    if (typeof window.saveState === 'function' && !window.saveState.__hgiSync) {
      const orig = window.saveState;
      window.saveState = function () { const r = orig.apply(this, arguments); kick(); return r; };
      window.saveState.__hgiSync = true;
    }
    window.addEventListener('online', () => kick(500));
    const A = AppPlugin();
    if (A) A.addListener('appStateChange', ({ isActive }) => { if (!isActive) kick(0); else kick(1500); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') kick(0); });
    setInterval(() => { if (document.visibilityState !== 'hidden') kick(0); }, 5 * 60000);   // picks up changes from other devices
    renderCard();
    kick(800);
  }

  window.HGI_SYNC = {
    gate, start, syncNow: () => { kick(0); }, signOut: signOutFlow, deleteAccount, reSignIn,
    active, status: () => ({ status, error: lastErr, account: account && { key: account.key, email: account.email }, sync: account ? readSync(account.key) : null, config: { auth: config.auth } }),
    renderCard, _syncNow: syncNow
  };
})();
