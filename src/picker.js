/* =====================================================================
   HGI Billing v8.3 — Smart product search & selection (invoice editor)
   - real-time search by name, size, SKU, category, specifications, HSN
   - grouped: category → product → sizes (DWC Pipe → 40mm · 63mm · 90mm · 110mm)
   - price, unit and live stock per size; favourites, recent, frequently billed
   - keyboard: ↑ ↓ move · Enter select · Ctrl+Enter add · Esc close · Ctrl+K open
   - pick several items at once; an item already on the invoice gets its quantity
     raised instead of a second row
   Fills rows through the app's own onItemDescChange(), so HSN / GST / unit / rate and
   every GST calculation stay exactly the existing logic.
   ===================================================================== */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const t = s => (window.HGI_I18N ? window.HGI_I18N.t(s) : s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const PAGE = 60;                       // products rendered per page (search runs over all of them)
  const RECENT_MAX = 20;

  /* ------------------------------------------------------------------ catalogue index */
  // sizes written at the end of older product names ("MS Flange 2 Inch", "PVC Pipe 110 mm 6 kg") become variants too
  const SIZE_RE = /^(.*?\S)[\s,\-–]+((?:\d+(?:\.\d+)?(?:\s*\/\s*\d+)?|\d+\s+\d\/\d)\s*(?:mm|cm|mtr|m|meter|inch(?:es)?|in|"|''|ft|feet|kg|kgs|g|gm|ltr|l|ml|hp|kw|kva|sq\.?\s?mm|nb|swg|gauge|ton|tr|amp|a|v|w|pcs|nos)\.?(?:\s*[x×*]\s*\d+(?:\.\d+)?\s*(?:mm|cm|m|inch|in|"|ft)?\.?)*(?:\s+\d+(?:\.\d+)?\s*(?:kg|kgs|kg\/cm2|kgf|bar|mm)\.?)?)$/i;
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[×*]/g, 'x').replace(/\s+/g, ' ').trim();
  const compact = s => norm(s).replace(/[^a-z0-9.\/]+/g, '');
  const sizeNum = s => { const m = /(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+))?/.exec(String(s || '')); return m ? (m[2] ? Number(m[1]) / Number(m[2]) : Number(m[1])) : Infinity; };

  let idx = null;          // { list: [entry], byId: Map, cats: [ {name, count} ], groups: Map key→[entry] } — rebuilt on every open
  function buildIndex() {
    const t0 = performance.now();
    const list = [], byId = new Map(), groups = new Map(), catCount = new Map();
    for (const p of state.products) {
      if (!p || !p.name) continue;
      let group = (p.group || '').trim(), size = (p.size || '').trim();
      if (!group) { const m = SIZE_RE.exec(String(p.name).trim()); if (m && !size) { group = m[1].trim(); size = m[2].trim(); } else group = String(p.name).trim(); }
      const category = (p.category || '').trim() || t('Other');
      const gkey = norm(category) + '|' + norm(group);
      const text = [p.name, group, size, p.sku, category, p.specs, p.hsn, ...(p.aliases || [])].filter(Boolean).join(' ');
      const e = { p, id: p.id, name: p.name, group, size, category, gkey, nameN: norm(p.name), groupN: norm(group), skuN: norm(p.sku), hay: norm(text), hayC: compact(text), sizeV: sizeNum(size) };
      list.push(e); byId.set(p.id, e);
      if (!groups.has(gkey)) groups.set(gkey, []);
      groups.get(gkey).push(e);
      catCount.set(category, (catCount.get(category) || 0) + 1);
    }
    groups.forEach(g => g.sort((a, b) => a.sizeV - b.sizeV || a.size.localeCompare(b.size, undefined, { numeric: true }) || a.name.localeCompare(b.name)));
    const cats = [...catCount.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name === t('Other') ? 1 : b.name === t('Other') ? -1 : a.name.localeCompare(b.name));
    idx = { list, byId, groups, cats, ms: performance.now() - t0, products: state.products };
    return idx;
  }
  const index = () => (idx && idx.products === state.products && idx.list.length === state.products.length ? idx : buildIndex());

  // usage from saved documents: frequency + last date per product (one pass)
  function usage() {
    const byName = new Map();
    for (const e of index().list) { byName.set(e.nameN, e); (e.p.aliases || []).forEach(a => { const k = norm(a); if (!byName.has(k)) byName.set(k, e); }); }
    const freq = new Map(), last = new Map();
    for (const d of state.invoices) {
      if (d.cancelled || !d.items) continue;
      for (const it of d.items) {
        const e = byName.get(norm(it.desc)); if (!e) continue;
        freq.set(e.id, (freq.get(e.id) || 0) + 1);
        if (!last.has(e.id) || d.date > last.get(e.id)) last.set(e.id, d.date);
      }
    }
    return { freq, last };
  }

  /* ------------------------------------------------------------------ search */
  function search(q, cat, use) {
    const I = index(), qn = norm(q);
    const tokens = qn.split(' ').filter(Boolean);
    const out = [];
    for (const e of I.list) {
      if (cat && e.category !== cat) continue;
      let score = 0, ok = true;
      for (const tk of tokens) {
        const c = compact(tk);
        if (e.hay.includes(tk)) score += 10;
        else if (c && e.hayC.includes(c)) score += 6;
        else { ok = false; break; }
        if (e.nameN.startsWith(tk) || e.groupN.startsWith(tk)) score += 25;
        else if (e.nameN.includes(' ' + tk)) score += 12;
        if (e.skuN && e.skuN === tk) score += 200;
        if (e.size && compact(e.size) === c) score += 30;
      }
      if (!ok) continue;
      if (qn && e.nameN === qn) score += 300;
      else if (qn && e.nameN.startsWith(qn)) score += 60;
      if (e.p.fav) score += 8;
      if (use) score += Math.min(20, (use.freq.get(e.id) || 0) * 2);
      out.push({ e, score });
    }
    if (tokens.length) out.sort((a, b) => b.score - a.score || a.e.groupN.localeCompare(b.e.groupN) || a.e.sizeV - b.e.sizeV);
    else out.sort((a, b) => a.e.category.localeCompare(b.e.category) || a.e.groupN.localeCompare(b.e.groupN) || a.e.sizeV - b.e.sizeV);
    return out.map(x => x.e);
  }

  /* ------------------------------------------------------------------ picker state */
  let el = null, anchorRow = null, sel = new Map(), active = -1, shown = PAGE, catFilter = '', lastQuery = '', use = null, stocks = null, inInvoice = new Map();
  const isOpen = () => !!el && !el.classList.contains('hidden');

  function invoiceRows() { return Array.from(document.querySelectorAll('#invoice-items-body tr')); }
  function scanInvoice() {
    inInvoice = new Map();
    invoiceRows().forEach(tr => { const k = norm(tr.querySelector('.item-desc').value); if (k) inInvoice.set(k, (inInvoice.get(k) || 0) + (parseFloat(tr.querySelector('.item-qty').value) || 0)); });
  }
  const money2 = n => (typeof money === 'function' ? money(n) : '₹' + Number(n || 0).toFixed(2));
  const fmtQty = n => (Math.round(n * 1000) / 1000).toLocaleString('en-IN');

  function build() {
    el = document.createElement('div');
    el.id = 'product-picker'; el.className = 'pk no-print hidden';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Search products');
    el.innerHTML = `<div class="pk-panel">
      <div class="pk-head">
        <button type="button" class="pk-x" id="pk-close" aria-label="Close">${svg('back')}</button>
        <div class="pk-search">${svg('search')}<input id="pk-q" type="search" inputmode="search" enterkeyhint="search" autocomplete="off" spellcheck="false" placeholder="${esc(t('Search item, size, SKU…'))}" aria-controls="pk-results" aria-autocomplete="list"><button type="button" id="pk-clear" class="pk-clear" aria-label="Clear">×</button></div>
      </div>
      <div class="pk-cats" id="pk-cats" role="tablist"></div>
      <div class="pk-results" id="pk-results" role="listbox" aria-multiselectable="true"></div>
      <div class="pk-hint" id="pk-hint"><kbd>↑</kbd><kbd>↓</kbd> ${esc(t('move'))} · <kbd>Enter</kbd> ${esc(t('select'))} · <kbd>Ctrl</kbd>+<kbd>Enter</kbd> ${esc(t('add to invoice'))} · <kbd>Esc</kbd> ${esc(t('close'))}</div>
      <div class="pk-tray" id="pk-tray"></div>
    </div>`;
    document.body.appendChild(el);
    const q = $('pk-q');
    q.addEventListener('input', () => { shown = PAGE; active = -1; render(); });
    q.addEventListener('keydown', onKey);
    $('pk-clear').onclick = () => { q.value = ''; shown = PAGE; active = -1; render(); q.focus(); };
    $('pk-close').onclick = close;
    el.addEventListener('click', e => { if (e.target === el) close(); });
    $('pk-cats').addEventListener('click', e => { const b = e.target.closest('button[data-cat]'); if (!b) return; catFilter = b.dataset.cat; shown = PAGE; active = -1; render(); q.focus({ preventScroll: true }); });
    $('pk-results').addEventListener('click', onResultClick);
    $('pk-tray').addEventListener('click', onTrayClick);
    $('pk-tray').addEventListener('change', e => { const i = e.target.closest('input[data-qty]'); if (!i) return; const v = parseFloat(i.value); if (v > 0) sel.set(i.dataset.qty, v); else sel.delete(i.dataset.qty); render(); });
  }
  function svg(n) {
    const P = { search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>', back: '<path d="M15 5l-7 7 7 7"/>', star: '<path d="M12 3.6l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.2-4.1 5.8-.8z"/>', check: '<path d="M5 12.5l4.2 4.2L19 7"/>', plus: '<path d="M12 5v14M5 12h14"/>', minus: '<path d="M5 12h14"/>' };
    return `<svg viewBox="0 0 24 24" aria-hidden="true" class="pk-ic pk-ic-${n}">${P[n]}</svg>`;
  }

  /* ------------------------------------------------------------------ open / close */
  function open(row, seed) {
    if (!el) build();
    anchorRow = row && row.closest ? row.closest('tr') : null;
    buildIndex(); use = usage();
    stocks = typeof stockMap === 'function' ? stockMap(typeof currentEditId !== 'undefined' ? currentEditId : null) : new Map();
    scanInvoice();
    sel = new Map(); active = -1; shown = PAGE; catFilter = '';
    const q = $('pk-q');
    const cur = anchorRow ? anchorRow.querySelector('.item-desc').value.trim() : '';
    q.value = seed != null ? seed : (cur && !index().list.some(e => e.nameN === norm(cur)) ? cur : '');
    el.classList.remove('hidden');
    document.documentElement.classList.add('pk-lock');
    render();
    setTimeout(() => { q.focus(); const n = q.value.length; try { q.setSelectionRange(n, n); } catch (e) { /* type=search */ } }, 30);
  }
  function close() {
    if (!el) return;
    el.classList.add('hidden'); document.documentElement.classList.remove('pk-lock');
    const r = anchorRow; anchorRow = null;
    if (r && r.isConnected && window.matchMedia('(min-width: 768px)').matches) { const d = r.querySelector('.item-qty'); if (d) d.focus(); }
  }

  /* ------------------------------------------------------------------ render */
  function badgeStock(e) {
    if (!e.p.trackStock || !stocks || !stocks.has(e.id)) return '';
    const st = stocks.get(e.id), low = st <= (Number(e.p.minStock) || 0);
    return `<span class="pk-stock ${st <= 0 ? 'out' : low ? 'low' : 'ok'}" title="${esc(t('In stock'))}">${st <= 0 ? esc(t('Out of stock')) : fmtQty(st) + ' ' + esc(t('in stock'))}</span>`;
  }
  function variantHtml(e, i, single) {
    const on = sel.has(e.id), inv = inInvoice.get(e.nameN);
    const label = single ? e.name : (e.size || e.name);
    return `<div class="pk-v${on ? ' on' : ''}${single ? ' single' : ''}" role="option" aria-selected="${on}" data-id="${esc(e.id)}" data-i="${i}" id="pk-v-${i}" tabindex="-1">
      <button type="button" class="pk-star${e.p.fav ? ' fav' : ''}" data-star="${esc(e.id)}" aria-label="${e.p.fav ? esc(t('Remove from favourites')) : esc(t('Add to favourites'))}">${svg('star')}</button>
      <div class="pk-v-main"><div class="pk-v-name">${esc(label)}</div>
        <div class="pk-v-meta"><span class="pk-price">${money2(e.p.rate)}</span><span>/ ${esc(e.p.unit || 'NOS')}</span>${e.p.sku ? `<span class="pk-sku">${esc(e.p.sku)}</span>` : ''}${badgeStock(e)}${inv ? `<span class="pk-inv">${esc(t('On invoice'))} × ${fmtQty(inv)}</span>` : ''}</div>
        ${single && e.p.specs ? `<div class="pk-v-spec">${esc(e.p.specs)}</div>` : ''}</div>
      <span class="pk-tick" aria-hidden="true">${svg(on ? 'check' : 'plus')}</span></div>`;
  }
  // entries → grouped cards (keeps the order in which groups first appear)
  function groupedHtml(entries, counter) {
    const order = [], byKey = new Map();
    entries.forEach(e => { if (!byKey.has(e.gkey)) { byKey.set(e.gkey, []); order.push(e.gkey); } byKey.get(e.gkey).push(e); });
    return order.map(k => {
      const list = byKey.get(k), all = index().groups.get(k) || list, first = list[0];
      if (all.length === 1) return `<div class="pk-card">${variantHtml(first, counter.i++, true)}</div>`;
      const specs = first.p.specs ? `<span class="pk-g-spec">${esc(first.p.specs)}</span>` : '';
      return `<div class="pk-card"><div class="pk-g-head"><div><div class="pk-g-name">${esc(first.group)}</div><div class="pk-g-sub">${esc(first.category)} · ${all.length} ${esc(t('sizes'))}${list.length < all.length ? ` · ${list.length} ${esc(t('match'))}` : ''}</div></div>${specs}</div>
        <div class="pk-grid">${list.map(e => variantHtml(e, counter.i++, false)).join('')}</div></div>`;
    }).join('');
  }
  function section(title, entries, counter, note) {
    if (!entries.length) return '';
    return `<div class="pk-sec"><div class="pk-sec-t">${esc(title)}${note ? `<span>${esc(note)}</span>` : ''}</div>${entries.map(e => `<div class="pk-card">${variantHtml(e, counter.i++, true)}</div>`).join('')}</div>`;
  }
  function render() {
    const I = index(), q = $('pk-q').value, qn = norm(q);
    const t0 = performance.now();
    // categories
    $('pk-cats').innerHTML = `<button type="button" role="tab" data-cat="" class="${catFilter ? '' : 'on'}" aria-selected="${!catFilter}">${esc(t('All'))} <span>${I.list.length}</span></button>` +
      I.cats.map(c => `<button type="button" role="tab" data-cat="${esc(c.name)}" class="${catFilter === c.name ? 'on' : ''}" aria-selected="${catFilter === c.name}">${esc(c.name)} <span>${c.count}</span></button>`).join('');
    $('pk-clear').style.visibility = q ? 'visible' : 'hidden';
    const counter = { i: 0 };
    let html = '';
    if (!I.list.length) {
      html = `<div class="pk-empty"><b>${esc(t('No products yet'))}</b><p>${esc(t('Add products with sizes in Items, or type a description to use it on this invoice.'))}</p><button type="button" class="pk-btn" data-act="new-product">${esc(t('Add product'))}</button></div>`;
    } else if (!qn && !catFilter) {
      const recIds = [...(state.ui.recentProducts || [])];
      const byDate = [...use.last.entries()].sort((a, b) => (a[1] < b[1] ? 1 : -1)).map(x => x[0]);
      byDate.forEach(id => { if (!recIds.includes(id)) recIds.push(id); });
      const recent = recIds.map(id => I.byId.get(id)).filter(Boolean).slice(0, 6);
      const fav = I.list.filter(e => e.p.fav).slice(0, 30);
      const freq = [...use.freq.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => I.byId.get(id)).filter(Boolean).slice(0, 6);
      html += section(t('Favourites'), fav, counter) + section(t('Recently used'), recent, counter) + section(t('Frequently billed'), freq, counter, freq.length ? t('most billed first') : '');
      const all = search('', '', use);
      html += `<div class="pk-sec"><div class="pk-sec-t">${esc(t('All products'))}<span>${I.list.length}</span></div>${groupedHtml(all.slice(0, shown), counter)}${more(all.length)}</div>`;
    } else {
      const res = search(q, catFilter, use);
      lastQuery = q;
      const custom = q.trim() && !I.list.some(e => e.nameN === qn) ? `<button type="button" class="pk-custom" data-act="custom" id="pk-custom"><span>${esc(t('Use as typed'))}</span><b>“${esc(q.trim())}”</b><em>${esc(t('not in your item list'))}</em></button>` : '';
      html += res.length ? groupedHtml(res.slice(0, shown), counter) + more(res.length) + custom : `<div class="pk-empty"><b>${esc(t('No matching products'))}</b><p>${esc(t('Try a shorter word, a size like 110 or an SKU.'))}</p></div>` + custom;
      $('pk-results').dataset.count = res.length;
    }
    $('pk-results').innerHTML = html;
    window.__pkRenderMs = performance.now() - t0;
    if (active >= counter.i) active = counter.i - 1;
    highlight(false);
    renderTray();
  }
  const more = n => (n > shown ? `<button type="button" class="pk-more" data-act="more">${esc(t('Show more'))} (${n - shown})</button>` : '');

  function renderTray() {
    const ids = [...sel.keys()];
    $('pk-tray').classList.toggle('on', ids.length > 0);
    if (!ids.length) { $('pk-tray').innerHTML = ''; return; }
    const I = index();
    const items = ids.map(id => I.byId.get(id)).filter(Boolean);
    const total = items.reduce((a, e) => a + (Number(e.p.rate) || 0) * (sel.get(e.id) || 0), 0);
    $('pk-tray').innerHTML = `<div class="pk-chips">${items.map(e => `<div class="pk-chip"><span class="pk-chip-n">${esc(e.name)}</span>
        <button type="button" data-dec="${esc(e.id)}" aria-label="${esc(t('Less'))}">${svg('minus')}</button><input type="number" inputmode="decimal" min="0" step="any" data-qty="${esc(e.id)}" value="${sel.get(e.id)}" aria-label="${esc(t('Quantity'))} ${esc(e.name)}"><button type="button" data-inc="${esc(e.id)}" aria-label="${esc(t('More'))}">${svg('plus')}</button></div>`).join('')}</div>
      <div class="pk-tray-bar"><button type="button" class="pk-btn ghost" data-act="clear-sel">${esc(t('Clear'))}</button><div class="pk-sum">${items.length} ${esc(items.length === 1 ? t('item') : t('items'))} · ${money2(total)} <small>${esc(t('before GST'))}</small></div>
        <button type="button" class="pk-btn" id="pk-add" data-act="add">${esc(t('Add to invoice'))}</button></div>`;
  }

  /* ------------------------------------------------------------------ interaction */
  const opts = () => Array.from(el.querySelectorAll('.pk-v'));
  function highlight(scroll) {
    opts().forEach((o, i) => o.classList.toggle('act', i === active));
    const a = $('pk-v-' + active);
    $('pk-q').setAttribute('aria-activedescendant', a ? a.id : '');
    if (a && scroll) a.scrollIntoView({ block: 'nearest' });
  }
  function toggle(id) {
    if (sel.has(id)) sel.delete(id); else sel.set(id, 1);
    const keepActive = active;
    render(); active = keepActive; highlight(false);
  }
  function onKey(e) {
    const n = opts().length;
    if (e.key === 'ArrowDown') { e.preventDefault(); active = Math.min(n - 1, active + 1); highlight(true); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); active = Math.max(-1, active - 1); highlight(true); }
    else if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) { if (sel.size) commit(); else if (active >= 0) { toggle(opts()[active].dataset.id); commit(); } return; }
      if (active >= 0 && opts()[active]) return toggle(opts()[active].dataset.id);
      if (sel.size) return commit();
      if (n === 1) { toggle(opts()[0].dataset.id); return commit(); }     // exactly one match: Enter adds it
      if ($('pk-custom')) return useCustom();
    }
  }
  function onResultClick(e) {
    const star = e.target.closest('[data-star]');
    if (star) { e.stopPropagation(); return toggleFav(star.dataset.star); }
    const act = e.target.closest('[data-act]');
    if (act) {
      if (act.dataset.act === 'more') { shown += PAGE * 2; return render(); }
      if (act.dataset.act === 'custom') return useCustom();
      if (act.dataset.act === 'new-product') { close(); if (typeof switchTab === 'function') switchTab('items'); if (typeof openItemModal === 'function') openItemModal(); return; }
    }
    const v = e.target.closest('.pk-v'); if (!v) return;
    active = Number(v.dataset.i); toggle(v.dataset.id);
  }
  function onTrayClick(e) {
    const inc = e.target.closest('[data-inc]'), dec = e.target.closest('[data-dec]'), act = e.target.closest('[data-act]');
    if (inc) { sel.set(inc.dataset.inc, (sel.get(inc.dataset.inc) || 0) + 1); return renderTray(); }
    if (dec) { const id = dec.dataset.dec, v = (sel.get(id) || 0) - 1; if (v > 0) sel.set(id, v); else { sel.delete(id); return render(); } return renderTray(); }
    if (act && act.dataset.act === 'add') return commit();
    if (act && act.dataset.act === 'clear-sel') { sel.clear(); render(); }
  }
  function toggleFav(id) {
    const e = index().byId.get(id); if (!e) return;
    e.p.fav = !e.p.fav;
    saveState();
    render();
  }
  function useCustom() {
    const text = $('pk-q').value.trim(); if (!text) return;
    const row = anchorRow && anchorRow.isConnected ? anchorRow : emptyRow() || newRow();
    const d = row.querySelector('.item-desc'); d.value = text;
    if (typeof onItemDescChange === 'function') onItemDescChange(d);
    close();
    const r = row.querySelector('.item-rate'); if (r && !(parseFloat(r.value) > 0)) setTimeout(() => r.focus(), 60);
  }
  function emptyRow() {
    return invoiceRows().find(tr => !tr.querySelector('.item-desc').value.trim() && !(parseFloat(tr.querySelector('.item-rate').value) > 0));
  }
  function newRow() { addInvoiceRow(); const rows = invoiceRows(); return rows[rows.length - 1]; }

  // put the selection on the invoice (merging into rows that already have the product)
  function commit() {
    if (!sel.size) return;
    const I = index(), added = [], raised = [];
    let anchor = anchorRow && anchorRow.isConnected ? anchorRow : null;
    for (const [id, qty] of sel) {
      const e = I.byId.get(id); if (!e) continue;
      const names = new Set([e.nameN, ...(e.p.aliases || []).map(norm)]);
      const existing = invoiceRows().find(tr => tr !== anchor && names.has(norm(tr.querySelector('.item-desc').value)))
        || (anchor && names.has(norm(anchor.querySelector('.item-desc').value)) ? anchor : null);
      if (existing) {
        const qi = existing.querySelector('.item-qty');
        qi.value = String(Math.round(((parseFloat(qi.value) || 0) + qty) * 1000) / 1000);
        if (existing === anchor) anchor = null;
        raised.push(existing);
        continue;
      }
      const row = anchor || emptyRow() || newRow();
      anchor = null;
      const d = row.querySelector('.item-desc');
      d.value = e.name;
      if (typeof onItemDescChange === 'function') onItemDescChange(d);    // HSN, GST, unit, rate — the app's own rules
      row.querySelector('.item-qty').value = String(qty);
      added.push(row);
    }
    state.ui.recentProducts = [...sel.keys(), ...(state.ui.recentProducts || []).filter(id => !sel.has(id))].slice(0, RECENT_MAX);
    if (typeof renumberRows === 'function') renumberRows();
    if (typeof refreshForm === 'function') refreshForm();
    saveState();
    close();
    [...added, ...raised].forEach(r => { r.classList.remove('pk-flash'); void r.offsetWidth; r.classList.add('pk-flash'); });
    if (typeof toast === 'function') {
      const parts = [];
      if (added.length) parts.push(`${added.length} ${added.length === 1 ? t('item added') : t('items added')}`);
      if (raised.length) parts.push(`${t('quantity raised for')} ${raised.length} ${raised.length === 1 ? t('item already on the invoice') : t('items already on the invoice')}`);
      toast(parts.join(' · ') || t('Nothing added'), raised.length && !added.length ? 'info' : 'success');
    }
    window.__pkLastCommit = { added: added.length, raised: raised.length };
  }

  /* ------------------------------------------------------------------ hooks into the invoice editor */
  function install() {
    const body = $('invoice-items-body'); if (!body) return;
    // tap / click on a description opens the search (programmatic edits and typing in an already-filled cell are untouched)
    body.addEventListener('click', e => {
      const d = e.target.closest('.item-desc'); if (!d || e.detail === 0) return;
      open(d);
    });
    // keyboard users: typing into an empty description starts a search with that letter
    body.addEventListener('keydown', e => {
      const d = e.target.closest('.item-desc'); if (!d) return;
      if ((e.key === 'Enter' || e.key === 'ArrowDown') && !e.altKey) { e.preventDefault(); return open(d, d.value); }
      if (!d.value && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); open(d, e.key); }
    });
    document.addEventListener('keydown', e => {
      if (isOpen()) return;
      const tab = $('tab-create-invoice');
      if (!tab || tab.classList.contains('hidden')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); open(null); }
    });
  }
  // Android back button closes the picker first
  function back() { if (isOpen()) { close(); return true; } return false; }

  window.HGI_PICKER = { open: (row, seed) => open(row, seed), close, isOpen, back, search: (q, cat) => search(q, cat, usage()), index: () => index(), _commit: commit, _sel: () => sel };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', install); else install();
})();
