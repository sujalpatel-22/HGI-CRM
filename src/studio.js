/* =====================================================================
   HGI Billing v8 — "Studio" interface layer
   Custom icon set, app shell (side rail / floating dock), bento dashboard with an interactive cash-flow
   chart, live invoice paper beside the editor, preview desk, grouped lists and settings index.
   Reads the core's data and functions; never changes GST calculations, stored data or the printed invoice.
   ===================================================================== */
(function () {
  'use strict';
  const S = window.HGI_STUDIO = {};
  const $ = id => document.getElementById(id);
  const i18n = () => window.HGI_I18N || { t: s => s, lang: 'en', translateTree() {} };
  const t = s => i18n().t(s);
  const esc2 = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const reduced = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  const isPhone = () => window.innerWidth < 768;
  const wrap = (name, after) => {
    const orig = window[name]; if (typeof orig !== 'function') return;
    window[name] = function (...a) { const out = orig.apply(this, a); try { after.apply(this, [out, ...a]); } catch (e) { console.error('[studio]', name, e); } return out; };
  };

  /* ------------------------------------------------------------------ icon set (24px grid, 1.75 stroke, saffron accent stroke) */
  const ICONS = {
    home: '<path d="M3.5 10.2 12 3.8l8.5 6.4V19a1.2 1.2 0 0 1-1.2 1.2H4.7A1.2 1.2 0 0 1 3.5 19z"/><path class="ac" d="M9.5 20.2v-5.2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v5.2"/>',
    docs: '<path d="M8.5 20.6h9a2 2 0 0 0 2-2V8.4"/><rect x="4.5" y="3.2" width="12" height="15" rx="2"/><path d="M8 7.6h5M8 10.9h5"/><path class="ac" d="M8 14.2h3"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    buyers: '<circle cx="9" cy="8.2" r="3.2"/><path d="M3.2 19.5a5.8 5.8 0 0 1 11.6 0"/><circle class="ac" cx="17.2" cy="9.3" r="2.4"/><path class="ac" d="M15.9 14.4a4.6 4.6 0 0 1 5.1 4.6"/>',
    more: '<rect x="3.8" y="3.8" width="6.6" height="6.6" rx="1.8"/><rect class="ac" x="13.6" y="3.8" width="6.6" height="6.6" rx="3.3"/><rect x="3.8" y="13.6" width="6.6" height="6.6" rx="1.8"/><rect x="13.6" y="13.6" width="6.6" height="6.6" rx="1.8"/>',
    returns: '<path d="M3.5 9 12 4l8.5 5"/><path d="M5.8 9.8v7.6M10 9.8v7.6M14 9.8v7.6M18.2 9.8v7.6"/><path d="M3.5 20.2h17"/><circle class="acf" cx="12" cy="7" r="1.05"/>',
    items: '<path d="M12 3.2 20 7.6v8.8l-8 4.4-8-4.4V7.6z"/><path d="M4.3 7.8 12 12l7.7-4.2M12 12v8.6"/><path class="ac" d="m8 5.4 8 4.4"/>',
    settings: '<path d="M4 7h8.3M16.7 7H20M4 17h3.3M11.7 17H20"/><circle class="ac" cx="14.5" cy="7" r="2.2"/><circle cx="9.5" cy="17" r="2.2"/>',
    invoice: '<path d="M6 3.2h12a.8.8 0 0 1 .8.8v16.6l-2.3-1.5-2.3 1.5-2.2-1.5-2.3 1.5-2.3-1.5-2.2 1.5V4a.8.8 0 0 1 .8-.8z"/><path d="M9 8h6M9 11.5h6"/><path class="ac" d="M9 15h3"/>',
    quote: '<path d="M11 20.8H6.8A1.8 1.8 0 0 1 5 19V5a1.8 1.8 0 0 1 1.8-1.8H13l5 5v1.6"/><path d="M13 3.2V8h5M8.5 12h5M8.5 15.5h2.5"/><path class="ac" d="m13.6 18.3 5.3-5.3a1.4 1.4 0 0 1 2 2l-5.3 5.3-2.6.6z"/>',
    credit: '<path d="M6 3.2h12v17.6l-3-1.8-3 1.8-3-1.8-3 1.8z"/><path d="M9 7.6h6"/><path class="ac" d="M15 13H9.4m0 0 2.1-2.1M9.4 13l2.1 2.1"/>',
    debit: '<path d="M6 3.2h12v17.6l-3-1.8-3 1.8-3-1.8-3 1.8z"/><path d="M9 7.6h6"/><path class="ac" d="M12 10.4v5.4M9.3 13.1h5.4"/>',
    rupee: '<circle cx="12" cy="12" r="8.6"/><path class="ac" d="M9.3 7.9h5.4M9.3 10.5h5.4M11.1 7.9c2.6 0 2.6 4.8 0 4.8H9.5l4 3.6"/>',
    alert: '<path d="M10.4 4.3 2.9 17.6a1.8 1.8 0 0 0 1.6 2.7h15a1.8 1.8 0 0 0 1.6-2.7L13.6 4.3a1.8 1.8 0 0 0-3.2 0z"/><path class="ac" d="M12 9.4v4.2"/><circle class="acf" cx="12" cy="16.7" r="1"/>',
    info: '<circle cx="12" cy="12" r="8.6"/><path class="ac" d="M12 11v5.2"/><circle class="acf" cx="12" cy="7.9" r="1"/>',
    error: '<circle cx="12" cy="12" r="8.6"/><path class="ac" d="M12 7.4v5.4"/><circle class="acf" cx="12" cy="16.2" r="1"/>',
    check: '<circle cx="12" cy="12" r="8.6"/><path class="ac" d="m8.3 12.3 2.5 2.5 5-5.3"/>',
    tick: '<path d="m5 12.5 4.5 4.5L19 7.5"/>',
    chevr: '<path d="m9.5 6 6 6-6 6"/>', chevl: '<path d="m14.5 6-6 6 6 6"/>', chevd: '<path d="m6 9.5 6 6 6-6"/>',
    search: '<circle cx="11" cy="11" r="6.6"/><path class="ac" d="m16 16 4 4"/>',
    share: '<circle cx="17.5" cy="5.8" r="2.3"/><circle cx="6.5" cy="12" r="2.3"/><circle cx="17.5" cy="18.2" r="2.3"/><path class="ac" d="m8.6 10.9 6.9-3.9M8.6 13.1l6.9 3.9"/>',
    print: '<path d="M7 8.2V3.8h10v4.4"/><rect x="3.5" y="8.2" width="17" height="8.3" rx="2"/><path d="M7 13.5h10v6.7H7z"/><circle class="acf" cx="17" cy="11.2" r="1"/>',
    pdf: '<path d="M14 3.2H7A1.8 1.8 0 0 0 5.2 5v14A1.8 1.8 0 0 0 7 20.8h10a1.8 1.8 0 0 0 1.8-1.8V8z"/><path d="M14 3.2V8h4.8"/><path class="ac" d="M12 10.6v6m0 0-2.4-2.4M12 16.6l2.4-2.4"/>',
    logout: '<path d="M14 4.5h3.5A1.5 1.5 0 0 1 19 6v12a1.5 1.5 0 0 1-1.5 1.5H14"/><path class="ac" d="M10.5 8.2 6.7 12l3.8 3.8M6.7 12H15"/>',
    sun: '<circle class="ac" cx="12" cy="12" r="3.8"/><path d="M12 2.8v2M12 19.2v2M2.8 12h2M19.2 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M5.5 18.5l1.4-1.4M17.1 6.9l1.4-1.4"/>',
    moon: '<path d="M19.5 14.6A8 8 0 0 1 9.4 4.5a8 8 0 1 0 10.1 10.1z"/><circle class="acf" cx="16.6" cy="5.6" r="1"/><circle class="acf" cx="19.6" cy="9" r=".7"/>',
    lock: '<rect x="5" y="10.5" width="14" height="10" rx="2.2"/><path d="M8.2 10.5V8a3.8 3.8 0 0 1 7.6 0v2.5"/><circle class="acf" cx="12" cy="15.5" r="1.4"/>',
    lang: '<path d="M4 5.5h8M8 3.5v2M5.5 5.5c.6 3 2.9 5.6 5.8 6.8M10.5 5.5c-.7 3.3-3 6-6.3 7.3"/><path class="ac" d="m12.5 20.5 3.7-9 3.8 9M13.7 17.6h5"/>',
    backup: '<path d="M7 18.5h-.5a4 4 0 0 1-.6-8 6 6 0 0 1 11.6-1.2 4.4 4.4 0 0 1 .5 9.2H17"/><path class="ac" d="M12 20v-7.5m0 0-2.8 2.8M12 12.5l2.8 2.8"/>',
    calendar: '<rect x="3.8" y="5" width="16.4" height="15.2" rx="2.2"/><path d="M3.8 9.6h16.4M8 3v3.6M16 3v3.6"/><circle class="acf" cx="15.6" cy="14.6" r="1.4"/>',
    userplus: '<circle cx="9.5" cy="8" r="3.4"/><path d="M3.5 19.5a6 6 0 0 1 12 0"/><path class="ac" d="M18.5 8.5v6M15.5 11.5h6"/>',
    boxplus: '<path d="M11 20.5 4 16.6V7.6l8-4.4 8 4.4v3.4"/><path d="M4.3 7.8 12 12l7.7-4.2M12 12v4"/><path class="ac" d="M18 14v6M15 17h6"/>',
    spark: '<path class="ac" d="M12 3.5 13.7 9.3 19.5 11 13.7 12.7 12 18.5 10.3 12.7 4.5 11 10.3 9.3z"/><path d="M18.5 3.5v3M17 5h3"/>',
    trend: '<path d="M3.5 16.5 9 11l3.5 3.5 8-8"/><path class="ac" d="M15 6.5h5.5V12"/>',
    wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5h11v2.5"/><rect x="4" y="7.5" width="16.5" height="12" rx="2.4"/><path class="ac" d="M15.8 13.5h1.6"/>',
    eye: '<path d="M2.8 12S6.2 5.5 12 5.5 21.2 12 21.2 12 17.8 18.5 12 18.5 2.8 12 2.8 12z"/><circle class="ac" cx="12" cy="12" r="2.8"/>',
    pen: '<path d="M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16z"/><path class="ac" d="m13.5 6.5 4 4"/>',
    trash: '<path d="M4.5 6.8h15M9.5 6.8V4.5h5v2.3"/><path d="M6.5 6.8 7.4 19a1.6 1.6 0 0 0 1.6 1.5h6a1.6 1.6 0 0 0 1.6-1.5l.9-12.2"/><path class="ac" d="M10.2 10.5v6M13.8 10.5v6"/>',
    copy: '<rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2.2"/><path class="ac" d="M15.5 8.5V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v7.5a2 2 0 0 0 2 2h2.5"/>',
    ban: '<circle cx="12" cy="12" r="8.6"/><path class="ac" d="m6 6 12 12"/>',
    clock: '<circle cx="12" cy="12" r="8.6"/><path class="ac" d="M12 7.5V12l3 2"/>',
    filter: '<path d="M4 5.5h16l-6.2 7.2v5.5l-3.6 1.8v-7.3z"/>',
    close: '<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>',
    tag: '<path d="M3.8 12.6V5.2a1.4 1.4 0 0 1 1.4-1.4h7.4l7.6 7.6a1.4 1.4 0 0 1 0 2l-6.8 6.8a1.4 1.4 0 0 1-2 0z"/><circle class="acf" cx="8.2" cy="8.2" r="1.5"/>',
    truck: '<path d="M3.5 6.5h10.5v9.5H3.5zM14 9.5h3.6l2.9 3.2V16H14"/><circle class="ac" cx="7.2" cy="17.4" r="1.8"/><circle class="ac" cx="17" cy="17.4" r="1.8"/>',
    note: '<path d="M6.5 3.8h11a1.5 1.5 0 0 1 1.5 1.5v13.4a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 5 18.7V5.3a1.5 1.5 0 0 1 1.5-1.5z"/><path d="M8.5 8h7M8.5 11.5h7"/><path class="ac" d="M8.5 15h4"/>',
    link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path class="ac" d="M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/>',
    user: '<circle cx="12" cy="8.2" r="3.6"/><path d="M5 20a7 7 0 0 1 14 0"/><circle class="acf" cx="18.5" cy="5" r="1"/>',
    building: '<path d="M4.5 20.5V5.5l8-2.3v17.3M12.5 8.5l7 2v10"/><path d="M3 20.5h18"/><path class="ac" d="M7.5 8.5v.01M7.5 12v.01M7.5 15.5v.01M15.8 13.5v.01M15.8 17v.01"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m10.9 12.1 8.6-8.6"/><path class="ac" d="m16 7 2.5 2.5M13.8 9.2l1.8 1.8"/>',
    percent: '<path d="M18 6 6 18"/><circle class="ac" cx="7.5" cy="7.5" r="2.3"/><circle class="ac" cx="16.5" cy="16.5" r="2.3"/>',
    list: '<path d="M9 6.5h11M9 12h11M9 17.5h11"/><circle class="acf" cx="4.8" cy="6.5" r="1.2"/><circle class="acf" cx="4.8" cy="12" r="1.2"/><circle class="acf" cx="4.8" cy="17.5" r="1.2"/>',
    qr: '<rect x="4" y="4" width="6" height="6" rx="1.2"/><rect x="14" y="4" width="6" height="6" rx="1.2"/><rect x="4" y="14" width="6" height="6" rx="1.2"/><path class="ac" d="M14 14h2.6v2.6H14zM17.4 17.4H20V20h-2.6z"/>',
    save: '<path d="M5.5 3.8h10l3 3v11.7a1.7 1.7 0 0 1-1.7 1.7H5.5a1.7 1.7 0 0 1-1.7-1.7V5.5a1.7 1.7 0 0 1 1.7-1.7z"/><path d="M8 3.8v4.5h6.5V3.8"/><path class="ac" d="M8 20.2v-5.4h8v5.4"/>',
    refresh: '<path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3"/><path class="ac" d="M19.8 4.5v4h-4"/>',
    flask: '<path d="M9.5 3.5h5M10.5 3.5v5.2L5 18.3A1.5 1.5 0 0 0 6.3 20.5h11.4a1.5 1.5 0 0 0 1.3-2.2l-5.5-9.6V3.5"/><path class="ac" d="M7.5 14.5h9"/>',
    palette: '<path d="M12 3.5a8.5 8.5 0 1 0 0 17c1.2 0 1.8-.8 1.8-1.7 0-1.2-1-1.5-1-2.6 0-.9.7-1.6 1.6-1.6H17a3.5 3.5 0 0 0 3.5-3.5c0-4.3-3.8-7.6-8.5-7.6z"/><circle class="acf" cx="8" cy="11" r="1.2"/><circle class="acf" cx="11" cy="7.6" r="1.2"/><circle class="acf" cx="15.4" cy="8.4" r="1.2"/>',
    chat: '<path d="M4.4 19.6 5.6 16A8 8 0 1 1 8.4 18.6z"/><path class="ac" d="M8.6 12h.01M12 12h.01M15.4 12h.01"/>',
    arrowr: '<path d="M5 12h14"/><path class="ac" d="m13 6 6 6-6 6"/>',
    ring: '<circle cx="12" cy="12" r="8.6"/><path class="ac" d="M12 3.4a8.6 8.6 0 0 1 8.6 8.6"/>'
  };
  const ic = (n, cls) => `<svg class="ic${cls ? ' ' + cls : ''}" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="#i-${n}"></use></svg>`;
  S.ic = ic;
  function sprite() {
    if ($('hgi-icons')) return;
    const acc = v => v.replace(/class="ac"/g, 'style="stroke:var(--ic-ac,#f58220)"').replace(/class="acf"/g, 'style="fill:var(--ic-ac,#f58220);stroke:none"');
    const syms = Object.entries(ICONS).map(([k, v]) => `<symbol id="i-${k}" viewBox="0 0 24 24">${acc(v)}</symbol>`).join('');
    document.body.insertAdjacentHTML('afterbegin', `<svg id="hgi-icons" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">${syms}</svg>`);
  }
  // swap a Font Awesome <i> for a studio icon (keeps the element's other classes for spacing)
  const FA_MAP = { 'fa-house': 'home', 'fa-file-lines': 'docs', 'fa-plus': 'plus', 'fa-users': 'buyers', 'fa-grip': 'more', 'fa-box': 'items', 'fa-landmark': 'returns',
    'fa-file-signature': 'quote', 'fa-gear': 'settings', 'fa-database': 'backup', 'fa-moon': 'moon', 'fa-sun': 'sun', 'fa-language': 'lang', 'fa-lock': 'lock',
    'fa-shield-halved': 'lock', 'fa-circle-info': 'info', 'fa-file-invoice-dollar': 'invoice', 'fa-rotate-left': 'credit', 'fa-file-circle-plus': 'debit',
    'fa-user-plus': 'userplus', 'fa-box-open': 'boxplus', 'fa-pen-to-square': 'pen', 'fa-trash': 'trash', 'fa-eye': 'eye', 'fa-copy': 'copy', 'fa-ban': 'ban',
    'fa-indian-rupee-sign': 'rupee', 'fa-file-export': 'arrowr', 'fa-floppy-disk': 'save', 'fa-print': 'print', 'fa-share-nodes': 'share', 'fa-file-pdf': 'pdf',
    'fa-rotate-right': 'refresh', 'fa-list': 'list', 'fa-percent': 'percent', 'fa-truck': 'truck', 'fa-note-sticky': 'note', 'fa-link': 'link',
    'fa-scale-balanced': 'tag', 'fa-receipt': 'invoice', 'fa-user': 'user', 'fa-building': 'building', 'fa-palette': 'palette', 'fa-building-columns': 'returns',
    'fa-key': 'key', 'fa-cloud-arrow-down': 'backup', 'fa-qrcode': 'qr', 'fa-file-csv': 'pdf', 'fa-flask': 'flask', 'fa-right-from-bracket': 'logout', 'fa-sliders': 'filter' };
  function swapIcons(root) {
    (root || document).querySelectorAll('i.fa-solid, i.fa-regular').forEach(i => {
      const k = Array.from(i.classList).find(c => FA_MAP[c]); if (!k) return;
      const tmp = document.createElement('span'); tmp.innerHTML = ic(FA_MAP[k]);
      const svg = tmp.firstChild; svg.dataset.fa = Array.from(i.classList).filter(c => /^fa-/.test(c)).join(' ');
      i.classList.forEach(c => { if (!/^fa-|^fa$/.test(c)) svg.classList.add(c); });
      i.replaceWith(svg);
    });
  }
  S.swapIcons = swapIcons;

  /* ------------------------------------------------------------------ formatting helpers */
  const fmt = n => (typeof money === 'function' ? money(n) : '₹' + Number(n || 0).toFixed(2));
  const compact = n => { const a = Math.abs(n); const s = a >= 1e7 ? (a / 1e7).toFixed(a >= 1e8 ? 0 : 1) + 'Cr' : a >= 1e5 ? (a / 1e5).toFixed(a >= 1e6 ? 0 : 1) + 'L' : a >= 1e3 ? (a / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K' : Math.round(a) + ''; return (n < 0 ? '−' : '') + '₹' + s.replace('.0', ''); };
  const monthName = (k, len) => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString(i18n().lang === 'en' ? 'en-IN' : i18n().lang + '-IN', { month: len || 'short' }); };
  const monthLong = k => { const [y, m] = k.split('-').map(Number); return new Date(y, m - 1, 1).toLocaleString(i18n().lang === 'en' ? 'en-IN' : i18n().lang + '-IN', { month: 'long', year: 'numeric' }); };
  const addMonths = (k, n) => { const [y, m] = k.split('-').map(Number); const d = new Date(y, m - 1 + n, 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const TONES = 6;
  const toneOf = name => { let h = 0; String(name || '').split('').forEach(c => { h = (h * 31 + c.charCodeAt(0)) >>> 0; }); return h % TONES; };
  function toneAvatars(root) { (root || document).querySelectorAll('.avatar:not([data-tone])').forEach(a => { const row = a.closest('tr, .owe-row'); a.dataset.tone = toneOf(row ? row.textContent.replace(/₹.*/, '') : a.textContent); }); }
  S.toneAvatars = toneAvatars;

  /* ------------------------------------------------------------------ shell: side rail (tablet/desktop) */
  const NAV = { dashboard: ['home', 'Dashboard'], invoices: ['docs', 'Documents'], returns: ['returns', 'GST Returns'], items: ['items', 'Items'], customers: ['buyers', 'Buyers'], settings: ['settings', 'Settings'] };
  const railBtn = k => `<button type="button" class="rail-btn" data-tab="${k}" title="${NAV[k][1]}">${ic(NAV[k][0])}<span data-i18n>${NAV[k][1]}</span></button>`;
  function buildRail() {
    if ($('rail')) return;
    const r = document.createElement('aside');
    r.id = 'rail'; r.className = 'no-print'; r.setAttribute('aria-label', 'Main navigation');
    r.innerHTML = `
      <div class="rail-brand"><span class="rail-logo"><img id="rail-logo" alt=""></span><div class="rail-co"><b id="rail-co-name">HGI Billing</b><small id="rail-co-sub"></small></div></div>
      <button type="button" class="rail-new" id="rail-new" title="New invoice">${ic('plus')}<span data-i18n>New invoice</span></button>
      <nav class="rail-nav">
        <i class="rail-ind" aria-hidden="true"></i>
        <span class="rail-cap" data-i18n>Workspace</span>${railBtn('dashboard')}${railBtn('invoices')}${railBtn('returns')}
        <span class="rail-cap" data-i18n>Records</span>${railBtn('items')}${railBtn('customers')}
      </nav>
      <div class="rail-foot">${railBtn('settings')}
        <button type="button" class="rail-btn" id="rail-theme" title="Theme">${ic('moon', 'only-light')}${ic('sun', 'only-dark')}<span data-i18n>Theme</span></button>
        <button type="button" class="rail-btn" id="rail-out" title="Lock / sign out">${ic('logout')}<span data-i18n>Sign out</span></button>
      </div>`;
    r.addEventListener('click', e => {
      const b = e.target.closest('button'); if (!b) return;
      if (b.id === 'rail-new') return newDocument('INV');
      if (b.id === 'rail-theme') return window.HGI_M && HGI_M.toggleTheme();
      if (b.id === 'rail-out') return handleLogout();
      if (b.dataset.tab) switchTab(b.dataset.tab);
    });
    const app = $('app-container'); app.prepend(r);
    document.documentElement.classList.add('studio');
    syncCompany();
  }
  function syncCompany() {
    const co = (typeof state !== 'undefined' && state && state.company) || {};
    const img = $('rail-logo'), hl = $('header-logo'); if (img && hl) img.src = hl.src;
    if ($('rail-co-name')) $('rail-co-name').textContent = co.name || 'HGI Billing';
    if ($('rail-co-sub')) $('rail-co-sub').textContent = co.gstin || t('GST billing');
    const av = $('app-avatar'); if (av) av.textContent = (typeof initials === 'function' ? initials(co.name || 'HGI') : 'HG');
  }
  function setRailActive(tab) {
    const r = $('rail'); if (!r) return;
    let on = null;
    r.querySelectorAll('.rail-btn[data-tab]').forEach(b => { const a = b.dataset.tab === tab; b.classList.toggle('on', a); if (a) { on = b; b.setAttribute('aria-current', 'page'); } else b.removeAttribute('aria-current'); });
    r.querySelector('#rail-new').classList.toggle('on', tab === 'create-invoice');
    const ind = r.querySelector('.rail-ind'), nav = r.querySelector('.rail-nav');
    if (on && nav.contains(on)) { ind.style.opacity = 1; ind.style.transform = `translateY(${on.offsetTop}px)`; ind.style.height = on.offsetHeight + 'px'; }
    else ind.style.opacity = 0;
  }

  /* ------------------------------------------------------------------ shell: phone app bar + dock icons */
  function phoneChrome() {
    const header = document.querySelector('#app-container > header');
    if (header && !$('app-avatar')) {
      const right = document.createElement('button');
      right.type = 'button'; right.id = 'app-avatar'; right.className = 'app-avatar'; right.setAttribute('aria-label', 'More');
      right.onclick = () => { const m = document.querySelector('#bottom-nav button[data-tab="more"]'); if (m) m.click(); };
      header.firstElementChild.appendChild(right);
      const onScroll = () => header.classList.toggle('scrolled', window.scrollY > 6);
      window.addEventListener('scroll', onScroll, { passive: true }); onScroll();
    }
    const nav = $('bottom-nav');
    if (nav && !nav.classList.contains('dock')) { nav.classList.add('dock'); swapIcons(nav); }
  }

  /* ------------------------------------------------------------------ dashboard: bento layout */
  function dashLayout() {
    const sec = $('tab-dashboard'); if (!sec || $('bento')) return;
    const head = sec.querySelector('.dash-head'), h2 = head && head.querySelector('h2');
    if (head && h2 && !head.querySelector('.dh-titles')) {
      const box = document.createElement('div'); box.className = 'dh-titles';
      box.innerHTML = `<div class="eyebrow" id="dash-date"></div>`;
      h2.before(box); box.appendChild(h2);
      box.insertAdjacentHTML('beforeend', `<p class="dh-greet" id="dash-greet"></p>`);
      head.insertAdjacentHTML('beforeend', `<div class="dh-actions">
        <button type="button" class="btn-ghost" onclick="switchTab('customers'); openCustomerModal()">${ic('userplus')}<span data-i18n>Add buyer</span></button>
        <button type="button" class="btn-ghost" onclick="newDocument('QUO')">${ic('quote')}<span data-i18n>Quotation</span></button>
        <button type="button" class="btn-primary" onclick="newDocument('INV')">${ic('plus')}<span data-i18n>New invoice</span></button></div>`);
    }
    const hero = $('hero'), strip = $('stat-strip'), qa = $('quick-actions');
    const card = id => { const el = $(id); return el ? el.closest('.bg-white') : null; };
    const alerts = card('dash-alerts'), recent = card('dash-recent-table'), owes = card('dash-top-buyers');
    const bento = document.createElement('div'); bento.id = 'bento'; bento.className = 'no-print';
    const ring = document.createElement('article'); ring.id = 'ring-card'; ring.className = 'card b-ring';
    const flow = document.createElement('article'); flow.id = 'flow-card'; flow.className = 'card b-flow';
    flow.innerHTML = `<div class="card-h"><div><h3>${ic('trend')}<span data-i18n>Cash flow</span></h3><p class="card-sub" id="flow-sub"></p></div>
      <div class="flow-keys" role="group" aria-label="Series"><button type="button" class="fk fk-billed on" data-s="billed" aria-pressed="true"><i></i><span data-i18n>Billed</span></button><button type="button" class="fk fk-rec on" data-s="received" aria-pressed="true"><i></i><span data-i18n>Received</span></button></div></div>
      <div class="flow-read" id="flow-read" aria-live="polite"></div>
      <div class="flow-plot" id="flow-plot"></div>`;
    hero.classList.add('b-hero');
    if (qa) qa.classList.add('b-qa');
    strip.classList.add('b-kpis');
    [alerts, recent, owes].forEach((c, i) => { if (c) c.classList.add('card', ['b-alerts', 'b-recent', 'b-owes'][i]); });
    bento.append(hero, ring);
    if (qa) bento.append(qa);
    bento.append(strip, flow);
    if (alerts) bento.append(alerts);
    if (recent) bento.append(recent);
    if (owes) bento.append(owes);
    head.after(bento);
    // card headings get an icon chip
    const headIcon = (c, n) => { const h = c && c.querySelector('h3'); if (h && !h.querySelector('.ic')) h.insertAdjacentHTML('afterbegin', ic(n)); };
    headIcon(alerts, 'spark'); headIcon(recent, 'docs'); headIcon(owes, 'wallet');
    flow.querySelector('.flow-keys').addEventListener('click', e => {
      const b = e.target.closest('.fk'); if (!b) return;
      const on = !b.classList.contains('on');
      if (!on && flow.querySelectorAll('.fk.on').length === 1) return;          // keep at least one series
      b.classList.toggle('on', on); b.setAttribute('aria-pressed', on);
      flow.classList.toggle('hide-' + b.dataset.s, !on);
    });
    swapIcons(sec);
  }

  // ---- dashboard data (same rules as the core dashboard: liveDocs, signed totals, payments incl. TDS)
  function fyMonths() {
    const start = parseISO(fyStartISO(todayISO())), keys = [];
    for (let m = 0; m < 12; m++) { const d = new Date(start.getFullYear(), start.getMonth() + m, 1); keys.push(toISO(d).slice(0, 7)); }
    return keys;
  }
  function flows(keys) {
    const billed = keys.map(() => 0), received = keys.map(() => 0);
    liveDocs().forEach(d => { const k = keys.indexOf(monthKey(d.date)); if (k >= 0) billed[k] += signed(d) * (d.grandTotal || 0); });
    state.invoices.forEach(d => (d.payments || []).forEach(p => { const k = keys.indexOf(monthKey(p.date)); if (k >= 0) received[k] += (Number(p.amount) || 0) + (Number(p.tds) || 0); }));
    return { billed: billed.map(round2), received: received.map(round2) };
  }

  function renderDash() {
    if (!$('bento') || typeof state === 'undefined' || !state) return;
    const now = new Date(), hr = now.getHours();
    const loc = i18n().lang === 'en' ? 'en-IN' : i18n().lang + '-IN';
    if ($('dash-date')) $('dash-date').textContent = now.toLocaleDateString(loc, { weekday: 'long', day: 'numeric', month: 'long' });
    if ($('dash-greet')) $('dash-greet').textContent = t(hr < 12 ? 'Good morning.' : hr < 17 ? 'Good afternoon.' : 'Good evening.') + ' ' + t('Here is where your money stands.');
    animateAmount($('hero-amount'));
    renderKpis(); renderRing(); renderFlow(); polishAlerts(); toneAvatars($('tab-dashboard'));
    i18n().translateTree($('bento'));
  }
  S.renderDash = renderDash;

  // hero amount: characters rise in sequence (text content stays exactly the amount)
  function animateAmount(el) {
    if (!el) return;
    const v = el.textContent; if (el.dataset.v === v) return; el.dataset.v = v;
    if (reduced()) return;
    let i = 0;
    const walk = node => Array.from(node.childNodes).forEach(n => {
      if (n.nodeType === 3) { const f = document.createDocumentFragment(); n.nodeValue.split('').forEach(ch => { const s = document.createElement('span'); s.className = 'ch'; s.style.animationDelay = (i++ * 28) + 'ms'; s.textContent = ch; f.appendChild(s); }); n.replaceWith(f); }
      else if (n.nodeType === 1) walk(n);
    });
    walk(el);
  }

  function spark(vals, cls) {
    const w = 84, h = 30, max = Math.max(...vals.map(Math.abs), 1), n = vals.length;
    const pts = vals.map((v, i) => [i * (w / (n - 1)), h - 3 - Math.max(0, v) / max * (h - 8)]);
    const d = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    return `<svg class="spark ${cls || ''}" viewBox="0 0 ${w} ${h}" aria-hidden="true"><path class="sp-area" d="${d} L${w} ${h} L0 ${h}Z"/><path class="sp-line" d="${d}"/><circle cx="${pts[n - 1][0]}" cy="${pts[n - 1][1]}" r="2.6"/></svg>`;
  }
  function delta(cur, prev) {
    if (!prev && !cur) return `<span class="delta flat">—</span>`;
    if (!prev) return `<span class="delta up">${ic('trend')}<span data-i18n>New</span></span>`;
    const p = Math.round((cur - prev) / Math.abs(prev) * 100);
    return `<span class="delta ${p > 0 ? 'up' : p < 0 ? 'down' : 'flat'}">${p > 0 ? '▲' : p < 0 ? '▼' : ''} ${Math.abs(p)}%</span>`;
  }
  function renderKpis() {
    const strip = $('stat-strip'); if (!strip) return;
    const cur = todayISO().slice(0, 7), keys = [-5, -4, -3, -2, -1, 0].map(n => addMonths(cur, n));
    const sums = keys.map(k => gstSummaryFor(k));
    const rec = keys.map(() => 0);
    state.invoices.forEach(d => (d.payments || []).forEach(p => { const k = keys.indexOf(monthKey(p.date)); if (k >= 0) rec[k] += (Number(p.amount) || 0) + (Number(p.tds) || 0); }));
    const monthDocs = liveDocs().filter(d => monthKey(d.date) === cur && d.docType === 'INV').length;
    const quotes = state.invoices.filter(d => d.docType === 'QUO' && displayStatus(d) === 'Open');
    const qv = quotes.reduce((a, d) => a + (d.grandTotal || 0), 0);
    const tile = (cls, label, val, sub, chart) => `<div class="kpi ${cls}"><div class="kpi-top"><span class="kpi-l" data-i18n>${label}</span>${chart || ''}</div><b class="kpi-v">${esc2(val)}</b><div class="kpi-s">${sub}</div></div>`;
    const tax = sums[5].tax;
    strip.innerHTML =
      tile('k-sales', 'Sales this month', fmt(sums[5].taxable), `${delta(sums[5].taxable, sums[4].taxable)}<small>${monthDocs} ${t(monthDocs === 1 ? 'invoice' : 'invoices')}</small>`, spark(sums.map(s => s.taxable), 'sp-ink')) +
      tile('k-gst', 'Output GST this month', fmt(tax), `${delta(tax, sums[4].tax)}<small data-i18n>for GSTR-3B</small>`, spark(sums.map(s => s.tax), 'sp-saffron')) +
      tile('k-rec', 'Received this month', fmt(round2(rec[5])), `${delta(rec[5], rec[4])}<small data-i18n>incl. TDS</small>`, spark(rec, 'sp-mint')) +
      tile('k-quo', 'Open quotations', fmt(round2(qv)), `<span class="delta flat">${quotes.length}</span><small data-i18n>${quotes.length === 1 ? 'awaiting reply' : 'awaiting replies'}</small>`, '');
    strip.querySelector('.k-quo').onclick = () => { $('inv-filter-type').value = 'QUO'; $('inv-filter-status').value = ''; switchTab('invoices'); };
  }

  function renderRing() {
    const box = $('ring-card'); if (!box) return;
    const today = todayISO(), fyStart = fyStartISO(today), fyEnd = fyEndISO(today);
    const fyDocs = liveDocs().filter(d => d.date >= fyStart && d.date <= fyEnd);
    const billed = round2(fyDocs.reduce((a, d) => a + signed(d) * (d.grandTotal || 0), 0));
    let received = 0;
    state.invoices.forEach(d => (d.payments || []).forEach(p => { if (p.date >= fyStart && p.date <= fyEnd) received += (Number(p.amount) || 0) + (Number(p.tds) || 0); }));
    received = round2(received);
    const pct = billed > 0 ? Math.min(100, Math.round(received / billed * 100)) : 0;
    // average days from invoice date to the payment that settled it (fully paid invoices only)
    const settled = liveDocs().filter(d => d.docType === 'INV' && (d.payments || []).length && balanceOf(d) <= 0.009);
    const days = settled.map(d => daysBetween(d.date, d.payments.map(p => p.date).sort().pop())).filter(n => n >= 0);
    const avg = days.length ? Math.round(days.reduce((a, b) => a + b, 0) / days.length) : null;
    const R = 52, C = 2 * Math.PI * R;
    box.innerHTML = `<div class="card-h"><h3>${ic('ring')}<span data-i18n>Collection</span></h3><span class="chip-soft">FY ${esc2(fyOf(today))}</span></div>
      <div class="ring-wrap">
        <svg class="ring" viewBox="0 0 132 132" role="img" aria-label="${pct}% ${t('of this year\'s billing collected')}">
          <defs><linearGradient id="ringg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3ddc97"/><stop offset="1" stop-color="#12a77a"/></linearGradient></defs>
          <circle class="r-track" cx="66" cy="66" r="${R}"/>
          <circle class="r-arc" cx="66" cy="66" r="${R}" stroke-dasharray="${C.toFixed(1)}" stroke-dashoffset="${C.toFixed(1)}" style="--to:${(C * (1 - pct / 100)).toFixed(1)}" transform="rotate(-90 66 66)"/>
        </svg>
        <div class="ring-c"><b>${pct}<small>%</small></b><span data-i18n>collected</span></div>
      </div>
      <dl class="ring-stats">
        <div><dt data-i18n>Billed this FY</dt><dd>${esc2(fmt(billed))}</dd></div>
        <div><dt data-i18n>Received</dt><dd class="pos">${esc2(fmt(received))}</dd></div>
        <div><dt data-i18n>Avg. days to get paid</dt><dd>${avg === null ? '—' : avg + ' ' + t(avg === 1 ? 'day' : 'days')}</dd></div>
      </dl>`;
    const arc = box.querySelector('.r-arc');
    requestAnimationFrame(() => requestAnimationFrame(() => { arc.style.strokeDashoffset = arc.style.getPropertyValue('--to'); }));
  }

  // ---- interactive cash-flow chart (SVG): billed bars, received line, scrub to read a month
  let flowSel = null;
  function renderFlow(still) {
    const plot = $('flow-plot'); if (!plot) return;
    const keys = fyMonths(), { billed, received } = flows(keys), cur = todayISO().slice(0, 7);
    const curIdx = keys.indexOf(cur);
    const totB = round2(billed.reduce((a, b) => a + b, 0)), totR = round2(received.reduce((a, b) => a + b, 0));
    $('flow-sub').innerHTML = `<span data-i18n>FY</span> ${esc2(fyOf(todayISO()))} · ${esc2(compact(totB))} <span data-i18n>billed</span> · ${esc2(compact(totR))} <span data-i18n>received</span>`;
    const W = Math.max(280, plot.clientWidth || 640), H = isPhone() ? 190 : 230, padL = 44, padR = 10, padT = 14, padB = 28;
    const max = Math.max(1000, ...billed, ...received);   // empty / tiny years still get a readable ₹0–₹1K scale
    const nice = (() => { const p = Math.pow(10, Math.floor(Math.log10(max))); const m = max / p; return (m <= 1 ? 1 : m <= 2 ? 2 : m <= 2.5 ? 2.5 : m <= 5 ? 5 : 10) * p; })();
    const iw = W - padL - padR, ih = H - padT - padB, slot = iw / 12;
    const y = v => padT + ih - Math.max(0, v) / nice * ih, x = i => padL + slot * i + slot / 2;
    const bw = Math.min(26, slot * .46);
    let g = '';
    for (let k = 0; k <= 4; k++) { const v = nice * k / 4, yy = y(v).toFixed(1); g += `<line class="gl" x1="${padL}" x2="${W - padR}" y1="${yy}" y2="${yy}"/><text class="gt" x="${padL - 8}" y="${(+yy + 4).toFixed(1)}" text-anchor="end">${esc2(compact(v))}</text>`; }
    const bars = billed.map((v, i) => { const h = Math.max(v > 0 ? 3 : 0, ih - (y(v) - padT)); const fut = curIdx >= 0 && i > curIdx;
      return `<rect class="bar${i === curIdx ? ' cur' : ''}${fut ? ' fut' : ''}" x="${(x(i) - bw / 2).toFixed(1)}" y="${(padT + ih - h).toFixed(1)}" width="${bw.toFixed(1)}" height="${h.toFixed(1)}" rx="${Math.min(7, bw / 2).toFixed(1)}" style="animation-delay:${i * 35}ms"/>`; }).join('');
    const upto = curIdx >= 0 ? curIdx : 11;
    const pts = received.slice(0, upto + 1).map((v, i) => [x(i), y(v)]);
    const path = smooth(pts);
    const area = pts.length ? `${path} L${pts[pts.length - 1][0].toFixed(1)} ${padT + ih} L${pts[0][0].toFixed(1)} ${padT + ih}Z` : '';
    const labels = keys.map((k, i) => `<text class="mt${i === curIdx ? ' cur' : ''}" x="${x(i).toFixed(1)}" y="${H - 8}" text-anchor="middle">${esc2(slot < 34 ? monthName(k).slice(0, 1) : monthName(k).slice(0, 3))}</text>`).join('');
    plot.innerHTML = `<svg class="flow${still ? ' still' : ''}" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" tabindex="0" role="img" aria-label="${esc2(t('Billed and received per month'))}">
      <defs><linearGradient id="flowg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" class="fg0"/><stop offset="1" class="fg1"/></linearGradient></defs>
      <g class="grid">${g}</g><g class="bars">${bars}</g>
      <path class="r-area" d="${area}"/><path class="r-line" d="${path}"/>
      ${pts.map((p, i) => `<circle class="r-dot" cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="3" data-i="${i}"/>`).join('')}
      <line class="guide" x1="0" x2="0" y1="${padT}" y2="${padT + ih}"/><circle class="hot" r="5.5" cx="-20" cy="-20"/>
      ${labels}<rect class="hit" x="${padL}" y="0" width="${iw}" height="${H}" fill="transparent"/></svg>`;
    const svg = plot.firstElementChild, guide = svg.querySelector('.guide'), hot = svg.querySelector('.hot');
    const line = svg.querySelector('.r-line');
    if (!still && !reduced() && line.getTotalLength) { const L = line.getTotalLength(); line.style.strokeDasharray = L; line.style.strokeDashoffset = L; requestAnimationFrame(() => requestAnimationFrame(() => { line.style.transition = 'stroke-dashoffset 1.1s cubic-bezier(.2,.8,.2,1)'; line.style.strokeDashoffset = 0; })); }
    const select = i => {
      i = Math.max(0, Math.min(11, i)); flowSel = i;
      guide.setAttribute('x1', x(i)); guide.setAttribute('x2', x(i)); guide.classList.add('on');
      if (i <= upto) { hot.setAttribute('cx', x(i)); hot.setAttribute('cy', y(received[i])); hot.classList.add('on'); } else hot.classList.remove('on');
      svg.querySelectorAll('.bar').forEach((b, j) => b.classList.toggle('sel', j === i));
      const pct = billed[i] > 0 ? Math.round(received[i] / billed[i] * 100) : null;
      $('flow-read').innerHTML = `<b>${esc2(monthLong(keys[i]))}</b><span class="fr-b"><i></i><span data-i18n>Billed</span> <strong>${esc2(fmt(billed[i]))}</strong></span><span class="fr-r"><i></i><span data-i18n>Received</span> <strong>${esc2(fmt(received[i]))}</strong></span>${pct !== null ? `<span class="fr-p">${pct}% <span data-i18n>collected</span></span>` : ''}`;
      i18n().translateTree($('flow-read'));
    };
    const at = ev => { const r = svg.getBoundingClientRect(); const px = (ev.clientX - r.left) * (W / r.width); return Math.floor((px - padL) / slot); };
    svg.addEventListener('pointermove', ev => select(at(ev)));
    svg.addEventListener('pointerdown', ev => select(at(ev)));
    svg.addEventListener('keydown', ev => { if (ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') { ev.preventDefault(); select((flowSel == null ? upto : flowSel) + (ev.key === 'ArrowRight' ? 1 : -1)); } });
    select(flowSel != null ? flowSel : upto);
  }
  // monotone-ish smoothing (Catmull-Rom → Bézier, clamped so the curve never overshoots below zero)
  function smooth(p) {
    if (!p.length) return '';
    if (p.length === 1) return `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
    let d = `M${p[0][0].toFixed(1)} ${p[0][1].toFixed(1)}`;
    const base = Math.max(...p.map(q => q[1]));
    for (let i = 0; i < p.length - 1; i++) {
      const p0 = p[i - 1] || p[i], p1 = p[i], p2 = p[i + 1], p3 = p[i + 2] || p2;
      const c1 = [p1[0] + (p2[0] - p0[0]) / 6, Math.min(base, p1[1] + (p2[1] - p0[1]) / 6)], c2 = [p2[0] - (p3[0] - p1[0]) / 6, Math.min(base, p2[1] - (p3[1] - p1[1]) / 6)];
      d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
    }
    return d;
  }

  // alerts: severity icon tile + chevron when the alert leads somewhere
  function polishAlerts() {
    const box = $('dash-alerts'); if (!box) return;
    Array.from(box.children).forEach(a => {
      if (a.classList.contains('al')) return;
      const lvl = a.classList.contains('bg-rose-50') ? 'error' : a.classList.contains('bg-amber-50') ? 'warn' : a.classList.contains('bg-blue-50') ? 'info' : 'ok';
      a.classList.add('al', 'al-' + lvl);
      const body = document.createElement('div'); body.className = 'al-body'; while (a.firstChild) body.appendChild(a.firstChild);
      a.innerHTML = `<span class="al-ic">${ic(lvl === 'error' ? 'error' : lvl === 'warn' ? 'alert' : lvl === 'info' ? 'info' : 'check')}</span>`;
      a.appendChild(body);
      if (a.hasAttribute('onclick')) { a.insertAdjacentHTML('beforeend', `<span class="al-go">${ic('chevr')}</span>`); a.setAttribute('role', 'button'); a.tabIndex = 0; a.onkeydown = e => { if (e.key === 'Enter') a.click(); }; }
    });
  }

  /* ------------------------------------------------------------------ invoice editor */
  const STEP = { 'sec-doc': '01', 'sec-parties': '02', 'sec-items': '03', 'sec-charges': '04', 'sec-supply': '05', 'sec-transport': '06', 'sec-edoc': '07', 'sec-terms': '08' };
  const JUMP = [['sec-doc', 'Document'], ['sec-parties', 'Customer'], ['sec-items', 'Items'], ['sec-charges', 'Charges'], ['sec-supply', 'Tax'], ['sec-transport', 'Transport'], ['sec-terms', 'Terms']];
  function editorLayout() {
    const form = $('invoice-form'); if (!form || form.classList.contains('studio')) return;
    form.classList.add('studio');
    Object.entries(STEP).forEach(([cls, n]) => { const s = form.querySelector('.' + cls); if (s) s.dataset.step = n; });
    swapIcons(form.parentElement);
    // phones: a sticky jump bar through the sections
    const jb = document.createElement('div'); jb.id = 'ed-jump'; jb.className = 'no-print'; jb.setAttribute('role', 'tablist');
    jb.innerHTML = JUMP.map(([c, l]) => `<button type="button" data-s="${c}"><span data-i18n>${l}</span></button>`).join('');
    const seg = $('doc-seg'); if (seg) seg.after(jb);
    jb.addEventListener('click', e => { const b = e.target.closest('button'); if (!b) return; const s = form.querySelector('.' + b.dataset.s); if (s) window.scrollTo({ top: s.getBoundingClientRect().top + window.scrollY - (isPhone() ? 112 : 24), behavior: reduced() ? 'auto' : 'smooth' }); });
    if ('IntersectionObserver' in window) {
      const io = new IntersectionObserver(es => es.forEach(en => { if (en.isIntersecting) { const c = JUMP.find(([k]) => en.target.classList.contains(k)); if (c) jb.querySelectorAll('button').forEach(b => { const on = b.dataset.s === c[0]; b.classList.toggle('on', on); if (on && b.scrollIntoView && isPhone()) jb.scrollTo({ left: b.offsetLeft - 16, behavior: reduced() ? 'auto' : 'smooth' }); }); } }), { rootMargin: '-120px 0px -60% 0px' });
      JUMP.forEach(([c]) => { const s = form.querySelector('.' + c); if (s) io.observe(s); });
    }
    // segmented document type: a sliding indicator
    if (seg && !seg.querySelector('.seg-ind')) { seg.insertAdjacentHTML('afterbegin', '<i class="seg-ind" aria-hidden="true"></i>'); syncSegInd(); }
    // live paper + compliance card in the side column
    const aside = form.closest('.grid') && form.closest('.grid').querySelector('aside');
    if (aside && !$('paper-live')) {
      aside.classList.add('ed-side');
      const chk = document.createElement('div'); chk.className = 'check-card';
      chk.append($('check-header'), $('check-list'));
      aside.append(chk);
      const pap = document.createElement('section'); pap.id = 'paper-live'; pap.className = 'no-print';
      pap.innerHTML = `<div class="pl-cap"><span class="eyebrow" data-i18n>Live preview</span><button type="button" class="pl-open" onclick="renderPreview()">${ic('eye')}<span data-i18n>Full preview</span></button></div><div class="paper" id="paper-sheet" role="button" tabindex="0" aria-label="Open full preview"></div>`;
      aside.prepend(pap);
      pap.querySelector('.paper').addEventListener('click', () => renderPreview());
    }
    // add-row button and live total get icons
    const add = form.querySelector('.sec-items > button'); if (add && !add.querySelector('.ic')) { const i = add.querySelector('i'); if (i) i.remove(); add.insertAdjacentHTML('afterbegin', ic('plus')); }
  }
  function syncSegInd() {
    const seg = $('doc-seg'), sel = $('inv-doc-type'); if (!seg || !sel) return;
    const btns = Array.from(seg.querySelectorAll('button')), i = Math.max(0, btns.findIndex(b => b.dataset.v === sel.value));
    seg.style.setProperty('--i', i);
  }
  let paperTimer = null;
  function renderPaper() {
    const box = $('paper-sheet'); if (!box || !box.offsetParent) return;
    clearTimeout(paperTimer);
    paperTimer = setTimeout(() => {
      let d; try { d = collectDocFromForm(); } catch (e) { return; }
      const c = d.calc, co = state.company;
      const title = typeof docTitle === 'function' ? docTitle(d, c) : 'TAX INVOICE';
      const rows = c.items.filter(it => it.desc || it.amount);
      const show = rows.slice(0, 6);
      const tax = c.lut ? [['IGST (LUT)', 0]] : c.isInter ? [['IGST', c.igst]] : [['CGST', c.cgst], ['SGST', c.sgst]];
      let words = '';
      try { if (typeof numberToWords === 'function' && c.grandTotal) words = numberToWords(c.grandTotal); } catch (e) { /* optional */ }
      box.innerHTML = `
        <div class="pp-head"><div><b class="pp-co">${esc2(co.name || 'Your business')}</b><small>${esc2(co.gstin ? 'GSTIN ' + co.gstin : '')}</small></div>
          <div class="pp-doc"><span>${esc2(title)}</span><b>${esc2(d.num || '—')}</b><small>${d.date ? esc2(fmtDate(d.date)) : ''}</small></div></div>
        <div class="pp-party"><span class="pp-k">Billed to</span><b>${esc2(d.buyerName || '—')}</b><small>${esc2([d.buyerGstin || (d.buyerName ? 'Unregistered' : ''), d.buyerState].filter(Boolean).join(' · '))}</small></div>
        <table class="pp-items"><thead><tr><th>Item</th><th class="r">Qty × Rate</th><th class="r">Amount</th></tr></thead><tbody>
          ${show.map(it => `<tr><td>${esc2(it.desc || '—')}<small>${esc2(it.hsn ? 'HSN ' + it.hsn + ' · ' : '')}${it.gst}%</small></td><td class="r">${esc2(String(it.qty))} × ${esc2(fmt(it.rate))}</td><td class="r">${esc2(fmt(it.amount))}</td></tr>`).join('') || '<tr><td colspan="3" class="pp-empty">Add an item to see it here</td></tr>'}
          ${rows.length > show.length ? `<tr><td colspan="3" class="pp-more">+ ${rows.length - show.length} more</td></tr>` : ''}
        </tbody></table>
        <div class="pp-tot">
          <div><span>Taxable value</span><span>${esc2(fmt(c.taxable))}</span></div>
          ${tax.map(([k, v]) => `<div><span>${k}</span><span>${esc2(fmt(v))}</span></div>`).join('')}
          ${c.roundoff ? `<div><span>Round off</span><span>${esc2(fmt(c.roundoff))}</span></div>` : ''}
          <div class="pp-grand"><span>${c.rcm ? 'Total (GST under RCM)' : 'Grand total'}</span><b>${esc2(fmt(c.grandTotal))}</b></div>
        </div>
        ${words ? `<p class="pp-words">${esc2(words)}</p>` : ''}
        <div class="pp-foot"><span>${c.lut ? 'Zero-rated under LUT' : c.isInter ? 'Inter-state · IGST' : 'Intra-state · CGST + SGST'}</span><span>${esc2(d.pos ? 'POS ' + d.pos : '')}</span></div>`;
      box.classList.remove('tick'); void box.offsetWidth; box.classList.add('tick');
    }, 60);
  }
  S.renderPaper = renderPaper;

  /* ------------------------------------------------------------------ preview desk */
  function previewLayout() {
    const sec = $('preview-section'); if (!sec || sec.classList.contains('studio')) return;
    sec.classList.add('studio');
    const bar = sec.firstElementChild; bar.classList.add('pv-bar');
    const left = bar.firstElementChild, right = bar.lastElementChild;
    left.classList.add('pv-left'); right.classList.add('pv-actions');
    const h = left.querySelector('h3'); if (h) { h.classList.add('pv-title'); h.insertAdjacentHTML('beforebegin', `<button type="button" class="pv-back" aria-label="Back to editor">${ic('chevl')}</button>`); }
    left.querySelector('.pv-back').onclick = () => { sec.classList.add('hidden'); window.scrollTo({ top: 0, behavior: reduced() ? 'auto' : 'smooth' }); };
    // layout as a segmented control (the select stays the source of truth)
    const sel = $('invoice-style-select');
    if (sel && !$('pv-style')) {
      const seg = document.createElement('div'); seg.id = 'pv-style'; seg.className = 'mini-seg'; seg.setAttribute('role', 'group'); seg.setAttribute('aria-label', 'Layout');
      seg.innerHTML = `<button type="button" data-v="modern"><span data-i18n>Modern</span></button><button type="button" data-v="classic"><span data-i18n>Classic</span></button>`;
      sel.after(seg); sel.classList.add('sr-only');
      seg.onclick = e => { const b = e.target.closest('button'); if (!b) return; toggleInvoiceStyle(b.dataset.v); syncStyleSeg(); };
      syncStyleSeg();
    }
    const copies = left.querySelectorAll('label'); if (copies.length) { const g = document.createElement('div'); g.className = 'pv-copies'; copies[0].before(g); copies.forEach(l => g.appendChild(l)); const cap = left.querySelector('span.uppercase'); if (cap) g.prepend(cap); }
    swapIcons(bar);
  }
  function syncStyleSeg() { const sel = $('invoice-style-select'), seg = $('pv-style'); if (!sel || !seg) return; seg.querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.v === sel.value)); }

  /* ------------------------------------------------------------------ lists */
  // Documents: rows grouped under month headings (count + net value of that month in the filtered list)
  function groupDocs() {
    const tb = $('invoices-list-tbody'); if (!tb) return;
    tb.querySelectorAll('tr.month-row').forEach(r => r.remove());
    const rows = Array.from(tb.querySelectorAll('tr')).filter(r => !r.classList.contains('show-more-row') && !r.querySelector('td[colspan]'));
    if (!rows.length) return;
    const list = getFilteredInvoices().slice(0, rows.length);
    const groups = {};
    getFilteredInvoices().forEach(d => { const k = monthKey(d.date); const g = groups[k] || (groups[k] = { n: 0, v: 0 }); g.n++; g.v += d.cancelled ? 0 : signed(d) * (d.grandTotal || 0); });
    let last = '';
    rows.forEach((tr, i) => {
      const d = list[i]; if (!d) return;
      tr.dataset.doc = d.docType; if (isOverdue(d)) tr.classList.add('is-overdue');
      const k = monthKey(d.date); if (k === last) return; last = k;
      const g = groups[k] || { n: 0, v: 0 };
      const mr = document.createElement('tr'); mr.className = 'month-row';
      mr.innerHTML = `<td colspan="11"><div class="mr"><span class="mr-m">${esc2(monthLong(k))}</span><span class="mr-n">${g.n} ${t(g.n === 1 ? 'document' : 'documents')}</span><span class="mr-v">${esc2(fmt(round2(g.v)))}</span></div></td>`;
      tr.before(mr);
    });
    // totals row: each figure carries its column name (used by the ledger layout)
    const heads = Array.from(document.querySelectorAll('#tab-invoices thead th')).map(th => th.textContent.trim());
    const foot = $('invoices-list-tfoot'); const fr = foot && foot.rows[0];
    if (fr && fr.cells.length >= 5) [5, 6, 7, 8].forEach((col, i) => { if (fr.cells[i + 1]) fr.cells[i + 1].dataset.label = heads[col] || ''; });
    swapIcons(tb);
  }
  function polishItems() {
    const tb = $('items-list-tbody'); if (!tb) return;
    const q = ($('item-search').value || '').toLowerCase();
    const prods = state.products.filter(p => !q || `${p.name} ${p.hsn}`.toLowerCase().includes(q));
    const maxStock = Math.max(1, ...prods.filter(p => p.trackStock).map(p => Math.max(0, stockOf(p))));
    Array.from(tb.rows).forEach((tr, i) => {
      const p = prods[i]; if (!p || tr.querySelector('td[colspan]')) return;
      const first = tr.cells[0];
      if (!first.querySelector('.item-glyph')) first.insertAdjacentHTML('afterbegin', `<span class="item-glyph" data-tone="${toneOf(p.name)}">${esc2((p.name || '?').trim().slice(0, 1).toUpperCase())}</span>`);
      if (p.trackStock) {
        const st = stockOf(p), low = st <= (Number(p.minStock) || 0);
        const cell = tr.cells[5];
        if (cell && !cell.querySelector('.meter')) cell.insertAdjacentHTML('beforeend', `<span class="meter ${st < 0 ? 'neg' : low ? 'low' : ''}"><i style="width:${Math.max(3, Math.min(100, Math.max(0, st) / maxStock * 100)).toFixed(0)}%"></i></span>`);
      }
    });
    swapIcons(tb);
  }
  function polishBuyers() {
    const tb = $('customers-list-tbody'); if (!tb) return;
    Array.from(tb.rows).forEach(tr => {
      if (tr.querySelector('td[colspan]')) return;
      const first = tr.cells[0];
      if (!first.querySelector('.avatar')) { const name = first.textContent.trim(); first.insertAdjacentHTML('afterbegin', `<span class="avatar" data-tone="${toneOf(name)}" aria-hidden="true">${esc2(typeof initials === 'function' ? initials(name) : name.slice(0, 2))}</span>`); }
    });
    swapIcons(tb);
  }
  function listHeads() {
    [['tab-invoices', 'docs', 'Every invoice, quotation and note you have issued.'], ['tab-items', 'items', 'Products and services with HSN, GST rate and stock.'],
     ['tab-customers', 'buyers', 'Your buyers, their GSTINs and what they owe.'], ['tab-settings', 'settings', 'Business profile, GST rules, branding and backups.']].forEach(([id, icon, sub]) => {
      const sec = $(id); if (!sec) return;
      const h2 = sec.querySelector('h2'); if (!h2 || h2.dataset.studio) return;
      h2.dataset.studio = '1';
      h2.classList.add('page-title');
      const head = document.createElement('div'); head.className = 'page-head';
      head.innerHTML = `<span class="page-ic">${ic(icon)}</span><div class="page-txt"></div>`;
      h2.before(head); head.querySelector('.page-txt').append(h2);
      head.querySelector('.page-txt').insertAdjacentHTML('beforeend', `<p class="page-sub" data-i18n>${sub}</p>`);
      if (id === 'tab-settings') sec.prepend(head);   // settings: the title leads the page, above the section index
      sec.classList.add('studio-list');
    });
    // search fields get a magnifier
    ['inv-search', 'item-search', 'cust-search'].forEach(id => { const el = $(id); if (el && !el.parentElement.classList.contains('search-box')) { const w = document.createElement('label'); w.className = 'search-box'; el.before(w); w.innerHTML = ic('search'); w.appendChild(el); } });
    swapIcons($('tab-items')); swapIcons($('tab-customers')); swapIcons($('tab-invoices'));
  }

  /* ------------------------------------------------------------------ settings: index + grouped cards */
  function settingsLayout() {
    const sec = $('tab-settings'), form = $('settings-form'); if (!sec || !form || sec.querySelector('.set-index')) return;
    const groups = Array.from(form.querySelectorAll(':scope > h3.set-group'));
    groups.forEach((h, i) => {
      const card = document.createElement('div'); card.className = 'set-card'; card.id = 'set-g' + i;
      h.before(card); card.appendChild(h);
      let n = card.nextElementSibling;
      while (n && !(n.matches && n.matches('h3.set-group')) && !(n.querySelector && n.querySelector('button[type=submit]'))) { const nx = n.nextElementSibling; card.appendChild(n); n = nx; }
    });
    const extra = Array.from(sec.querySelectorAll('#settings-form ~ div')).map((d, i) => { d.classList.add('set-card'); d.id = d.id || 'set-x' + i; return d; });
    const items = [['app-prefs', 'App preferences', 'palette']]
      .concat(groups.map((h, i) => ['set-g' + i, h.textContent.trim(), null]))
      .concat(extra.map(d => [d.id, (d.querySelector('h3') || {}).textContent || '', null]));
    const nav = document.createElement('nav'); nav.className = 'set-index no-print'; nav.setAttribute('aria-label', 'Settings sections');
    nav.innerHTML = items.map(([id, l]) => `<button type="button" data-t="${id}"><span>${esc2(l.trim())}</span></button>`).join('');
    nav.onclick = e => { const b = e.target.closest('button'); if (!b) return; const el = $(b.dataset.t); if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 20, behavior: reduced() ? 'auto' : 'smooth' }); };
    const shell = document.createElement('div'); shell.className = 'set-shell';
    const main = sec.querySelector(':scope > .bg-white');
    const ph = sec.querySelector(':scope > .page-head'); if (ph) ph.after(shell); else sec.insertBefore(shell, sec.firstChild);
    shell.appendChild(nav);
    const col = document.createElement('div'); col.className = 'set-col'; shell.appendChild(col);
    const prefs = $('app-prefs'); if (prefs) { prefs.classList.add('set-card'); col.appendChild(prefs); }
    if (main) col.appendChild(main);
    swapIcons(sec);
  }

  /* ------------------------------------------------------------------ micro-interactions */
  function ripple(e) {
    const b = e.target.closest('.btn-primary, .rail-new, #bottom-nav .fab-circle, .ed-savebar button, .dlg-actions button:last-child, #btn-share-pdf, .qa-primary');
    if (!b || reduced()) return;
    const r = b.getBoundingClientRect(), s = document.createElement('span'); s.className = 'rpl';
    const d = Math.max(r.width, r.height) * 2; s.style.cssText = `width:${d}px;height:${d}px;left:${e.clientX - r.left - d / 2}px;top:${e.clientY - r.top - d / 2}px`;
    b.appendChild(s); setTimeout(() => s.remove(), 600);
  }
  function savedPulse() {
    document.querySelectorAll('.ed-savebar button.bg-emerald-600, #preview-section button[onclick="saveCurrentInvoice()"]').forEach(b => { b.classList.remove('saved'); void b.offsetWidth; b.classList.add('saved'); setTimeout(() => b.classList.remove('saved'), 1400); });
  }
  function polishToast() {
    const box = $('toast-container'); if (!box) return;
    new MutationObserver(ms => ms.forEach(m => m.addedNodes.forEach(n => {
      if (n.nodeType !== 1 || n.classList.contains('st')) return;
      const kind = n.classList.contains('bg-rose-600') ? 'error' : n.classList.contains('bg-amber-600') ? 'warn' : n.classList.contains('bg-emerald-600') ? 'ok' : 'info';
      n.classList.add('st', 'st-' + kind);
      const i = n.querySelector('i'); if (i) { const s = document.createElement('span'); s.className = 'st-ic'; s.innerHTML = ic(kind === 'ok' ? 'check' : kind === 'error' ? 'error' : kind === 'warn' ? 'alert' : 'info'); i.replaceWith(s); }
    }))).observe(box, { childList: true });
  }

  /* ------------------------------------------------------------------ boot (called by mobile.js) */
  S.shell = function () {
    sprite();
    buildRail();
    phoneChrome();
    dashLayout();
    editorLayout();
    previewLayout();
    listHeads();
    polishToast();
    document.addEventListener('pointerdown', ripple, { passive: true });
  };
  S.ready = function () {
    settingsLayout();
    wrap('switchTab', (o, tab) => { setRailActive(tab); if (tab === 'create-invoice') renderPaper(); if (tab === 'settings') swapIcons($('tab-settings')); });
    wrap('refreshCompanyNames', syncCompany);
    wrap('renderInvoiceList', groupDocs);
    wrap('renderItemList', polishItems);
    wrap('renderCustomerList', polishBuyers);
    wrap('doRefreshForm', renderPaper);
    wrap('onDocTypeChange', syncSegInd); wrap('newDocument', syncSegInd); wrap('loadDocIntoForm', syncSegInd);
    wrap('toggleInvoiceStyle', syncStyleSeg);
    wrap('saveCurrentInvoice', savedPulse);
    wrap('renderPreview', () => { const c = $('invoice-preview-container'); if (c) { c.classList.remove('rise'); void c.offsetWidth; c.classList.add('rise'); } });
    wrap('addInvoiceRow', () => swapIcons($('invoice-items-body')));
    wrap('renderChecks', () => { const h = $('check-header'); if (h) { h.dataset.state = /bg-rose/.test(h.className) ? 'bad' : /bg-amber/.test(h.className) ? 'warn' : 'ok'; swapIcons(h); } swapIcons($('check-list')); });
    syncCompany(); groupDocs(); polishItems(); polishBuyers(); renderDash();
    syncSegInd(); syncStyleSeg();
    swapIcons(document.querySelector('#invoice-items-body'));
    setRailActive('dashboard');
    let rt = null;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => { if ($('tab-dashboard') && !$('tab-dashboard').classList.contains('hidden')) renderFlow(true); renderPaper(); const a = document.querySelector('.rail-btn.on'); if (a) setRailActive(a.dataset.tab); }, 150); });
    window.addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { const s = $('inv-search'); if (s) { e.preventDefault(); switchTab('invoices'); s.focus(); } } });
  };
})();
