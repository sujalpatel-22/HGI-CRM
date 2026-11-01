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

  /* ------------------------------------------------------------------ records: the app's book ⇄ one cloud record per buyer / product / document */
  // The cloud keeps each buyer, product and document as its own record, so two phones can work at the same time and both
  // sets of new invoices survive. Device-only settings (PIN, theme, language, local password) stay on the phone.
  const UI_SYNC = ['invoiceStyle', 'onboarded', 'recentProducts'];
  const parse = txt => { try { const o = JSON.parse(txt); return o && typeof o === 'object' ? o : null; } catch (e) { return null; } };
  // 53-bit string hash (fast, for change detection only)
  function hash(str) {
    let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36) + ':' + str.length;
  }
  const recKey = (kind, id) => kind + '~' + id;
  /** the book → Map(key → {kind, id, obj, text, h}) */
  function recordsOf(st) {
    const out = new Map();
    const put = (kind, id, obj) => { if (id == null || id === '') return; const text = JSON.stringify(obj); out.set(recKey(kind, String(id)), { kind, id: String(id), obj, text, h: hash(text) }); };
    put('company', 'main', st.company || {});
    const ui = {}; UI_SYNC.forEach(k => { if (st.ui && st.ui[k] !== undefined) ui[k] = st.ui[k]; });
    put('settings', 'main', { ui });
    (st.customers || []).forEach(c => c && put('customer', c.id, c));
    (st.products || []).forEach(p => p && put('product', p.id, p));
    (st.invoices || []).forEach(d => d && put('invoice', d.id, d));
    return out;
  }
  const ARR = { customer: 'customers', product: 'products', invoice: 'invoices' };
  /** puts one record (or its deletion) into the book */
  function applyRecord(st, kind, id, obj) {
    if (kind === 'company') { if (obj) st.company = obj; return; }
    if (kind === 'settings') { if (obj && obj.ui) { st.ui = st.ui || {}; UI_SYNC.forEach(k => { if (obj.ui[k] !== undefined) st.ui[k] = obj.ui[k]; }); } return; }
    const arr = st[ARR[kind]] = st[ARR[kind]] || [];
    const i = arr.findIndex(x => x && String(x.id) === String(id));
    if (!obj) { if (i >= 0) arr.splice(i, 1); return; }
    if (i >= 0) arr[i] = obj; else arr.push(obj);
  }
  const emptyBook = () => ({ credentials: { username: 'admin', password: '123' }, company: {}, products: [], customers: [], invoices: [], ui: { invoiceStyle: 'modern' } });
  const meaningful = s => !!s && ((Array.isArray(s.invoices) && s.invoices.length) || (Array.isArray(s.customers) && s.customers.length) || (Array.isArray(s.products) && s.products.length) || (s.company && s.company.name));
  const count = (n, one, many) => `${n} ${t(n === 1 ? one : many)}`;
  const summary = s => `${count((s.invoices || []).length, 'document', 'documents')}, ${count((s.customers || []).length, 'buyer', 'buyers')}${s.company && s.company.name ? ' — ' + s.company.name : ''}`;
  const revOf = s => Number(s && s.ui && s.ui.rev) || 0;

  // sync position per account: { v: 2, seq, base: { key: {r: revision, h: hash} }, clash: { key: {...} }, at }
  const metaKey = key => 'hgi_sync2_u_' + key;
  function readMeta(key) { const m = parse(ls.get(metaKey(key)) || ''); return m && m.v === 2 ? m : { v: 2, seq: 0, base: {}, clash: {}, at: 0 }; }
  let metaTimer = null;
  function writeMeta(key, m) {
    ls.set(metaKey(key), JSON.stringify(m));
    clearTimeout(metaTimer); metaTimer = setTimeout(() => nativeWrite('sync2-u-' + key, JSON.stringify(m)), 500);
  }
  /** all records of the account (paged) */
  async function pullAll(session, since = 0) {
    const out = []; let s = since, more = true;
    while (more) {
      const r = await api('GET', `/v1/sync/pull?since=${s}&limit=300`, undefined, session);
      out.push(...r.records); more = r.more;
      if (r.records.length) s = r.records[r.records.length - 1].seq;
    }
    return { records: out, seq: s };
  }

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
    if (!ls.get(metaKey(key))) { const m = await nativeRead('sync2-u-' + key); if (m) ls.set(metaKey(key), m); }

    if (!local) {
      // nothing of this account on the phone: download the account's records
      msg(t('Downloading your data…'));
      const cloud = await pullAll(s.session);
      const book = emptyBook(), meta = { v: 2, seq: cloud.seq, base: {}, clash: {}, at: Date.now() };
      cloud.records.forEach(r => { const obj = r.deleted ? null : parse(r.data); applyRecord(book, r.kind, r.id, obj); meta.base[recKey(r.kind, r.id)] = { r: r.rev, h: r.deleted ? 'deleted' : hash(r.data) }; });
      const cloudHas = meaningful(book);

      // data saved before accounts existed (v8.0 and older) and not given to an account yet: only with the user's OK
      let legacy = null;
      if (!ls.get(LEGACY_OWNER)) {
        let lt = ls.get(LEGACY_KEY); const mt = await nativeRead('state');
        if (mt && (!lt || revOf(parse(mt)) > revOf(parse(lt)))) lt = mt;
        const lo = lt ? parse(lt) : null;
        if (meaningful(lo)) legacy = { text: lt, obj: lo };
      }
      let use = book;
      if (legacy) {
        const pick = await dialog({ title: cloudHas ? t('Add this phone\'s data to your account?') : t('Move this phone\'s data into your account?'),
          body: `<p>${esc(t('This phone has business data saved before you signed in:'))} <strong>${esc(summary(legacy.obj))}</strong>.</p>
            ${cloudHas ? `<p>${esc(t('Your account already has:'))} <strong>${esc(summary(book))}</strong>.</p><p>${esc(t('Adding keeps everything from both; documents that exist in both are not doubled.'))}</p>`
              : `<p>${esc(t('Moving it uploads it to your cloud account, so it is safe and available on your other phones.'))}</p>`}
            <p class="acct-note">${esc(t('If you choose not to, that data stays on this phone untouched and is not uploaded.'))}</p>`,
          buttons: [{ label: cloudHas ? t('Use only my account\'s data') : t('Not now'), value: 'no' }, { label: cloudHas ? t('Add to my account') : t('Move to my account'), value: 'yes', primary: true }] });
        if (pick === 'yes') {
          const merged = cloudHas ? book : emptyBook();
          const L = recordsOf(legacy.obj);
          L.forEach((r, k) => {
            if (r.kind === 'company' && cloudHas && book.company && book.company.name) return;          // the account's company profile stays
            if (r.kind === 'settings') { if (!cloudHas) applyRecord(merged, r.kind, r.id, r.obj); return; }
            if (!meta.base[k] || meta.base[k].h === 'deleted') applyRecord(merged, r.kind, r.id, r.obj);   // new to the account
          });
          if (!cloudHas) { merged.company = legacy.obj.company || {}; merged.credentials = legacy.obj.credentials || merged.credentials; }
          use = merged;
          ls.set(LEGACY_OWNER, key);
          if (cloudHas) { ls.set(slotKey(key) + '_before_restore', legacy.text); await nativeWrite('u-' + key + '-before-restore', legacy.text); }
          ls.del(LEGACY_KEY);                    // the app-file copy ('state') stays on the phone as an upgrade safety copy
        }
      }
      if (meaningful(use) || cloud.records.length) {
        use.ui = Object.assign({}, use.ui || {}, { onboarded: use.ui && use.ui.onboarded !== undefined ? use.ui.onboarded : meaningful(use) });
        if (meaningful(use)) use.ui.onboarded = true;
        const text = JSON.stringify(use);
        ls.set(slotKey(key), text);
        await nativeWrite(mirrorKey(key), text);
      }
      writeMeta(key, meta);
      await nativeWrite('sync2-u-' + key, JSON.stringify(meta));
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
      const sy = await nativeRead('sync2-u-' + saved.key); if (sy && !ls.get(metaKey(saved.key))) ls.set(metaKey(saved.key), sy);
      location.reload(); return false;
    }
    document.documentElement.classList.add('signed-out');
    signInScreen();
    window.HGI_READY = true; window.HGI_SIGNIN_READY = true; document.documentElement.classList.add('booted');
    return false;
  }

  /* ------------------------------------------------------------------ sync engine (record by record) */
  let status = 'idle', lastErr = '', timer = null, running = false, again = false, backoff = 0, features = { gst: false, files: false }, lastPull = 0;
  const active = () => config.auth !== 'off' && !!account && !(typeof DEMO_MODE !== 'undefined' && DEMO_MODE);
  function setStatus(s, e) { status = s; lastErr = e || ''; renderCard(); renderBanner(); }
  function kick(ms) { if (!active()) return; clearTimeout(timer); timer = setTimeout(syncNow, ms == null ? 3000 : ms); }

  const labelOf = (kind, obj) => !obj ? kind : kind === 'invoice' ? `${obj.docType || 'INV'} ${obj.num || ''}`.trim() : kind === 'company' ? t('Company profile') : kind === 'settings' ? t('Settings') : (obj.name || kind);
  function rememberLoser(kind, id, obj, why) {
    if (!obj || kind === 'settings') return;
    const ui = state.ui = state.ui || {};
    ui.syncConflicts = [{ kind, id, label: labelOf(kind, obj), why, at: new Date().toISOString(), data: JSON.stringify(obj) }, ...(ui.syncConflicts || [])].slice(0, 30);
  }
  // both this phone and another device changed the same record
  function resolve(kind, id, mine, theirs) {
    if (!mine) return theirs;                       // deleted here, changed there → keep their version (nothing is lost)
    if (!theirs) return mine;                       // deleted there, changed here → keep this phone's version
    if (kind === 'invoice') {
      const newer = String(mine.updatedAt || '') >= String(theirs.updatedAt || '') ? mine : theirs;
      const older = newer === mine ? theirs : mine;
      // receipts recorded on either phone are all kept
      const pays = new Map(); [...(older.payments || []), ...(newer.payments || [])].forEach(p => p && pays.set(p.id || JSON.stringify(p), p));
      const out = Object.assign({}, newer, { payments: [...pays.values()] });
      const { payments: a, ...ra } = older, { payments: b, ...rb } = newer;
      if (JSON.stringify(ra) !== JSON.stringify(rb)) rememberLoser(kind, id, older, newer === mine ? 'kept this phone\'s newer edit' : 'kept the other device\'s newer edit');
      return out;
    }
    rememberLoser(kind, id, mine, 'kept the version already in the cloud');
    return theirs;
  }

  // one remote record into the book; returns true when the book changed
  function takeRemote(meta, cur, r) {
    const k = recKey(r.kind, r.id), base = meta.base[k], mine = cur.get(k);
    const rText = r.deleted ? null : r.data, rh = r.deleted ? 'deleted' : hash(rText);
    const lh = mine ? mine.h : 'deleted';
    const localChanged = base ? lh !== base.h : !!mine;
    if (!localChanged || lh === rh) {
      meta.base[k] = { r: r.rev, h: rh };
      if (lh === rh) return false;
      applyRecord(state, r.kind, r.id, r.deleted ? null : parse(rText));
      return true;
    }
    const merged = resolve(r.kind, r.id, mine ? mine.obj : null, r.deleted ? null : parse(rText));
    applyRecord(state, r.kind, r.id, merged);
    meta.base[k] = { r: r.rev, h: rh };           // the next upload of a merged version is based on the cloud's revision
    return true;
  }
  function refreshApp() {
    try {
      state = migrateState(state);
      if (typeof sortInvoices === 'function') sortInvoices();
      saveStateQuiet();
      renderAll(); populateCustomerDropdown(); refreshProductDatalist(); refreshCompanyNames();
      const st = document.getElementById('tab-settings'); if (st && st.classList.contains('hidden')) loadSettingsForm();
      const ob = document.getElementById('onboarding'); if (ob && !needsOnboarding()) ob.remove();
    } catch (e) { console.error('[HGI] refresh after sync', e); }
  }
  let quiet = false;
  function saveStateQuiet() { quiet = true; try { saveState(); } finally { quiet = false; } }

  async function pullRound(meta) {
    let changed = false, more = true, since = meta.seq || 0, n = 0;
    while (more) {
      const r = await api('GET', `/v1/sync/pull?since=${since}&limit=300`, undefined, account.session);
      if (r.records.length) {
        const cur = recordsOf(state);
        for (const rec of r.records) { if (takeRemote(meta, cur, rec)) changed = true; n++; }
        since = r.records[r.records.length - 1].seq;
      }
      more = r.more;
      meta.seq = since;
    }
    lastPull = Date.now();
    if (changed) refreshApp();
    return { changed, n };
  }

  async function pushRound(meta) {
    const cur = recordsOf(state), items = [];
    cur.forEach((r, k) => {
      const b = meta.base[k];
      if (b && b.h === r.h) return;
      const c = meta.clash[k];
      if (c && c.h === r.h) return;                // still the clashing number: waits until the user renumbers it
      if (c) delete meta.clash[k];
      items.push({ kind: r.kind, id: r.id, baseRev: b ? b.r : 0, data: r.text, modifiedAt: (r.obj && r.obj.updatedAt) || new Date().toISOString(), _h: r.h, _k: k });
    });
    Object.keys(meta.base).forEach(k => { if (!cur.has(k) && meta.base[k].h !== 'deleted') { const i = k.indexOf('~'); items.push({ kind: k.slice(0, i), id: k.slice(i + 1), baseRev: meta.base[k].r, deleted: true, _h: 'deleted', _k: k }); } });
    let sent = 0, conflicts = 0;
    for (let i = 0; i < items.length; i += 150) {
      const batch = items.slice(i, i + 150);
      const r = await api('POST', '/v1/sync/push', { device: device(), records: batch.map(({ _h, _k, ...x }) => x) }, account.session);
      const now = recordsOf(state);
      r.results.forEach((x, j) => {
        const it = batch[j], k = it._k;
        if (x.status === 'ok') { meta.base[k] = { r: x.rev, h: it._h }; sent++; }
        else if (x.status === 'conflict') { conflicts++; takeRemote(meta, now, { kind: x.kind, id: x.id, rev: x.server.rev, deleted: x.server.deleted, data: x.server.data }); }
        else if (x.status === 'number_taken') meta.clash[k] = { h: it._h, num: x.num, docType: x.docType, takenBy: x.takenBy, at: Date.now() };
        else meta.clash[k] = { h: it._h, error: x.status, at: Date.now() };
      });
    }
    if (conflicts) refreshApp();
    return { sent, conflicts, total: items.length };
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
      setStatus('syncing');
      if (!features.checked) { try { const me = await api('GET', '/v1/me', undefined, account.session); features = Object.assign({ checked: true }, me.features || {}); } catch (e) { if (e.status === 401) throw e; } }
      let rounds = 0;
      do {
        again = false;
        const meta = readMeta(account.key);
        const before = Object.keys(meta.clash).length;
        await pullRound(meta);
        const p = await pushRound(meta);
        if (p.sent || p.conflicts) await pullRound(meta);       // moves the cursor past our own uploads
        meta.at = Date.now();
        writeMeta(account.key, meta);
        if (Object.keys(meta.clash).length > before) notifyClash(meta);
        if (p.conflicts) again = true;
      } while (again && ++rounds < 4);
      backoff = 0; setStatus('ok');
      if (window.HGI_PDFQ) HGI_PDFQ.drain();
    } catch (e) {
      if (e.status === 401 && e.code === 'account_deleted') { await wipeLocal(account.key); await clearAccount(); toast(t('This account was deleted. Its data was removed from this phone.'), 'error'); return location.reload(); }
      if (e.status === 401) { setStatus('signin', t('Sign in again to keep syncing. Your data is safe on this phone.')); return; }
      backoff = Math.min(backoff ? backoff * 2 : 15000, 10 * 60000);
      setStatus(e.code === 'offline' ? 'offline' : 'error', e.code === 'offline' ? t('Offline — billing works normally; changes upload automatically when the internet is back.') : e.message);
      kick(backoff);
    } finally { running = false; }
  }

  /* ------------------------------------------------------------------ document-number clashes (two phones issued the same number offline) */
  function clashes() {
    if (!account) return [];
    const meta = readMeta(account.key);
    return Object.entries(meta.clash).map(([k, c]) => { const id = k.slice(k.indexOf('~') + 1); const d = (state.invoices || []).find(x => String(x.id) === id); return d ? { k, d, c } : null; }).filter(x => x && x.c.num);
  }
  function notifyClash() {
    const list = clashes(); if (!list.length) return;
    toast(`${list.length === 1 ? t('1 document was not uploaded') : list.length + ' ' + t('documents were not uploaded')}: ${t('its number is already used on another device. Tap Fix on the red banner.')}`, 'error');
  }
  function renderBanner() {
    let b = document.getElementById('sync-banner');
    const list = active() ? clashes() : [];
    if (!list.length) { if (b) b.remove(); return; }
    if (!b) { b = document.createElement('div'); b.id = 'sync-banner'; b.className = 'no-print'; const h = document.querySelector('#app-container > header'); if (h) h.after(b); else document.body.prepend(b); }
    b.innerHTML = `<span>⚠ ${esc(list.map(x => `${x.d.num}`).join(', '))} — ${esc(t('number already used on another device; not uploaded'))}</span><button type="button" onclick="HGI_SYNC.fixClashes()">${esc(t('Fix'))}</button>`;
  }
  async function fixClashes() {
    const list = clashes(); if (!list.length) return;
    await syncNow();                                      // newest numbers from the other devices first
    const rows = clashes().map(x => ({ ...x, next: generateNextNumber(x.d.docType || 'INV', x.d.date) }));
    if (!rows.length) return;
    const ok = await dialog({ title: t('Give these documents new numbers?'),
      body: `<p>${esc(t('Another device already issued documents with these numbers. Each number may be used only once, so these copies were kept on this phone and not uploaded.'))}</p>
        <ul>${rows.map(x => `<li><strong>${esc(x.d.num)}</strong> → <strong>${esc(x.next)}</strong> · ${esc(x.d.buyerName || '')} · ${esc(typeof money === 'function' ? money(x.d.grandTotal || 0) : '')}</li>`).join('')}</ul>
        <p class="acct-note">${esc(t('If you already sent one of them to the buyer, tell the buyer about the new number.'))}</p>`,
      buttons: [{ label: t('Not now'), value: false }, { label: t('Renumber and upload'), value: true, primary: true }] });
    if (!ok) return;
    for (const x of rows) { x.d.num = generateNextNumber(x.d.docType || 'INV', x.d.date); x.d.updatedAt = new Date().toISOString(); }
    saveState(); renderAll();
    await syncNow();
    toast(t('Renumbered and uploaded'));
  }

  /* ------------------------------------------------------------------ GSTIN look-up + PDF backup (server features) */
  async function gstLookup(gstin, fresh) {
    if (!active()) throw new ApiErr(t('GST look-up works when you are signed in to HGI cloud.'), 0, 'not_signed_in');
    return api('GET', `/v1/gstin/${encodeURIComponent(gstin)}${fresh ? '?fresh=1' : ''}`, undefined, account.session);
  }
  async function uploadPdf(docId, base64, info) {
    if (!active()) throw new ApiErr('not signed in', 0, 'not_signed_in');
    return api('PUT', `/v1/files/pdf/${encodeURIComponent(docId)}`, Object.assign({ base64 }, info || {}), account.session);
  }
  async function listPdfs() { return api('GET', '/v1/files', undefined, account.session); }

  async function wipeLocal(key) {
    [slotKey(key), slotKey(key) + '_before_restore', metaKey(key), 'hgi_sync_u_' + key].forEach(ls.del);
    for (const k of [mirrorKey(key), 'u-' + key + '-before-restore', 'sync2-u-' + key, 'sync-u-' + key]) await nativeWrite(k, '');
  }
  async function clearAccount() {
    ls.del(ACCOUNT_KEY); await nativeWrite('account', '');
    const N = Native(); if (N && N.googleSignOut) { try { await timeout(N.googleSignOut(), 3000); } catch (e) { /* ignore */ } }
    account = null;
  }
  function pendingCount() {
    if (!account) return 0;
    const meta = readMeta(account.key), cur = recordsOf(state);
    let n = 0; cur.forEach((r, k) => { if (!meta.base[k] || meta.base[k].h !== r.h) n++; });
    Object.keys(meta.base).forEach(k => { if (!cur.has(k) && meta.base[k].h !== 'deleted') n++; });
    return n;
  }

  /* ------------------------------------------------------------------ account actions (Settings) */
  async function signOutFlow() {
    const v = await dialog({ title: t('Sign out?'),
      body: `<p>${esc(t('Your data stays in your cloud account and comes back when you sign in again.'))}</p><label class="acct-check"><input type="checkbox" id="so-wipe"> ${esc(t('Also remove this account\'s data from this phone (shared phone)'))}</label>`,
      buttons: [{ label: t('Cancel'), value: false }, { label: t('Sign out'), value: true, primary: true }] });
    const box = { wipe: dialog.last.checked };
    if (!v) return;
    saveState(); await syncNow();
    if (pendingCount()) {
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
      body: `<p>${esc(t('This permanently deletes all business data and invoice PDFs of'))} <strong>${esc(account.email)}</strong> ${esc(t('from the cloud and removes it from this phone. It cannot be undone.'))}</p>
        <p class="acct-note">${esc(t('Tip: share a backup file first if you may need the invoices later.'))}</p><p>${esc(t('Type DELETE to confirm:'))}</p><input type="text" class="inp" autocomplete="off" autocapitalize="characters">`,
      buttons: [{ label: t('Cancel'), value: false }, { label: t('Delete permanently'), value: true, danger: true }] });
    if (!r) return;
    if (String(dialog.last.text).trim().toUpperCase() !== 'DELETE') return toast(t('Not deleted — type DELETE to confirm.'), 'info');
    try { await api('DELETE', '/v1/account', undefined, account.session); }
    catch (e) { if (!(e.status === 401 && e.code === 'account_deleted')) return toast(t('Could not delete the account') + ': ' + e.message, 'error'); }
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
  async function reviewConflicts() {
    const list = (state.ui && state.ui.syncConflicts) || [];
    if (!list.length) return toast(t('Nothing to review'), 'info');
    await dialog({ title: t('Edits replaced during sync'),
      body: `<p>${esc(t('The same record was changed on two devices. The app kept one version; the other is listed here so nothing is lost.'))}</p><ul>${list.slice(0, 15).map(c => `<li><strong>${esc(c.label)}</strong> · ${esc(new Date(c.at).toLocaleString('en-IN'))} · ${esc(c.why)}</li>`).join('')}</ul>`,
      buttons: [{ label: t('Clear list'), value: 'clear' }, { label: t('Close'), value: false, primary: true }] }).then(v => { if (v === 'clear') { state.ui.syncConflicts = []; saveState(); renderCard(); } });
  }

  /* ------------------------------------------------------------------ Settings card */
  function ago(ms) { if (!ms) return ''; const m = Math.round((Date.now() - ms) / 60000); return m < 1 ? t('just now') : m < 60 ? m + ' ' + t('min ago') : new Date(ms).toLocaleString('en-IN'); }
  function renderCard() {
    if (!account) return;
    const col = document.querySelector('#tab-settings .set-col') || document.getElementById('tab-settings');
    if (!col || typeof state === 'undefined') return;
    let card = document.getElementById('acct-card');
    if (!card) {
      card = document.createElement('div'); card.id = 'acct-card'; card.className = 'bg-white p-6 rounded-lg shadow-sm border border-slate-200 set-card';
      col.prepend(card);
      const nav = document.querySelector('#tab-settings .set-index');
      if (nav && !nav.querySelector('[data-t="acct-card"]')) { const b = document.createElement('button'); b.type = 'button'; b.dataset.t = 'acct-card'; b.innerHTML = `<span>${esc(t('Account & sync'))}</span>`; nav.prepend(b); }
    }
    const meta = readMeta(account.key);
    const demo = typeof DEMO_MODE !== 'undefined' && DEMO_MODE;
    const pend = demo ? 0 : pendingCount(), cl = clashes(), lost = ((state.ui && state.ui.syncConflicts) || []).length;
    const line = demo ? t('Demo Mode — sample data is not synced.')
      : status === 'syncing' ? t('Syncing…')
      : status === 'ok' ? (pend ? `${pend} ${t('changes waiting to upload')}` : `${t('All data synced')} · ${ago(meta.at)}`)
      : status === 'idle' ? (meta.at ? `${t('Last synced')} ${ago(meta.at)}` : t('Not synced yet'))
      : lastErr;
    const tone = demo ? 'muted' : cl.length ? 'warn' : status === 'ok' && !pend ? 'ok' : status === 'syncing' || status === 'idle' ? 'muted' : 'warn';
    card.innerHTML = `<h3 class="set-group"><i class="fa-solid fa-cloud-arrow-up"></i>${esc(t('Account & cloud sync'))}</h3>
      <div class="acct-row"><div class="acct-avatar" aria-hidden="true">${esc((account.name || account.email || '?').trim().charAt(0).toUpperCase())}</div>
        <div class="acct-who"><strong>${esc(account.name || account.email)}</strong><span>${esc(account.email)}</span></div></div>
      <p class="acct-status acct-${tone}" id="acct-status" role="status">${esc(line)}</p>
      ${cl.length ? `<p class="acct-alert">${esc(cl.length === 1 ? t('1 document has a number already used on another device.') : cl.length + ' ' + t('documents have numbers already used on another device.'))} <button type="button" class="acct-link" onclick="HGI_SYNC.fixClashes()">${esc(t('Fix'))}</button></p>` : ''}
      ${lost ? `<p class="acct-note mt-1">${esc(lost + ' ' + t('edit(s) replaced by another device\'s version'))} <button type="button" class="acct-link" onclick="HGI_SYNC.reviewConflicts()">${esc(t('Review'))}</button></p>` : ''}
      <p class="text-[11px] text-slate-500 mt-1">${esc(t('Buyers, products, invoices, payments and your business profile are saved on this phone and synced automatically to your HGI cloud account. Sign in on any phone to get everything back; several phones stay in step. No manual backups needed.'))}</p>
      <p class="text-[11px] text-slate-500 mt-1" id="acct-features">${features.checked ? `${esc(t('GST look-up'))}: <strong>${features.gst ? esc(t('on')) : esc(t('not set up on the server'))}</strong> · ${esc(t('PDF cloud copies'))}: <strong>${features.files ? esc(t('on')) : esc(t('not set up on the server'))}</strong>` : ''}</p>
      <div class="flex flex-wrap gap-2 mt-3">
        ${status === 'signin' ? `<button type="button" class="px-3 py-2 bg-orange-600 text-white rounded text-xs font-bold" onclick="HGI_SYNC.reSignIn()">${esc(t('Sign in again'))}</button>` : ''}
        <button type="button" id="acct-sync-now" class="px-3 py-2 bg-slate-800 text-white rounded text-xs font-bold" onclick="HGI_SYNC.syncNow()" ${demo ? 'disabled' : ''}>${esc(t('Sync now'))}</button>
        ${features.files && window.HGI_PDFQ ? `<button type="button" id="acct-pdfs" class="px-3 py-2 border rounded text-xs font-bold" onclick="HGI_PDFQ.backupAll()">${esc(t('Back up invoice PDFs'))}</button>` : ''}
        <button type="button" id="acct-signout" class="px-3 py-2 border rounded text-xs font-bold" onclick="HGI_SYNC.signOut()">${esc(t('Sign out'))}</button>
        <button type="button" id="acct-delete" class="px-3 py-2 border border-rose-300 text-rose-700 rounded text-xs font-bold" onclick="HGI_SYNC.deleteAccount()">${esc(t('Delete account and cloud data'))}</button>
      </div>`;
  }

  /* ------------------------------------------------------------------ start (after the app is up) */
  function start() {
    if (!active()) { renderCard(); return; }
    if (typeof window.saveState === 'function' && !window.saveState.__hgiSync) {
      const orig = window.saveState;
      window.saveState = function () { const r = orig.apply(this, arguments); if (!quiet) kick(); return r; };
      window.saveState.__hgiSync = true;
    }
    // a saved invoice goes up at once, so a number clash with another phone shows within seconds
    if (typeof window.saveCurrentInvoice === 'function' && !window.saveCurrentInvoice.__hgiSync) {
      const o = window.saveCurrentInvoice;
      window.saveCurrentInvoice = function () { const r = o.apply(this, arguments); if (r) kick(200); return r; };
      window.saveCurrentInvoice.__hgiSync = true;
    }
    // a new document: fetch other phones' latest numbers first (if the last check is more than a minute old)
    if (typeof window.newDocument === 'function' && !window.newDocument.__hgiSync) {
      const o = window.newDocument;
      window.newDocument = function () { const r = o.apply(this, arguments); if (Date.now() - lastPull > 60000) kick(0); return r; };
      window.newDocument.__hgiSync = true;
    }
    window.addEventListener('online', () => kick(500));
    const A = AppPlugin();
    if (A) A.addListener('appStateChange', ({ isActive }) => { if (!isActive) kick(0); else kick(1000); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') kick(0); });
    setInterval(() => { if (document.visibilityState !== 'hidden') kick(0); }, 2 * 60000);   // picks up changes from other devices
    renderCard(); renderBanner();
    kick(600);
  }

  window.HGI_SYNC = {
    gate, start, syncNow: () => { kick(0); }, signOut: signOutFlow, deleteAccount, reSignIn, fixClashes, reviewConflicts,
    gstLookup, uploadPdf, listPdfs, features: () => features,
    active, status: () => ({ status, error: lastErr, account: account && { key: account.key, email: account.email }, sync: account ? readMeta(account.key) : null, pending: account && typeof state !== 'undefined' ? pendingCount() : 0, clashes: clashes().map(x => x.d.num), config: { auth: config.auth } }),
    renderCard, _syncNow: syncNow
  };
})();
