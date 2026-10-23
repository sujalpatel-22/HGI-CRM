/* =====================================================================
   HGI Billing v7 — mobile shell & native bridge
   Runs after the core app script. It never changes GST calculations;
   it only adds navigation, native print/PDF/share, onboarding, app lock,
   language, theme and on-device durability.
   ===================================================================== */
(function () {
  'use strict';
  const APP_VERSION = '8.0.0';
  const cap = window.Capacitor;
  const isNative = !!(cap && typeof cap.isNativePlatform === 'function' && cap.isNativePlatform());
  // Without a bundler the native bridge exposes registered plugins on Capacitor.Plugins
  const Native = isNative ? ((cap.Plugins && cap.Plugins.HgiNative) || (typeof cap.registerPlugin === 'function' ? cap.registerPlugin('HgiNative') : null)) : null;
  if (isNative && !Native) console.error('[HGI] HgiNative plugin not available');
  const AppPlugin = isNative && cap.Plugins ? cap.Plugins.App : null;
  const i18n = window.HGI_I18N || { setLang() {}, t: s => s, LANGS: { en: 'English' }, translateTree() {} };
  const t = s => i18n.t(s);
  const mq = window.matchMedia ? window.matchMedia('(max-width: 767px)') : { matches: false, addEventListener() {} };
  window.HGI_APP = { version: APP_VERSION, isNative, hasNativePlugin: !!Native };

  /* ------------------------------------------------------------------ helpers */
  const wrap = (name, after, before) => {
    const orig = window[name];
    if (typeof orig !== 'function') return;
    window[name] = function (...args) {
      if (before) { const r = before.apply(this, args); if (r === false) return; }
      const out = orig.apply(this, args);
      if (after) after.apply(this, [out, ...args]);
      return out;
    };
  };
  const blobToBase64 = blob => new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result).split(',')[1] || '');
    r.onerror = () => rej(r.error);
    r.readAsDataURL(blob);
  });
  async function sha256(text) {
    if (window.crypto && crypto.subtle) {
      const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
      return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }
    let h = 0; for (let i = 0; i < text.length; i++) h = (h * 31 + text.charCodeAt(i)) | 0; return 'x' + h;   // fallback only for very old engines
  }
  const ui = () => (state.ui = state.ui || {});

  /* ------------------------------------------------------------------ table → card labels */
  function labelTable(table) {
    if (!table || !table.tHead) return;
    const heads = Array.from(table.tHead.rows[0] ? table.tHead.rows[0].cells : []).map(th => th.textContent.trim());
    table.classList.add('m-cards');
    Array.from(table.tBodies).forEach(tb => Array.from(tb.rows).forEach(tr => Array.from(tr.cells).forEach((td, i) => {
      if (!td.hasAttribute('colspan')) td.setAttribute('data-label', heads[i] || '');
    })));
  }
  // icon-only buttons get an accessible name (screen readers / TalkBack)
  // icon classes of a button: Font Awesome <i>, or the v8 <svg> that replaced it (original names kept in data-fa)
  const faOf = el => !el ? [] : el.tagName === 'I' ? Array.from(el.classList) : String((el.dataset && el.dataset.fa) || '').split(' ').filter(Boolean);
  const iconOf = b => b.querySelector('i, svg.ic');
  function ariaIcons(root) {
    (root || document).querySelectorAll('button:not([aria-label])').forEach(b => {
      if (b.textContent.trim()) return;
      const ic = iconOf(b); const cls = faOf(ic).find(c => ACTION_NAMES[c]);
      const name = b.getAttribute('title') || (cls ? ACTION_NAMES[cls] : '');
      if (name) b.setAttribute('aria-label', name);
    });
  }
  function labelAll() {
    ariaIcons(document.querySelector('main'));
    ['invoices-list-tbody', 'items-list-tbody', 'customers-list-tbody', 'dash-recent-table'].forEach(id => { const tb = document.getElementById(id); if (tb) labelTable(tb.closest('table')); });
    const items = document.getElementById('invoice-items-body');
    if (items) {
      const heads = Array.from(items.closest('table').tHead.rows[0].cells).map(th => th.textContent.trim());
      Array.from(items.rows).forEach(tr => Array.from(tr.cells).forEach((td, i) => td.setAttribute('data-label', heads[i] || '')));
    }
  }

  /* ------------------------------------------------------------------ preview scaling (screen only) */
  function scalePreview() {
    const box = document.getElementById('invoice-preview-container');
    if (!box) return;
    const avail = box.clientWidth;
    box.querySelectorAll('.a4-page').forEach(page => {
      let w = page.parentElement;
      if (!w.classList.contains('page-scale-wrap')) {
        w = document.createElement('div'); w.className = 'page-scale-wrap';
        page.parentElement.insertBefore(w, page); w.appendChild(page);
      }
      page.classList.add('page-scaler');
      page.style.transform = ''; w.style.height = ''; w.style.width = '';
      const pw = page.offsetWidth, ph = page.offsetHeight;
      if (!avail || !pw || avail >= pw) { w.style.overflow = ''; return; }
      const s = avail / pw;
      page.style.transform = `scale(${s})`;
      w.style.width = `${avail}px`; w.style.height = `${Math.ceil(ph * s) + 12}px`; w.style.overflow = 'hidden';
    });
  }

  /* ------------------------------------------------------------------ theme */
  function rgbHex(c) {
    const m = String(c || '').match(/rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?/);
    if (!m || (m[4] !== undefined && Number(m[4]) === 0)) return null;
    return '#' + [m[1], m[2], m[3]].map(n => Number(n).toString(16).padStart(2, '0')).join('');
  }
  function applyTheme() {
    const pref = ui().theme || 'system';
    const dark = pref === 'dark' || (pref === 'system' && window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    document.documentElement.classList.toggle('dark', dark);
    if (typeof salesChart !== 'undefined' && salesChart && salesChart.__dark !== dark && typeof renderChart === 'function') { try { renderChart(); } catch (e) { /* chart optional */ } }
    const meta = document.querySelector('meta[name="theme-color"]'); if (meta) meta.content = dark ? '#070b16' : '#f3f1ec';
    try {
      const sb = isNative && cap.Plugins.SystemBars;
      // v8: the app bar and the area under the floating dock are the page colour, so both system bars take it
      // (dark icons on the light page, light icons in dark mode)
      if (sb) {
        Promise.resolve(sb.setStyle({ style: dark ? 'DARK' : 'LIGHT', bar: 'StatusBar' })).catch(() => {});
        Promise.resolve(sb.setStyle({ style: dark ? 'DARK' : 'LIGHT', bar: 'NavigationBar' })).catch(() => {});
      }
      if (Native && Native.setBarColors) {
        const page = rgbHex(getComputedStyle(document.body).backgroundColor) || (dark ? '#070b16' : '#f3f1ec');
        Promise.resolve(Native.setBarColors({ top: page, bottom: page })).catch(() => {});
      }
    } catch (e) { /* optional */ }
  }
  if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme);

  /* ------------------------------------------------------------------ bottom navigation */
  const TAB_TITLES = { dashboard: 'Dashboard', 'create-invoice': 'New Invoice', invoices: 'Documents', returns: 'GST Returns', items: 'Items', customers: 'Buyers', settings: 'Settings' };
  function buildShell() {
    const nav = document.createElement('nav');
    nav.id = 'bottom-nav'; nav.className = 'no-print';
    nav.innerHTML = `
      <button data-tab="dashboard"><i class="fa-solid fa-house"></i><span>Home</span></button>
      <button data-tab="invoices"><i class="fa-solid fa-file-lines"></i><span>Docs</span></button>
      <button data-tab="create-invoice" class="fab"><span class="fab-circle"><i class="fa-solid fa-plus"></i></span><span>New</span></button>
      <button data-tab="customers"><i class="fa-solid fa-users"></i><span>Buyers</span></button>
      <button data-tab="more"><i class="fa-solid fa-grip"></i><span>More</span></button>`;
    nav.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      const tab = b.dataset.tab;
      if (tab === 'more') return openMore();
      if (tab === 'create-invoice') return openNewMenu();
      switchTab(tab);
    });
    document.getElementById('app-container').appendChild(nav);

    const sheet = document.createElement('div');
    sheet.id = 'more-sheet'; sheet.className = 'no-print';
    sheet.innerHTML = `<div class="backdrop"></div><div class="sheet"><div class="grab"></div><div id="more-sheet-body"></div></div>`;
    sheet.querySelector('.backdrop').addEventListener('click', closeMore);
    document.getElementById('app-container').appendChild(sheet);

    const title = document.createElement('div');
    title.id = 'mobile-page-title'; title.className = 'hidden text-[11px] font-bold uppercase tracking-wider text-blue-200';
    const nameBox = document.getElementById('header-comp-name');
    if (nameBox && nameBox.parentElement) nameBox.parentElement.appendChild(title);
  }
  function tile(icon, label, action) {
    return `<button class="tile" onclick="${action}"><i class="fa-solid ${icon}"></i><span>${label}</span></button>`;
  }
  function openSheet(html) {
    const sheet = document.getElementById('more-sheet');
    document.getElementById('more-sheet-body').innerHTML = html; sheet.classList.add('open'); i18n.translateTree(sheet);
    if (window.HGI_STUDIO) HGI_STUDIO.swapIcons(sheet);
  }
  function closeMore() { const m = document.getElementById('more-sheet'); if (m) m.classList.remove('open'); }
  function openMore() {
    openSheet(`<div class="grid grid-cols-3 gap-2.5">
      ${tile('fa-box', t('Items'), "HGI_M.go('items')")}
      ${tile('fa-landmark', t('GST Returns'), "HGI_M.go('returns')")}
      ${tile('fa-file-signature', t('Quotations'), "HGI_M.quotes()")}
      ${tile('fa-gear', t('Settings'), "HGI_M.go('settings')")}
      ${tile('fa-database', t('Share Backup'), 'HGI_M.shareBackup()')}
      ${tile(document.documentElement.classList.contains('dark') ? 'fa-sun' : 'fa-moon', t('Theme'), 'HGI_M.toggleTheme()')}
      ${tile('fa-language', t('Language'), 'HGI_M.languageSheet()')}
      ${ui().pinHash ? tile('fa-lock', t('Lock now'), 'HGI_M.lock()') : tile('fa-shield-halved', t('App Lock (PIN)'), "HGI_M.go('settings'); setTimeout(()=>document.getElementById('app-prefs').scrollIntoView({behavior:'smooth'}),150)")}
      ${tile('fa-circle-info', 'v' + APP_VERSION, 'HGI_M.about()')}
    </div>`);
  }
  function openNewMenu() {
    openSheet(`<div class="text-xs font-bold uppercase text-slate-500 mb-2 px-1">${t('New')}</div><div class="grid grid-cols-2 gap-2.5">
      ${tile('fa-file-invoice-dollar', t('Tax Invoice'), "HGI_M.newDoc('INV')")}
      ${tile('fa-file-signature', t('Quotation'), "HGI_M.newDoc('QUO')")}
      ${tile('fa-rotate-left', t('Credit Note'), "HGI_M.newDoc('CRN')")}
      ${tile('fa-file-circle-plus', t('Debit Note'), "HGI_M.newDoc('DBN')")}
      ${tile('fa-user-plus', t('Add Buyer'), "HGI_M.close(); switchTab('customers'); openCustomerModal()")}
      ${tile('fa-box-open', t('Add Product'), "HGI_M.close(); switchTab('items'); openItemModal()")}
    </div>`);
  }
  function setActiveNav(tab) {
    document.querySelectorAll('#bottom-nav button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab || (tab === 'items' || tab === 'returns' || tab === 'settings') && b.dataset.tab === 'more'));
    const el = document.getElementById('mobile-page-title'); if (el) el.textContent = t(TAB_TITLES[tab] || '');
  }

  /* ------------------------------------------------------------------ native print / PDF / share */
  const docFileName = d => `${(DOC_TYPES[d.docType] ? DOC_TYPES[d.docType].short : 'Doc').replace(/\s+/g, '')}_${String(d.num).replace(/[\/\\]/g, '-')}_${String(d.buyerName || '').replace(/[^\w]+/g, '_').slice(0, 40)}`;
  let restoreAfterPrint = null;
  function renderForOutput() {
    const copies = selectedCopies();
    if (!copies.length) { toast('Select at least one copy', 'error'); return null; }
    renderPreviewPages(copies);
    return copies;
  }
  function scheduleRestore(copies) {
    restoreAfterPrint = () => { renderPreviewPages([copies[0]]); restoreAfterPrint = null; };
  }
  async function nativePrint() {
    if (!previewDoc) return;
    const copies = renderForOutput(); if (!copies) return;
    scheduleRestore(copies);
    try { await Native.print({ name: docFileName(previewDoc) }); }
    catch (e) { toast('Printing failed: ' + (e.message || e), 'error'); restoreAfterPrint && restoreAfterPrint(); }
  }
  async function sharePdf() {
    if (!previewDoc) return;
    const d = previewDoc;
    if (!isNative) { toast('In the print dialog choose "Save as PDF", then share the file.', 'info'); return triggerPrint(); }
    const copies = renderForOutput(); if (!copies) return;
    try {
      const co = state.company;
      const text = `${DOC_TYPES[d.docType].short} ${d.num} · ${money(d.grandTotal)} · ${co.name}`;
      await Native.sharePdf({ fileName: docFileName(d) + '.pdf', text, title: `${DOC_TYPES[d.docType].short} ${d.num}` });
    } catch (e) { toast('Could not create PDF: ' + (e.message || e), 'error'); }
    finally { renderPreviewPages([copies[0]]); }
  }
  async function savePdf() {
    if (!previewDoc) return;
    if (!isNative) return triggerPrint();
    const copies = renderForOutput(); if (!copies) return;
    try { const r = await Native.savePdf({ fileName: docFileName(previewDoc) + '.pdf' }); toast(`PDF saved: ${r.location || 'Downloads'}`); }
    catch (e) { toast('Could not save PDF: ' + (e.message || e), 'error'); }
    finally { renderPreviewPages([copies[0]]); }
  }
  async function shareBackup() {
    closeMore();
    const json = JSON.stringify(state, null, 1);
    const name = `${DEMO_MODE ? 'DEMO_' : ''}HGI_Backup_${todayISO()}.json`;
    state.ui.lastBackup = new Date().toISOString(); saveState();
    if (isNative) {
      try { await Native.shareFile({ fileName: name, base64: btoa(unescape(encodeURIComponent(json))), mime: 'application/json', text: 'HGI Billing backup' }); }
      catch (e) { toast('Share failed: ' + (e.message || e), 'error'); }
    } else exportJSONBackup();
  }

  /* ------------------------------------------------------------------ on-device durability (native) */
  let mirrorTimer = null;
  // real data and demo data have separate mirror files, so Demo Mode can never overwrite the real mirror
  const MIRROR_KEY = DEMO_MODE ? 'state-demo' : 'state';
  function mirrorState() {
    if (!Native) return;
    clearTimeout(mirrorTimer);
    mirrorTimer = setTimeout(() => { Native.writeState({ key: MIRROR_KEY, data: JSON.stringify(state) }).catch(() => {}); }, 800);
  }
  async function flushMirror() {
    clearTimeout(mirrorTimer);
    if (Native) { try { await Promise.race([Native.writeState({ key: MIRROR_KEY, data: JSON.stringify(state) }), new Promise(res => setTimeout(res, 3000))]); } catch (e) { /* localStorage copy still exists */ } }
  }

  /* ------------------------------------------------------------------ demo mode (explicit opt-in only) */
  // opts.confirmed: caller already asked the user (used by automated tests; the UI always asks)
  async function enterDemo(opts) {
    if (DEMO_MODE) return;
    if (!(opts && opts.confirmed) && !confirm(t('Open Demo Mode?') + '\n\n' + t('Demo Mode shows sample customers and invoices so you can try the app. Your own data is kept separately and is not changed. Demo documents are watermarked "NOT A VALID TAX INVOICE".'))) return;
    saveState(); await flushMirror();
    try { localStorage.setItem(HGI_MODE_KEY, 'demo'); } catch (e) { return toast('Demo Mode needs app storage, which is blocked here.', 'error'); }
    location.reload();
  }
  async function exitDemo(opts) {
    if (!DEMO_MODE) return;
    if (!(opts && opts.confirmed) && !confirm(t('Leave Demo Mode?') + '\n\n' + t('The sample data will be deleted and your own data will open.'))) return;
    clearTimeout(mirrorTimer);
    try { localStorage.removeItem(STORAGE_KEY); localStorage.removeItem(HGI_MODE_KEY); } catch (e) { /* ignore */ }
    if (Native) { try { await Promise.race([Native.writeState({ key: 'state-demo', data: '' }), new Promise(res => setTimeout(res, 3000))]); } catch (e) { /* ignore */ } }
    location.reload();
  }
  function demoBanner() {
    if (!DEMO_MODE || document.getElementById('demo-banner')) return;
    const b = document.createElement('div');
    b.id = 'demo-banner'; b.className = 'no-print';
    b.innerHTML = `<i class="fa-solid fa-flask"></i><span data-i18n><strong>DEMO MODE</strong><span class="db-more"> — sample data, not real invoices</span></span><button type="button" onclick="HGI_M.exitDemo()" data-i18n>Exit demo</button>`;
    const header = document.querySelector('#app-container > header');
    if (header) header.after(b); else document.body.prepend(b);
  }
  // Start-up: load whichever copy is newer — WebView storage or the app-file mirror (revision number from saveState).
  // Covers WebView storage being wiped, and WebView storage being full so its copy fell behind.
  const revOf = json => { try { const s = typeof json === 'string' ? JSON.parse(json) : json; return Number(s && s.ui && s.ui.rev) || 0; } catch (e) { return -1; } };
  async function restoreFromMirror() {
    if (!Native) return;
    try {
      const local = storeGet('local', STORAGE_KEY);
      // Right after an in-app reload (Demo Mode switch) the first bridge reply can be lost on some WebViews (seen on
      // Android 11/13 emulators): never let start-up wait forever — time out, retry once, then go on with WebView storage.
      let r = null;
      for (let attempt = 0; attempt < 2 && !r; attempt++) {
        r = await Promise.race([Native.readState({ key: MIRROR_KEY }), new Promise(res => setTimeout(() => res(null), 2500))]);
        if (!r && attempt === 0) console.warn('[HGI] mirror read timed out — retrying');
      }
      if (!r || !r.data) return;
      const lr = local ? revOf(local) : -1, mr = revOf(r.data);
      if (mr < 0) return;                                   // unreadable mirror: keep what we have
      if (!local || mr > lr) {
        window.__HGI_BOOT_DATA = r.data;                    // used by initApp even if WebView storage cannot take it
        storeSet('local', STORAGE_KEY, r.data);
        window.__restoredFromMirror = true;
        console.log(`[HGI] loaded newer on-device copy (rev ${mr} > ${lr})`);
      }
    } catch (e) { /* first run */ }
  }
  // safety copy before a backup restore replaces the data (called by the core app)
  window.HGI_nativeSnapshot = (key, data) => { if (Native) Native.writeState({ key: (DEMO_MODE ? 'demo-' : '') + key, data }).catch(() => {}); };
  async function undoRestore() {
    let snap = storeGet('local', STORAGE_KEY + '_before_restore');
    if (!snap && Native) { try { const r = await Native.readState({ key: (DEMO_MODE ? 'demo-' : '') + 'before-restore' }); snap = r && r.data; } catch (e) { /* none */ } }
    if (!snap) return toast('No earlier data to go back to.', 'info');
    let parsed; try { parsed = JSON.parse(snap); } catch (e) { return toast('The safety copy could not be read.', 'error'); }
    if (!confirm(`Go back to the data from before the last restore (${(parsed.invoices || []).length} documents)?`)) return;
    parsed.ui = { ...(parsed.ui || {}), rev: Math.max(Number(parsed.ui && parsed.ui.rev) || 0, Number(state.ui.rev) || 0) };
    delete parsed.ui.restoredAt;
    state = migrateState(parsed); saveState(); initApp(state);
    const ob = document.getElementById('onboarding'); if (ob && !needsOnboarding()) ob.remove();
    try { localStorage.removeItem(STORAGE_KEY + '_before_restore'); } catch (e) { /* ignore */ }
    toast('Previous data is back');
  }

  /* ------------------------------------------------------------------ app lock */
  let unlocked = false, backgroundAt = 0;
  function lockScreenHtml() {
    const co = state.company;
    return `<div class="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-6 text-center space-y-5">
      <img src="${companyLogo()}" class="mx-auto h-16 object-contain" alt="">
      <div><div class="font-bold text-slate-800">${esc(co.name)}</div><div class="text-xs text-slate-500" data-i18n>Enter PIN</div></div>
      <div class="pin-dots" id="pin-dots">${'<span></span>'.repeat(ui().pinLen || 4)}</div>
      <div id="pin-msg" class="text-xs text-rose-600 h-4"></div>
      <div class="pin-pad grid grid-cols-3 gap-3">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button data-k="${n}">${n}</button>`).join('')}
        <button data-k="forgot" class="!text-xs !font-semibold">Forgot?</button><button data-k="0">0</button><button data-k="del"><i class="fa-solid fa-delete-left"></i></button></div>
    </div>`;
  }
  function showLock() {
    let el = document.getElementById('lock-screen');
    if (!el) { el = document.createElement('div'); el.id = 'lock-screen'; el.className = 'fixed inset-0 z-[70] brand-bg flex items-center justify-center p-4 no-print'; document.body.appendChild(el); }
    el.innerHTML = lockScreenHtml(); el.classList.remove('hidden');
    i18n.translateTree(el);
    let entry = '', fails = 0;
    const len = ui().pinLen || 4;
    const dots = () => el.querySelectorAll('#pin-dots span').forEach((s, i) => s.classList.toggle('on', i < entry.length));
    el.querySelector('.pin-pad').onclick = async e => {
      const b = e.target.closest('button'); if (!b) return;
      const k = b.dataset.k;
      if (k === 'del') entry = entry.slice(0, -1);
      else if (k === 'forgot') return forgotPin();
      else if (entry.length < len) entry += k;
      dots();
      if (entry.length === len) {
        const ok = (await sha256(ui().pinSalt + entry)) === ui().pinHash;
        if (ok) { unlocked = true; el.classList.add('hidden'); storeSet('session', 'hgi_auth_session', 'true'); showMainApp(); }
        else { fails++; entry = ''; dots(); el.querySelector('#pin-msg').textContent = t('Wrong PIN') + (fails >= 5 ? ' — wait 30 s' : ''); if (fails >= 5) { el.querySelector('.pin-pad').style.pointerEvents = 'none'; setTimeout(() => { el.querySelector('.pin-pad').style.pointerEvents = ''; fails = 0; }, 30000); } }
      }
    };
  }
  function forgotPin() {
    const g = prompt('To reset the PIN, enter your company GSTIN exactly as saved in Settings:');
    if (g === null) return;
    if (g.trim().toUpperCase() === String(state.company.gstin || '').toUpperCase()) {
      delete ui().pinHash; delete ui().pinSalt; saveState(); unlocked = true;
      document.getElementById('lock-screen').classList.add('hidden'); showMainApp();
      toast('PIN removed — set a new one in Settings → App Preferences', 'warn');
    } else toast('GSTIN does not match', 'error');
  }
  async function setPin() {
    const p1 = prompt('New 4–6 digit PIN:'); if (p1 === null) return;
    if (!/^\d{4,6}$/.test(p1)) return toast('PIN must be 4 to 6 digits', 'error');
    const p2 = prompt('Repeat PIN:'); if (p2 !== p1) return toast('PINs do not match', 'error');
    const salt = Array.from(crypto.getRandomValues ? crypto.getRandomValues(new Uint8Array(12)) : [Date.now()]).map(b => b.toString(16)).join('');
    ui().pinSalt = salt; ui().pinHash = await sha256(salt + p1); ui().pinLen = p1.length;
    saveState(); renderPrefs(); toast('App lock enabled');
  }
  function removePin() { if (!confirm('Turn off the app lock?')) return; delete ui().pinHash; delete ui().pinSalt; saveState(); renderPrefs(); toast('App lock turned off', 'info'); }

  /* ------------------------------------------------------------------ onboarding */
  function needsOnboarding() { return !ui().onboarded && !(state.invoices || []).length; }
  function showOnboarding() {
    // never pre-fill the wizard with the old sample values (fake GSTIN / bank account)
    const co = placeholderFields(state.company).length
      ? Object.assign({}, state.company, { name: '', gstin: '', address: '', pin: '', phone: '', bankName: '', bankAcc: '', bankIfsc: '', upiId: '' })
      : state.company;
    const el = document.createElement('div');
    el.id = 'onboarding'; el.className = 'fixed inset-0 z-[65] brand-bg flex items-center justify-center p-4 overflow-y-auto no-print';
    const langBtns = Object.entries(i18n.LANGS).map(([k, v]) => `<button data-lang="${k}" class="ob-lang px-3 py-3 rounded-xl border-2 font-bold ${i18n.lang === k ? 'border-orange-500 bg-orange-50' : 'border-slate-200'}">${v}</button>`).join('');
    el.innerHTML = `<div class="bg-white w-full max-w-md rounded-2xl shadow-2xl p-5 space-y-4 my-auto">
      <div class="flex items-center justify-between"><img src="${DEFAULT_LOGO}" class="h-10" alt=""><div class="ob-dots">${'<span></span>'.repeat(4)}</div></div>
      <div class="ob-step" data-step="0">
        <h2 class="text-xl font-bold text-slate-800">Welcome</h2>
        <p class="text-sm text-slate-500 mt-1">GST billing, quotations, stock and receipts — works offline on this phone.</p>
        <div class="field-label mt-4">Language</div><div class="grid grid-cols-3 gap-2">${langBtns}</div>
        <div class="field-label mt-4">Theme</div>
        <select id="ob-theme" class="inp"><option value="system">System</option><option value="light">Light</option><option value="dark">Dark</option></select>
        <label class="mt-4 block text-sm text-orange-700 font-semibold cursor-pointer"><i class="fa-solid fa-upload mr-1"></i>Restore from a backup<input type="file" accept=".json,application/json" class="hidden" onchange="HGI_M.restoreAndClose(event)"></label>
        <button type="button" id="ob-demo" onclick="HGI_M.enterDemo()" class="mt-3 block text-sm text-slate-600 font-semibold"><i class="fa-solid fa-flask mr-1"></i>Just looking? Explore with sample data (Demo Mode)</button>
      </div>
      <div class="ob-step" data-step="1">
        <h2 class="text-xl font-bold text-slate-800">Your Business</h2>
        <div class="space-y-3 mt-3">
          <div><label class="field-label">Business / Trade Name</label><input id="ob-name" class="inp" value="${esc(co.name)}"></div>
          <div><label class="field-label">GSTIN</label><input id="ob-gstin" maxlength="15" class="inp uppercase" value="${esc(co.gstin)}"><p id="ob-gstin-st" class="text-[11px] mt-1"></p></div>
          <div><label class="field-label">Address</label><textarea id="ob-addr" rows="2" class="inp">${esc(co.address)}</textarea></div>
          <div class="grid grid-cols-2 gap-2"><div><label class="field-label">PIN</label><input id="ob-pin" maxlength="6" inputmode="numeric" class="inp" value="${esc(co.pin || '')}"></div>
            <div><label class="field-label">Phone</label><input id="ob-phone" inputmode="tel" class="inp" value="${esc(co.phone || '')}"></div></div>
          <div><label class="field-label">Aggregate Annual Turnover (previous FY)</label><select id="ob-aato" class="inp"><option value="upto5">Up to ₹5 crore</option><option value="5to10">Above ₹5 crore, below ₹10 crore</option><option value="above10">₹10 crore and above</option></select></div>
        </div>
      </div>
      <div class="ob-step" data-step="2">
        <h2 class="text-xl font-bold text-slate-800">Bank & UPI</h2>
        <p class="text-xs text-slate-500">Printed on invoices. You can skip and add later in Settings.</p>
        <div class="space-y-3 mt-3">
          <div><label class="field-label">Bank Name</label><input id="ob-bank" class="inp" value="${esc(co.bankName || '')}"></div>
          <div class="grid grid-cols-2 gap-2"><div><label class="field-label">Account Number</label><input id="ob-acc" inputmode="numeric" class="inp" value="${esc(co.bankAcc || '')}"></div>
            <div><label class="field-label">IFSC Code</label><input id="ob-ifsc" maxlength="11" class="inp uppercase" value="${esc(co.bankIfsc || '')}"></div></div>
          <div><label class="field-label">UPI ID</label><input id="ob-upi" class="inp" placeholder="name@bank" value="${esc(co.upiId || '')}"></div>
        </div>
      </div>
      <div class="ob-step" data-step="3">
        <h2 class="text-xl font-bold text-slate-800">Security</h2>
        <p class="text-sm text-slate-600 mt-1">${isNative ? 'Protect the app with a PIN so others using this phone cannot see your accounts.' : 'Change the default login (admin / 123) in Settings after setup.'}</p>
        ${isNative ? `<button type="button" onclick="HGI_M.setPin()" class="mt-3 w-full py-3 rounded-xl border-2 border-slate-200 font-bold"><i class="fa-solid fa-lock mr-1"></i>Set app PIN</button>` : ''}
        <div class="mt-4 p-3 rounded-xl bg-amber-50 text-amber-800 text-xs"><strong>Your data stays on this device.</strong> Take a backup from the More menu regularly (and before changing phones).</div>
      </div>
      <div class="flex gap-2 pt-2">
        <button id="ob-back" class="px-4 py-3 rounded-xl border font-bold text-sm">Back</button>
        <button id="ob-next" class="flex-1 py-3 rounded-xl text-white font-bold text-sm" style="background:var(--brand-orange)">Next</button>
      </div>
    </div>`;
    document.body.appendChild(el);
    el.querySelector('#ob-aato').value = co.aato || 'upto5';
    el.querySelector('#ob-theme').value = ui().theme || 'system';
    let step = 0;
    // errors are shown right under the field (a toast could be hidden behind this full-screen wizard)
    const clearErrs = () => { el.querySelectorAll('.ob-err').forEach(e => e.remove()); el.querySelectorAll('.inp-err').forEach(e => e.classList.remove('inp-err')); };
    const fieldErr = (sel, msg, suggest) => {
      const input = el.querySelector(sel);
      const p = document.createElement('p');
      p.className = 'ob-err'; p.setAttribute('role', 'alert'); p.textContent = msg;
      if (suggest) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'ob-fix'; b.textContent = t('Use') + ' ' + suggest;
        b.onclick = () => { input.value = suggest; p.remove(); input.classList.remove('inp-err'); };
        p.appendChild(document.createTextNode(' ')); p.appendChild(b);
      }
      input.classList.add('inp-err');
      const host = input.closest('.grid > div');
      if (host) host.appendChild(p); else input.after(p);
      input.focus();
      return false;
    };
    el.addEventListener('input', e => {
      if (!e.target.classList.contains('inp-err')) return;
      e.target.classList.remove('inp-err');
      const host = e.target.closest('.grid > div');
      const n = host ? host.querySelector('.ob-err') : e.target.nextElementSibling;
      if (n && n.classList.contains('ob-err')) n.remove();
    });
    const show = () => {
      el.querySelectorAll('.ob-step').forEach(s => s.classList.toggle('active', Number(s.dataset.step) === step));
      el.querySelectorAll('.ob-dots span').forEach((s, i) => s.classList.toggle('on', i === step));
      el.querySelector('#ob-back').style.visibility = step ? 'visible' : 'hidden';
      el.querySelector('#ob-next').textContent = t(step === 3 ? 'Finish' : step === 0 ? 'Get started' : 'Next');
      i18n.translateTree(el);
    };
    el.querySelectorAll('.ob-lang').forEach(b => b.onclick = () => {
      ui().lang = b.dataset.lang; i18n.setLang(b.dataset.lang);
      el.querySelectorAll('.ob-lang').forEach(x => x.className = x.className.replace(/border-orange-500 bg-orange-50|border-slate-200/g, '') + (x === b ? ' border-orange-500 bg-orange-50' : ' border-slate-200'));
      show();
    });
    el.querySelector('#ob-theme').onchange = e => { ui().theme = e.target.value; applyTheme(); };
    el.querySelector('#ob-gstin').oninput = e => {
      const g = e.target.value.toUpperCase(); const r = validateGSTIN(g);
      const p = el.querySelector('#ob-gstin-st');
      p.className = `text-[11px] mt-1 font-semibold ${r.status === 'ok' ? 'text-emerald-600' : r.status === 'warn' ? 'text-amber-600' : 'text-rose-600'}`;
      p.textContent = r.status === 'empty' ? '' : r.msg;
    };
    el.querySelector('#ob-back').onclick = () => { if (step) { step--; show(); } };
    el.querySelector('#ob-next').onclick = () => {
      if (step === 1) {
        const name = el.querySelector('#ob-name').value.trim();
        clearErrs();
        if (name.length < 2) return fieldErr('#ob-name', t('Enter your business name'));
        const g = el.querySelector('#ob-gstin').value.trim().toUpperCase(), r = validateGSTIN(g);
        if (g && (r.status === 'invalid' || r.status === 'typing')) return fieldErr('#ob-gstin', t('GSTIN looks invalid — fix it or leave it blank'));
        const pin = el.querySelector('#ob-pin').value.trim();
        if (pin && !/^[1-9]\d{5}$/.test(pin)) return fieldErr('#ob-pin', t('PIN code must be 6 digits'));
        Object.assign(state.company, { name, gstin: g, address: el.querySelector('#ob-addr').value, pin, phone: el.querySelector('#ob-phone').value.trim(), aato: el.querySelector('#ob-aato').value });
        if (r.code) { state.company.stateCode = r.code; state.company.state = GST_STATES[r.code]; state.company.pan = g.slice(2, 12); }
      }
      if (step === 2) {
        clearErrs();
        const acc = checkBankAcc(el.querySelector('#ob-acc').value), ifsc = checkIfsc(el.querySelector('#ob-ifsc').value), upi = checkUpi(el.querySelector('#ob-upi').value);
        let bad = false;
        if (!acc.ok) bad = fieldErr('#ob-acc', acc.msg) || true;
        if (!ifsc.ok) bad = fieldErr('#ob-ifsc', ifsc.msg, ifsc.suggest) || true;
        if (!upi.ok) bad = fieldErr('#ob-upi', upi.msg) || true;
        if (bad) return;
        Object.assign(state.company, { bankName: el.querySelector('#ob-bank').value.trim(), bankAcc: acc.value, bankIfsc: ifsc.value, upiId: upi.value });
      }
      if (step < 3) { step++; return show(); }
      ui().onboarded = true; saveState();
      refreshCompanyNames(); loadSettingsForm(); newDocument('INV', true); renderAll();
      el.remove(); switchTab('dashboard');
      toast(`Welcome, ${state.company.name}! ${mq.matches ? 'Tap +' : 'Click “New Invoice”'} to create your first invoice.`);
    };
    show();
  }

  /* ------------------------------------------------------------------ app preferences card (Settings) */
  function renderPrefs() {
    let card = document.getElementById('app-prefs');
    if (!card) {
      card = document.createElement('div');
      card.id = 'app-prefs'; card.className = 'bg-white p-6 rounded-lg shadow-sm border border-slate-200';
      document.getElementById('tab-settings').prepend(card);
    }
    const langOpts = Object.entries(i18n.LANGS).map(([k, v]) => `<option value="${k}" ${i18n.lang === k ? 'selected' : ''}>${v}</option>`).join('');
    card.innerHTML = `<h2 class="text-lg font-bold text-slate-800 mb-4">App Preferences</h2>
      <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4 items-end">
        <div><label class="field-label">Language</label><select class="inp" onchange="HGI_M.setLang(this.value)">${langOpts}</select></div>
        <div><label class="field-label">Theme</label><select class="inp" onchange="HGI_M.setTheme(this.value)">
          <option value="system" ${(ui().theme || 'system') === 'system' ? 'selected' : ''}>System</option><option value="light" ${ui().theme === 'light' ? 'selected' : ''}>Light</option><option value="dark" ${ui().theme === 'dark' ? 'selected' : ''}>Dark</option></select></div>
        ${isNative ? `<div><label class="field-label">App Lock (PIN)</label>${ui().pinHash
          ? `<div class="flex gap-2"><button type="button" onclick="HGI_M.setPin()" class="flex-1 px-3 py-2.5 border rounded text-xs font-bold">Change PIN</button><button type="button" onclick="HGI_M.removePin()" class="px-3 py-2.5 border border-rose-300 text-rose-700 rounded text-xs font-bold">Turn off</button></div>`
          : `<button type="button" onclick="HGI_M.setPin()" class="w-full px-3 py-2.5 bg-slate-800 text-white rounded text-xs font-bold"><i class="fa-solid fa-lock mr-1"></i>Set PIN</button>`}</div>` : ''}
        <div><label class="field-label">Backup</label><button type="button" onclick="HGI_M.shareBackup()" class="w-full px-3 py-2.5 bg-emerald-600 text-white rounded text-xs font-bold"><i class="fa-solid fa-share-nodes mr-1"></i>Share Backup</button></div>
        ${ui().restoredAt ? `<div><label class="field-label">Last restore</label><button type="button" id="prefs-undo-restore" onclick="HGI_M.undoRestore()" class="w-full px-3 py-2.5 border rounded text-xs font-bold"><i class="fa-solid fa-rotate-left mr-1"></i>Undo restore</button></div>` : ''}
        <div><label class="field-label">Demo Mode</label>${DEMO_MODE
          ? `<button type="button" id="prefs-exit-demo" onclick="HGI_M.exitDemo()" class="w-full px-3 py-2.5 border-2 border-rose-300 text-rose-700 rounded text-xs font-bold"><i class="fa-solid fa-right-from-bracket mr-1"></i>Exit Demo Mode</button>`
          : `<button type="button" id="prefs-enter-demo" onclick="HGI_M.enterDemo()" class="w-full px-3 py-2.5 border rounded text-xs font-bold"><i class="fa-solid fa-flask mr-1"></i>Try with sample data</button>`}</div>
      </div>
      <p class="text-[11px] text-slate-400 mt-3">HGI Billing ${APP_VERSION} · ${isNative ? 'Android app — data is stored on this device and mirrored to the app\'s private storage.' : 'Web version — data is stored in this browser.'}</p>`;
    i18n.translateTree(card);
  }

  /* ------------------------------------------------------------------ old-WebView ₹ glyph check */
  // width of the ₹ glyph inside real bold app text ('₹1,234'), measured with a Range like the browser lays it out
  function rupeeWidth(parent, cls) {
    const el = document.createElement(parent === document.body ? 'div' : 'h3');
    el.className = cls; el.style.cssText = 'position:absolute;left:-9999px;top:0;white-space:nowrap';
    el.textContent = '₹1,234.00'; parent.appendChild(el);
    const r = document.createRange(); r.setStart(el.firstChild, 0); r.setEnd(el.firstChild, 1);
    const w = r.getBoundingClientRect().width; el.remove(); return w;
  }
  function checkRupeeGlyph() {
    const run = () => {
      const host = document.querySelector('#tab-dashboard') || document.body;
      const ws = [rupeeWidth(document.body, 'font-bold text-xl'), rupeeWidth(host, 'text-xl font-bold'), rupeeWidth(document.body, 'font-semibold'), rupeeWidth(document.body, '')];
      window.HGI_APP.rupeeWidths = ws.map(w => Math.round(w * 10) / 10);
      // the probe alone is not enough: on WebView 83 the glyph measured fine off-screen but was 0px inside the KPI cards.
      // Engines before Chrome 100 therefore always take ₹ from the system font (verified fine on WebView 109/124/133).
      const m = /Chrome\/(\d+)/.exec(navigator.userAgent), major = m ? Number(m[1]) : 999;
      if (ws.some(w => w < 2) || major < 100) { document.documentElement.classList.add('rupee-fix'); window.HGI_APP.rupeeFix = true; }
    };
    // load Inter's ₹ face first (unicode-range fonts load lazily), then measure
    if (document.fonts && document.fonts.load) Promise.all([document.fonts.load("700 40px 'Inter'", '₹'), document.fonts.load("400 40px 'Inter'", '₹')]).then(run, run);
    else setTimeout(run, 500);
  }

  /* ------------------------------------------------------------------ v7.2 UI: dashboard, row actions, live total */
  function enhanceDashboard() {
    const sec = document.getElementById('tab-dashboard'); if (!sec) return;
    const grids = Array.from(sec.children).filter(el => el.classList.contains('grid'));
    if (grids[0]) grids[0].classList.add('dash-kpis');
    if (grids[1]) grids[1].classList.add('dash-insights');
    if (grids[2]) grids[2].classList.add('dash-lists');
    sec.children[0].classList.add('dash-head');
    if (!document.getElementById('hero') && grids[0]) {
      const hero = document.createElement('div'); hero.id = 'hero'; hero.className = 'no-print';
      grids[0].before(hero);
      const strip = document.createElement('div'); strip.id = 'stat-strip'; strip.className = 'no-print';
      grids[0].before(strip);
    }
    if (!document.getElementById('quick-actions') && grids[0]) {
      const qa = document.createElement('div'); qa.id = 'quick-actions'; qa.className = 'no-print';
      qa.innerHTML = `
        <button type="button" class="qa-primary" onclick="newDocument('INV'); switchTab('create-invoice')"><i class="fa-solid fa-plus"></i><span>New invoice</span></button>
        <button type="button" onclick="newDocument('QUO'); switchTab('create-invoice')"><i class="fa-regular fa-file-lines"></i><span>Quotation</span></button>
        <button type="button" onclick="switchTab('customers'); openCustomerModal()"><i class="fa-regular fa-user"></i><span>Buyer</span></button>
        <button type="button" onclick="switchTab('items'); openItemModal()"><i class="fa-solid fa-box-open"></i><span>Item</span></button>`;
      document.getElementById('stat-strip').after(qa);
      i18n.translateTree(qa);
    }
  }

  // Dashboard hero: what is still to be collected, how this FY's billing splits into received / due / overdue,
  // and billing per month. Uses the same functions as the GST reports (balanceOf, isOverdue, signed, liveDocs).
  const splitMoney = n => { const t = money(n), i = t.lastIndexOf('.'); return i < 0 ? [t, ''] : [t.slice(0, i), t.slice(i)]; };
  function renderHero() {
    const hero = document.getElementById('hero'); if (!hero) return;
    const today = todayISO(), fyStart = fyStartISO(today), fyEnd = fyEndISO(today);
    const invs = liveDocs().filter(d => d.docType === 'INV');
    let due = 0, overdue = 0, dueN = 0, overN = 0;
    invs.forEach(d => { const b = balanceOf(d); if (b > 0.009) { due += b; dueN++; if (isOverdue(d)) { overdue += b; overN++; } } });
    let received = 0;
    state.invoices.forEach(d => (d.payments || []).forEach(p => { if (p.date >= fyStart && p.date <= fyEnd) received += (Number(p.amount) || 0) + (Number(p.tds) || 0); }));
    const fyDocs = liveDocs().filter(d => d.date >= fyStart && d.date <= fyEnd);
    const net = fyDocs.reduce((a, d) => a + signed(d) * (d.grandTotal || 0), 0);
    const notDue = Math.max(0, due - overdue);
    const curKey = today.slice(0, 7);
    // overdue money by how late it is (days past each invoice's due date)
    const AGE = [['1–30 days', 30], ['31–60 days', 60], ['61–90 days', 90], ['90+ days', Infinity]];
    const late = [0, 0, 0, 0];
    invs.forEach(d => { const b = balanceOf(d); if (b <= 0.009 || !isOverdue(d)) return; const n = daysBetween(getDueDate(d), today); late[AGE.findIndex(a => n <= a[1])] += b; });
    const lateMax = Math.max(1, ...late);
    const aging = AGE.map((a, i) => `<div class="age${late[i] > 0 ? '' : ' zero'}" style="--heat:${late[i] > 0 ? Math.max(.18, late[i] / lateMax).toFixed(2) : 0}"><span class="age-l">${a[0]}</span><b>${esc(money(late[i]))}</b><span class="age-bar"><i style="width:${late[i] > 0 ? Math.max(6, late[i] / lateMax * 100) : 0}%"></i></span></div>`).join('');
    const [whole, dec] = splitMoney(due);
    const sum = received + notDue + overdue;
    hero.innerHTML = `
      <div class="hero-top"><span class="hero-label" data-i18n>To collect</span><span class="hero-fy">FY ${fyOf(today)}</span></div>
      <div class="hero-amount" id="hero-amount">${esc(whole)}<span class="dec">${esc(dec)}</span></div>
      <div class="hero-sub">${dueN ? `${dueN} ${dueN === 1 ? t('invoice') : t('invoices')} ${t('pending')}${overN ? ` <span class="hero-warn">${window.HGI_STUDIO ? HGI_STUDIO.ic('error') : '<i class="fa-solid fa-circle-exclamation"></i>'} ${esc(money(overdue))} ${t('overdue')}</span>` : ''}` : t('Nothing pending — all invoices are paid')}</div>
      <div class="ledger" role="img" aria-label="${esc(`Received ${money(received)}, due ${money(notDue)}, overdue ${money(overdue)}`)}">
        ${sum > 0 ? `<i class="seg rec" style="flex:${received}"></i><i class="seg due" style="flex:${notDue}"></i><i class="seg ovd" style="flex:${overdue}"></i>` : '<i class="seg none" style="flex:1"></i>'}
      </div>
      <div class="hero-legend">
        <div><span class="dot rec"></span><span data-i18n>Received</span><b>${esc(money(received))}</b></div>
        <div><span class="dot due"></span><span data-i18n>Due</span><b>${esc(money(notDue))}</b></div>
        <div><span class="dot ovd"></span><span data-i18n>Overdue</span><b>${esc(money(overdue))}</b></div>
      </div>
      <div class="hero-aging"><div class="aging-cap"><span data-i18n>Overdue by age</span><span>${esc(money(net))} <span data-i18n>billed this FY</span></span></div><div class="age-grid">${aging}</div></div>`;
    const r = gstSummaryFor(today.slice(0, 7));
    const monthDocs = fyDocs.filter(d => monthKey(d.date) === curKey && d.docType === 'INV').length;
    document.getElementById('stat-strip').innerHTML = `
      <div><span data-i18n>Sales this month</span><b>${esc(money(r.taxable))}</b><small>${monthDocs} ${t(monthDocs === 1 ? 'invoice' : 'invoices')}</small></div>
      <div><span data-i18n>Output GST this month</span><b>${esc(money(r.tax))}</b><small data-i18n>for GSTR-3B</small></div>`;
    i18n.translateTree(hero); i18n.translateTree(document.getElementById('stat-strip'));
    if (window.HGI_STUDIO) HGI_STUDIO.renderDash();
  }

  // Invoice editor: the long form becomes named sections in the order people fill it in.
  // Elements are only tagged and re-ordered visually (CSS order); IDs and form logic are unchanged.
  const EDITOR_SECTIONS = [
    ['sec-doc', 'fa-regular fa-file-lines', 'Document'], ['sec-noteref', 'fa-solid fa-link', 'Original invoice'],
    ['sec-supply', 'fa-solid fa-scale-balanced', 'Tax settings'], ['sec-transport', 'fa-solid fa-truck', 'Order & transport'],
    ['sec-edoc', '', ''], ['sec-parties', 'fa-regular fa-user', 'Customer'], ['sec-items', 'fa-solid fa-list', 'Items'],
    ['sec-charges', 'fa-solid fa-percent', 'Discount & charges'], ['sec-terms', 'fa-regular fa-note-sticky', 'Terms'], ['sec-summary', 'fa-solid fa-receipt', 'Summary']
  ];
  function enhanceEditor() {
    const form = document.getElementById('invoice-form'); if (!form || form.classList.contains('editor-v2')) return;
    const kids = Array.from(form.children);
    EDITOR_SECTIONS.forEach(([cls, icon, title], i) => {
      const el = kids[i]; if (!el) return;
      el.classList.add('ed-sec', cls);
      if (title) {
        const h = document.createElement('div'); h.className = 'ed-head';
        h.innerHTML = `<i class="${icon}"></i><span data-i18n>${title}</span>`;
        el.prepend(h);
      }
    });
    if (kids[EDITOR_SECTIONS.length]) kids[EDITOR_SECTIONS.length].classList.add('ed-savebar');
    // the saved-buyer picker belongs to the customer section
    const pick = document.getElementById('inv-customer-select');
    const parties = form.querySelector('.sec-parties');
    if (pick && parties) {
      const wrapEl = pick.closest('div'); wrapEl.classList.add('ed-pick');
      parties.querySelector('.ed-head').after(wrapEl);
    }
    form.classList.add('editor-v2');
    buildDocTypeSeg();
    const ship = document.getElementById('sync-shipping-chk');
    if (ship) {
      const box = ship.closest('div.border');
      const sync = () => box && box.classList.toggle('ship-same', ship.checked);
      ship.addEventListener('change', sync);
      ['populateCustomerData', 'loadDocIntoForm', 'newDocument', 'syncShippingIfChecked'].forEach(n => wrap(n, sync));
      sync();
    }
    i18n.translateTree(form);
  }
  // Documents: one row of filter chips with counts; the original selects stay the source of truth
  const DOC_CHIPS = [['All', '', ''], ['Unpaid', 'INV', 'Unpaid'], ['Overdue', 'INV', 'Overdue'], ['Partial', 'INV', 'Partial'], ['Paid', 'INV', 'Paid'],
    ['Quotations', 'QUO', ''], ['Credit notes', 'CRN', ''], ['Debit notes', 'DBN', ''], ['Cancelled', '', 'Cancelled']];
  function buildDocChips() {
    const search = document.getElementById('inv-search'); if (!search || document.getElementById('doc-chips')) return;
    const bar = document.createElement('div'); bar.id = 'doc-chips'; bar.className = 'chips no-print'; bar.setAttribute('role', 'toolbar');
    bar.innerHTML = DOC_CHIPS.map(([l], i) => `<button type="button" data-i="${i}"><span data-i18n>${l}</span><b></b></button>`).join('')
      + `<button type="button" class="chip-more" aria-expanded="false"><i class="fa-solid fa-sliders"></i><span data-i18n>Filters</span></button>`;
    const row = search.parentElement;
    row.classList.add('doc-filters');
    row.after(bar);
    bar.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.classList.contains('chip-more')) { const open = row.classList.toggle('show-more'); b.setAttribute('aria-expanded', open); return; }
      const [, ty, st] = DOC_CHIPS[Number(b.dataset.i)];
      document.getElementById('inv-filter-type').value = ty; document.getElementById('inv-filter-status').value = st;
      renderInvoiceList();
    });
    i18n.translateTree(bar);
  }
  function syncDocChips() {
    const bar = document.getElementById('doc-chips'); if (!bar) return;
    const ty = document.getElementById('inv-filter-type').value, st = document.getElementById('inv-filter-status').value;
    const counts = DOC_CHIPS.map(([, t, s]) => state.invoices.filter(d => (!t || d.docType === t) && (!s || displayStatus(d) === s)).length);
    let active = DOC_CHIPS.findIndex(([, t, s]) => t === ty && s === st);
    if (active < 0 && !ty) active = DOC_CHIPS.findIndex(([, t, s]) => s && s === st);
    bar.querySelectorAll('button[data-i]').forEach(b => { const i = Number(b.dataset.i); b.classList.toggle('on', i === active); b.querySelector('b').textContent = counts[i] || ''; b.setAttribute('aria-pressed', i === active); });
    const extra = !!(document.getElementById('inv-filter-from').value || document.getElementById('inv-filter-to').value || active < 0);
    bar.querySelector('.chip-more').classList.toggle('has-extra', extra);
  }

  // Document type as a segmented control (the select stays as the source of truth for the core logic)
  const DOC_SEG = [['INV', 'Invoice'], ['QUO', 'Quotation'], ['CRN', 'Credit note'], ['DBN', 'Debit note']];
  function buildDocTypeSeg() {
    const sel = document.getElementById('inv-doc-type'); if (!sel || document.getElementById('doc-seg')) return;
    const seg = document.createElement('div'); seg.id = 'doc-seg'; seg.className = 'seg'; seg.setAttribute('role', 'tablist');
    seg.innerHTML = DOC_SEG.map(([v, l]) => `<button type="button" role="tab" data-v="${v}"><span data-i18n>${l}</span></button>`).join('');
    seg.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b || sel.value === b.dataset.v) return;
      if (b.dataset.v === 'CRN' || b.dataset.v === 'DBN') { newDocument(b.dataset.v); } else { sel.value = b.dataset.v; onDocTypeChange(); }
      syncSeg();
    });
    const head = document.getElementById('form-title').closest('.justify-between');
    head.after(seg);
    sel.closest('div').classList.add('doc-type-field');
    wrap('onDocTypeChange', syncSeg); wrap('newDocument', syncSeg); wrap('loadDocIntoForm', syncSeg);
    syncSeg();
  }
  function syncSeg() {
    const sel = document.getElementById('inv-doc-type'), seg = document.getElementById('doc-seg'); if (!sel || !seg) return;
    seg.querySelectorAll('button').forEach(b => { const on = b.dataset.v === sel.value; b.classList.toggle('on', on); b.setAttribute('aria-selected', on); });
  }

  // Phones: a list row is one tap target; its actions open in a labelled bottom sheet instead of 9 tiny icons.
  const ACTION_NAMES = { 'fa-pen-to-square': 'Edit', 'fa-trash': 'Delete', 'fa-eye': 'View / Print', 'fa-copy': 'Duplicate', 'fa-ban': 'Cancel document',
    'fa-indian-rupee-sign': 'Record receipt', 'fa-whatsapp': 'Share on WhatsApp', 'fa-file-export': 'Convert to invoice' };
  function actionLabel(btn) {
    const ic = iconOf(btn); const cls = faOf(ic).find(c => ACTION_NAMES[c]);
    const title = btn.getAttribute('title');
    if (title) return title;
    if (cls) return ACTION_NAMES[cls];
    const txt = btn.textContent.trim();
    return txt === 'CN' ? 'Issue credit note' : txt === 'DN' ? 'Issue debit note' : txt || 'Action';
  }
  function openRowSheet(tr) {
    const btns = Array.from(tr.querySelectorAll('td:last-child button'));
    if (!btns.length) return;
    const cell = n => (tr.cells[n] ? tr.cells[n].textContent.trim() : '');
    const tb = tr.parentElement.id;
    const first = n => (tr.cells[n] && tr.cells[n].firstChild ? tr.cells[n].firstChild.textContent.trim() : cell(n));
    const head = tb === 'invoices-list-tbody' ? [first(4), `${cell(1)} · ${cell(2)} · ${cell(7)}`]
      : tb === 'dash-recent-table' ? [cell(2), `${cell(0)} · ${cell(1)} · ${cell(3)}`]
      : tb === 'items-list-tbody' ? [cell(0), `HSN ${cell(1)} · ${cell(2)} · ${cell(4)}`]
      : [first(0), cell(1)];
    window.__rowActions = btns;
    openSheet(`<div class="row-head"><b>${esc(head[0])}</b><span>${esc(head[1])}</span></div>` + btns.map((b, i) => {
      const ic = iconOf(b); const label = actionLabel(b), fa = faOf(ic);
      const danger = fa.includes('fa-trash') || fa.includes('fa-ban');
      const icon = !ic ? `<b style="font-size:12px">${esc(b.textContent.trim())}</b>` : ic.tagName === 'I' ? `<i class="${esc(ic.className.replace(/\bmr-\S+/g, ''))}"></i>` : ic.outerHTML;
      const tone = ic ? Array.from(ic.classList).filter(c => /^text-/.test(c)).join(' ') : '';
      return `<button type="button" class="act${danger ? ' danger' : ''}" onclick="HGI_M.runRowAction(${i})"><span class="ic ${tone}">${icon}</span>${esc(t(label))}</button>`;
    }).join(''));
  }
  function runRowAction(i) {
    const b = (window.__rowActions || [])[i];
    closeMore();
    if (b) setTimeout(() => b.click(), 60);
  }
  function installRowSheets() {
    document.addEventListener('click', e => {
      if (!mq.matches) return;
      const tr = e.target.closest('#invoices-list-tbody tr, #items-list-tbody tr, #customers-list-tbody tr, #dash-recent-table tr');
      if (!tr || e.target.closest('button, a, input, select, label') || tr.querySelector('td[colspan]')) return;
      openRowSheet(tr);
    });
  }

  // live grand total inside the sticky save bar
  function installLiveTotal() {
    const bar = document.querySelector('#invoice-form > .flex.flex-wrap.justify-end.gap-3:last-child');
    if (!bar || document.getElementById('live-total')) return;
    const box = document.createElement('div'); box.id = 'live-total';
    box.innerHTML = `<small data-i18n>Total</small><b>₹0.00</b>`;
    bar.prepend(box);
    const upd = () => { try { const d = collectDocFromForm(); box.querySelector('b').textContent = money(d.grandTotal || 0); } catch (e) { /* form not ready */ } };
    wrap('doRefreshForm', upd);
    upd();
  }

  /* ------------------------------------------------------------------ public helpers for inline handlers */
  window.HGI_M = {
    go(tab) { closeMore(); switchTab(tab); },
    close: closeMore,
    newDoc(type) { closeMore(); newDocument(type); },
    quotes() { closeMore(); document.getElementById('inv-filter-type').value = 'QUO'; switchTab('invoices'); },
    toggleTheme() { ui().theme = document.documentElement.classList.contains('dark') ? 'light' : 'dark'; saveState(); applyTheme(); closeMore(); },
    setTheme(v) { ui().theme = v; saveState(); applyTheme(); },
    setLang(v) { ui().lang = v; saveState(); i18n.setLang(v); renderPrefs(); setActiveNav(currentTab); },
    languageSheet() { openSheet(`<div class="grid grid-cols-3 gap-2.5">${Object.entries(i18n.LANGS).map(([k, v]) => `<button class="tile" onclick="HGI_M.setLang('${k}'); HGI_M.close()"><i class="fa-solid fa-language"></i><span>${v}</span></button>`).join('')}</div>`); },
    shareBackup, setPin, removePin,
    lock() { closeMore(); unlocked = false; showLock(); },
    about() { closeMore(); toast(`HGI Billing ${APP_VERSION} ${isNative ? '(Android)' : '(Web)'}`, 'info'); },
    enterDemo, exitDemo, undoRestore, runRowAction,
    restoreAndClose(ev) { const el = document.getElementById('onboarding'); ui().onboarded = true; if (el) el.remove(); importJSONBackup(ev); },
    sharePdf, savePdf
  };

  /* ------------------------------------------------------------------ hook into the core app */
  let currentTab = 'dashboard';
  function installHooks() {
    wrap('switchTab', (out, tab) => {
      currentTab = tab; setActiveNav(tab); closeMore(); if (mq.matches) window.scrollTo(0, 0);
      // answer the tap: the new screen fades in (opacity only, so sticky/fixed children are unaffected)
      const sec = document.getElementById(`tab-${tab}`);
      if (sec) { sec.classList.remove('tab-in'); void sec.offsetWidth; sec.classList.add('tab-in'); }
    });
    ['renderInvoiceList', 'renderItemList', 'renderCustomerList', 'renderDashboard', 'addInvoiceRow'].forEach(n => wrap(n, () => labelAll()));
    wrap('renderDashboard', () => renderHero());
    wrap('renderInvoiceList', () => syncDocChips());
    wrap('fitInvoicePages', () => scalePreview());
    window.addEventListener('resize', () => { if (previewDoc) scalePreview(); });
    wrap('saveState', () => mirrorState());
    wrap('loadSettingsForm', () => renderPrefs());

    // print / PDF: native Android print service instead of window.print()
    if (isNative) {
      window.triggerPrint = nativePrint;
      // downloads (CSV, JSON backup) → save to Downloads via the native plugin
      window.downloadBlob = async function (blob, filename) {
        try {
          const r = await Native.saveFile({ fileName: filename, base64: await blobToBase64(blob), mime: blob.type || 'application/octet-stream' });
          toast(`Saved to ${r.location || 'Downloads'}: ${filename}`);
        } catch (e) {
          try { await Native.shareFile({ fileName: filename, base64: await blobToBase64(blob), mime: blob.type || 'application/octet-stream' }); }
          catch (e2) { toast('Could not save file: ' + (e2.message || e2), 'error'); }
        }
      };
      // external links (WhatsApp wa.me, etc.) open in the right app
      const origOpen = window.open;
      window.open = function (url, target, features) {
        if (typeof url === 'string' && /^(https?:|mailto:|tel:|upi:|whatsapp:)/i.test(url)) { Native.openUrl({ url }).catch(() => toast('No app found to open this link', 'error')); return null; }
        return origOpen.call(window, url, target, features);
      };
    }

    // extra preview buttons: Share PDF / Save PDF
    const bar = document.querySelector('#preview-section > div:first-child > div:last-child');
    if (bar && !document.getElementById('btn-share-pdf')) {
      const share = document.createElement('button');
      share.id = 'btn-share-pdf'; share.className = 'bg-orange-500 text-white px-4 py-2 rounded text-sm font-semibold hover:bg-orange-600';
      share.innerHTML = '<i class="fa-solid fa-share-nodes mr-1"></i> <span>Share PDF</span>'; share.onclick = sharePdf;
      bar.prepend(share);
      if (isNative) {
        const save = document.createElement('button');
        save.id = 'btn-save-pdf'; save.className = 'bg-slate-700 text-white px-4 py-2 rounded text-sm font-semibold';
        save.innerHTML = '<i class="fa-solid fa-file-pdf mr-1"></i> <span>Save PDF</span>'; save.onclick = savePdf;
        bar.prepend(save);
      }
    }

    // auth: on Android the phone itself is the account — PIN lock instead of admin/123
    if (isNative) {
      window.checkAuth = function () {
        if (ui().pinHash && !unlocked) { document.getElementById('login-overlay').classList.add('hidden'); showLock(); }
        else { storeSet('session', 'hgi_auth_session', 'true'); showMainApp(); }
      };
      window.handleLogout = function () { if (ui().pinHash) { unlocked = false; showLock(); } else toast('Set an app PIN in Settings to lock the app', 'info'); };
    }
    wrap('showMainApp', () => { if (needsOnboarding() && !document.getElementById('onboarding')) showOnboarding(); });
  }

  /* ------------------------------------------------------------------ Android back button & lifecycle */
  function installNativeEvents() {
    if (!AppPlugin) return;
    AppPlugin.addListener('backButton', () => {
      if (document.getElementById('lock-screen') && !document.getElementById('lock-screen').classList.contains('hidden')) return AppPlugin.minimizeApp && AppPlugin.minimizeApp();
      const open = Array.from(document.querySelectorAll('.fixed.inset-0.z-50.flex')).filter(m => !m.classList.contains('hidden') && m.id !== 'login-overlay');
      if (open.length) return closeModal(open[open.length - 1].id);
      const ms = document.getElementById('more-sheet'); if (ms && ms.classList.contains('open')) return closeMore();
      if (!document.getElementById('preview-section').classList.contains('hidden')) { document.getElementById('preview-section').classList.add('hidden'); return window.scrollTo({ top: 0 }); }
      if (currentTab !== 'dashboard') return switchTab('dashboard');
      if (AppPlugin.minimizeApp) AppPlugin.minimizeApp(); else AppPlugin.exitApp();
    });
    AppPlugin.addListener('appStateChange', ({ isActive }) => {
      if (!isActive) { backgroundAt = Date.now(); if (mirrorTimer) { clearTimeout(mirrorTimer); Native.writeState({ key: 'state', data: JSON.stringify(state) }).catch(() => {}); } return; }
      if (restoreAfterPrint) restoreAfterPrint();
      if (ui().pinHash && backgroundAt && Date.now() - backgroundAt > 120000) { unlocked = false; showLock(); }
    });
  }

  /* ------------------------------------------------------------------ toasts: never more than 2 on screen */
  function limitToasts() {
    const box = document.getElementById('toast-container'); if (!box) return;
    new MutationObserver(() => { while (box.children.length > 2) box.firstElementChild.remove(); }).observe(box, { childList: true });
  }

  /* ------------------------------------------------------------------ boot */
  window.onload = async function () {
    await restoreFromMirror();
    installHooks();
    buildShell();                                // nav must exist before the app's first switchTab()
    demoBanner();
    checkRupeeGlyph();
    enhanceDashboard();
    enhanceEditor();
    buildDocChips();
    if (window.HGI_STUDIO) HGI_STUDIO.shell();   // v8 interface: icons, rail / dock, bento dashboard, live paper
    installRowSheets();
    limitToasts();
    initApp();                                   // the original v6 app start
    installLiveTotal();
    applyTheme();
    i18n.setLang(ui().lang || 'en');
    setActiveNav('dashboard');
    labelAll();
    renderPrefs();
    installNativeEvents();
    if (window.HGI_STUDIO) HGI_STUDIO.ready();
    applyTheme();                                // system bar colours from the final page colour
    document.documentElement.classList.toggle('is-native', isNative);
    if (isNative) {
      const ro = document.getElementById('login-overlay');
      if (ro && !ro.classList.contains('hidden') && !ui().pinHash) { storeSet('session', 'hgi_auth_session', 'true'); showMainApp(); }
    }
    window.HGI_READY = true;
  };
})();
