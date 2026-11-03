/* =====================================================================
   HGI Billing v9.2 — faster everyday work
   - Global search (search button, Ctrl/⌘ K or "/"): documents, buyers, suppliers, products with sizes, and actions,
     each with its next step (open, receipt, WhatsApp, new invoice for a buyer, add a product to the open invoice).
   - Recent items on this device (documents, buyers, products) shown when the search is empty.
   - Quick invoice: a buyer → a new invoice with the buyer filled in; "Repeat last" copies the buyer's last invoice.
   - Dashboard widgets: show / hide and reorder (kept on this device).
   - Document register: more filters (buyer, amount range, supply kind) + sort, and bulk actions on selected documents
     (PDF ZIP, CSV, record full payment).
   Uses only the app's own functions and data; nothing here changes GST calculation or numbering.
   ===================================================================== */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const t = s => (window.HGI_I18N ? window.HGI_I18N.t(s) : s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const ic = (n, c) => (window.HGI_STUDIO && HGI_STUDIO.ic ? HGI_STUDIO.ic(n, c) : '');
  const ls = { get: k => { try { return localStorage.getItem(k); } catch (e) { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch (e) { /* full / blocked */ } } };
  const slot = () => (typeof STORAGE_KEY !== 'undefined' ? STORAGE_KEY : 'hgi');
  const dlg = o => window.HGI_DIALOG(o);
  const norm = s => String(s == null ? '' : s).toLowerCase().replace(/[₹,]/g, '').normalize('NFKD').replace(/[̀-ͯ]/g, '');
  const tab = () => { const s = document.querySelector('[id^="tab-"]:not(.hidden)'); return s ? s.id.slice(4) : ''; };

  /* ================================================================== recent items (this device) */
  const RKEY = () => 'hgi_recent_' + slot();
  function recents() { try { return JSON.parse(ls.get(RKEY()) || '[]').filter(r => r && r.k && r.id); } catch (e) { return []; } }
  function touch(k, id) {
    if (!id) return;
    const list = recents().filter(r => !(r.k === k && r.id === id));
    list.unshift({ k, id: String(id), at: Date.now() });
    ls.set(RKEY(), JSON.stringify(list.slice(0, 15)));
  }

  /* ================================================================== quick invoice */
  function quickInvoice(buyerId, docType, product) {
    const c = state.customers.find(x => x.id === buyerId);
    newDocument(docType || 'INV');
    if (c) {
      const sel = $('inv-customer-select');
      if (sel) { if (!Array.from(sel.options).some(o => o.value === c.id) && typeof populateCustomerDropdown === 'function') populateCustomerDropdown(); sel.value = c.id; populateCustomerData(); }
      touch('buyer', c.id);
    }
    if (product) addProduct(product);
    if (typeof refreshForm === 'function') refreshForm();
    setTimeout(() => { const n = c ? (document.querySelector('#invoice-items-body .item-desc') || $('inv-buyer-name')) : $('inv-buyer-name'); if (n && !product) try { n.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 60);
  }
  function addProduct(p) {
    const body = $('invoice-items-body'); if (!body || !p) return;
    const rows = Array.from(body.rows);
    if (rows.length === 1 && !rows[0].querySelector('.item-desc').value.trim()) rows[0].remove();
    addInvoiceRow({ desc: p.name, hsn: p.hsn || '', gst: Number(p.gst) || 0, qty: 1, unit: p.unit || 'NOS', rate: Number(p.rate) || 0 });
    touch('product', p.id);
    if (typeof refreshForm === 'function') refreshForm();
    toast(`${p.name} ${t('added')}`, 'success');
  }
  function lastDocOf(name, types) {
    const n = String(name || '').trim().toLowerCase();
    return state.invoices.filter(d => (types || ['INV']).includes(d.docType) && !d.cancelled && String(d.buyerName || '').trim().toLowerCase() === n)
      .sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (b.createdAt || '').localeCompare(a.createdAt || '')))[0] || null;
  }
  function repeatLast(buyerId) {
    const c = state.customers.find(x => x.id === buyerId); if (!c) return;
    const d = lastDocOf(c.name); if (!d) return toast(t('No earlier invoice for this buyer'), 'info');
    duplicateInvoice(d.id);
    toast(`${t('Copied from')} ${d.num} — ${t('check quantities and save')}`, 'info');
  }

  /* ================================================================== global search */
  const ACTIONS = [
    ['New invoice', 'invoice bill sale tax', 'invoice', () => newDocument('INV')],
    ['New quotation', 'quote estimate', 'quote', () => newDocument('QUO')],
    ['New proforma invoice', 'pi proforma advance', 'quote', () => newDocument('PI')],
    ['New purchase order', 'po supplier purchase', 'boxplus', () => newDocument('PO')],
    ['New customer PO (order confirmation)', 'cpo order confirmation sales order', 'quote', () => newDocument('CPO')],
    ['New credit note', 'cn return credit', 'credit', () => newDocument('CRN')],
    ['New debit note', 'dn debit', 'debit', () => newDocument('DBN')],
    ['Add buyer', 'customer party client', 'userplus', () => { switchTab('customers'); openCustomerModal(); }],
    ['Add supplier', 'vendor supplier', 'building', () => { switchTab('customers'); window.__newPartyType = 'supplier'; openCustomerModal(); }],
    ['Add product', 'item product stock', 'boxplus', () => { switchTab('items'); openItemModal(); }],
    ['Documents register', 'invoices list register sales', 'docs', () => switchTab('invoices')],
    ['Unpaid invoices', 'outstanding due receivable', 'rupee', () => { $('inv-filter-type').value = 'INV'; $('inv-filter-status').value = 'Unpaid'; switchTab('invoices'); renderInvoiceList(); }],
    ['Overdue invoices', 'late overdue reminder', 'clock', () => { $('inv-filter-type').value = 'INV'; $('inv-filter-status').value = 'Overdue'; switchTab('invoices'); renderInvoiceList(); }],
    ['GST returns (GSTR-1 / 3B)', 'gstr return filing', 'returns', () => switchTab('returns')],
    ['Buyers', 'customers parties', 'buyers', () => switchTab('customers')],
    ['Products & stock', 'items inventory stock', 'items', () => switchTab('items')],
    ['Dashboard', 'home overview', 'home', () => switchTab('dashboard')],
    ['Settings', 'company profile gst settings', 'settings', () => switchTab('settings')],
    ['Customize dashboard', 'widgets layout dashboard', 'spark', () => { switchTab('dashboard'); customizeDashboard(); }],
    ['Export PDFs as ZIP', 'bulk zip pdf export', 'pdf', () => window.HGI_M && HGI_M.bulkExport && HGI_M.bulkExport()],
    ['Share backup', 'backup export json', 'backup', () => window.HGI_M && HGI_M.shareBackup && HGI_M.shareBackup()],
    ['Switch light / dark theme', 'theme dark light night', 'moon', () => window.HGI_M && HGI_M.toggleTheme && HGI_M.toggleTheme()]
  ];
  let pal = null, results = [], active = 0, qTimer = null;

  function ensurePalette() {
    if (pal) return pal;
    pal = document.createElement('div');
    pal.id = 'gsearch'; pal.className = 'gs no-print'; pal.setAttribute('role', 'dialog'); pal.setAttribute('aria-modal', 'true'); pal.setAttribute('aria-label', t('Search'));
    pal.innerHTML = `<div class="gs-card">
      <div class="gs-bar">${ic('search')}<input id="gs-input" type="search" role="combobox" aria-expanded="true" aria-controls="gs-list" aria-autocomplete="list" autocomplete="off" spellcheck="false" enterkeyhint="go"
        placeholder="${esc(t('Search documents, buyers, products, actions…'))}" aria-label="${esc(t('Search documents, buyers, products, actions'))}"><button type="button" class="gs-close" aria-label="${esc(t('Close search'))}">${ic('close')}</button></div>
      <div id="gs-list" class="gs-list" role="listbox" aria-label="${esc(t('Results'))}"></div>
      <div class="gs-foot"><span><kbd>↑</kbd><kbd>↓</kbd> ${esc(t('move'))}</span><span><kbd>Enter</kbd> ${esc(t('open'))}</span><span><kbd>Esc</kbd> ${esc(t('close'))}</span></div></div>`;
    document.body.appendChild(pal);
    const input = pal.querySelector('#gs-input');
    input.addEventListener('input', () => { clearTimeout(qTimer); qTimer = setTimeout(() => run(input.value), 50); });
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); move(e.key === 'ArrowDown' ? 1 : -1); }
      else if (e.key === 'Enter') { e.preventDefault(); clearTimeout(qTimer); if (input.value !== pal.dataset.q) run(input.value); choose(active, 0); }
      else if (e.key === 'Escape') { e.preventDefault(); close(); }
    });
    pal.addEventListener('click', e => {
      if (e.target === pal || e.target.closest('.gs-close')) return close();
      const sub = e.target.closest('[data-sub]'), row = e.target.closest('[data-r]');
      if (row) choose(Number(row.dataset.r), sub ? Number(sub.dataset.sub) : 0);
    });
    pal.addEventListener('mousemove', e => { const row = e.target.closest('[data-r]'); if (row && Number(row.dataset.r) !== active) setActive(Number(row.dataset.r), false); });
    return pal;
  }
  function open(q) {
    ensurePalette();
    pal.classList.add('open'); document.documentElement.classList.add('gs-open');
    const input = pal.querySelector('#gs-input'); input.value = q || '';
    run(input.value);
    setTimeout(() => { try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); } }, 30);
    if (window.HGI_I18N && HGI_I18N.translateTree) HGI_I18N.translateTree(pal);
  }
  function close() { if (!pal) return; pal.classList.remove('open'); document.documentElement.classList.remove('gs-open'); }

  function score(h, words, title) {
    let s = 0;
    for (const w of words) { const i = h.indexOf(w); if (i < 0) return -1; s += i === 0 ? 30 : /\s/.test(h[i - 1] || ' ') ? 18 : 6; }
    if (title && norm(title) === words.join(' ')) s += 60;
    return s;
  }
  const money2 = n => (typeof money === 'function' ? money(n) : '₹' + n);
  function docItem(d) {
    const inv = d.docType === 'INV', bal = inv && !d.cancelled ? balanceOf(d) : 0;
    const subs = [['Open', () => viewInvoiceDetail(d.id)]];
    if (!d.cancelled) subs.push(['Edit', () => editInvoice(d.id)]);
    if (bal > 0.009) subs.push(['Receipt', () => openPaymentModal(d.id)]);
    subs.push(['WhatsApp', () => shareWhatsApp(d.id)]);
    if (typeof convertsToInvoice === 'function' && convertsToInvoice(d.docType) && !d.cancelled) subs.push(['To invoice', () => convertToInvoice(d.id)]);
    return { g: 'Documents', icon: { CRN: 'credit', DBN: 'debit', QUO: 'quote', PI: 'quote', CPO: 'quote', PO: 'boxplus' }[d.docType] || 'invoice',
      title: `${d.num}`, sub: `${DOC_TYPES[d.docType] ? DOC_TYPES[d.docType].short : d.docType} · ${d.buyerName || ''} · ${fmtDate(d.date)}`,
      meta: money2(d.grandTotal || 0), tag: displayStatus(d), subs, k: 'doc', id: d.id };
  }
  function buyerItem(c) {
    const sup = c.partyType === 'supplier';
    const subs = sup ? [['New PO', () => quickInvoice(c.id, 'PO')], ['Edit', () => { switchTab('customers'); openCustomerModal(c.id); }]]
      : [['New invoice', () => quickInvoice(c.id)], ['Repeat last', () => repeatLast(c.id)], ['Quotation', () => quickInvoice(c.id, 'QUO')], ['Edit', () => { switchTab('customers'); openCustomerModal(c.id); }],
        ['Documents', () => { window.__docAdv = Object.assign({}, window.__docAdv, { buyer: c.name }); $('inv-filter-type').value = ''; $('inv-filter-status').value = ''; switchTab('invoices'); renderInvoiceList(); renderAdvPills(); }]];
    if (!sup && !lastDocOf(c.name)) subs.splice(1, 1);
    return { g: sup ? 'Suppliers' : 'Buyers', icon: sup ? 'building' : 'user', title: c.name, sub: [c.gstin || t('Unregistered'), c.city || c.state || ''].filter(Boolean).join(' · '), meta: '', subs, k: 'buyer', id: c.id };
  }
  function productItem(p) {
    const editing = tab() === 'create-invoice';
    const stock = p.trackStock && typeof stockOf === 'function' ? stockOf(p) : null;
    const subs = editing ? [['Add to invoice', () => addProduct(p)], ['Edit', () => { switchTab('items'); openItemModal(p.id); }]]
      : [['New invoice', () => quickInvoice(null, 'INV', p)], ['Edit', () => { switchTab('items'); openItemModal(p.id); }]];
    return { g: 'Products', icon: 'items', title: p.name, sub: [p.hsn ? 'HSN ' + p.hsn : '', (Number(p.gst) || 0) + '% GST', p.unit, stock !== null ? `${t('stock')} ${stock}` : ''].filter(Boolean).join(' · '),
      meta: money2(Number(p.rate) || 0), subs, k: 'product', id: p.id, low: stock !== null && stock <= (Number(p.minStock) || 0) };
  }
  function actionItem(a) { return { g: 'Actions', icon: a[2], title: t(a[0]), sub: '', meta: '', subs: [['Go', a[3]]], k: 'action', id: a[0] }; }

  function run(q) {
    pal.dataset.q = q;
    const words = norm(q).split(/\s+/).filter(Boolean);
    const groups = [];
    if (!words.length) {
      const rec = recents().map(r => r.k === 'doc' ? (state.invoices.find(d => d.id === r.id) && docItem(state.invoices.find(d => d.id === r.id)))
        : r.k === 'buyer' ? (state.customers.find(c => c.id === r.id) && buyerItem(state.customers.find(c => c.id === r.id)))
        : r.k === 'product' ? (state.products.find(p => p.id === r.id) && productItem(state.products.find(p => p.id === r.id))) : null).filter(Boolean).slice(0, 8);
      rec.forEach(x => { x.g = 'Recent'; });
      if (rec.length) groups.push(['Recent', rec]);
      groups.push(['Actions', ACTIONS.slice(0, 8).map(actionItem)]);
    } else {
      const docs = [];
      for (const d of state.invoices) { const s = score(typeof docHaystack === 'function' ? docHaystack(d) : norm(`${d.num} ${d.buyerName}`), words, d.num); if (s >= 0) docs.push([s + (d.date > addDays(todayISO(), -60) ? 5 : 0), d]); }
      docs.sort((a, b) => b[0] - a[0] || (a[1].date < b[1].date ? 1 : -1));
      const buyers = [], prods = [], acts = [];
      for (const c of state.customers) { const s = score(norm(`${c.name} ${c.gstin || ''} ${c.phone || ''} ${c.city || ''} ${c.state || ''}`), words, c.name); if (s >= 0) buyers.push([s, c]); }
      for (const p of state.products) { const s = score(norm(`${p.name} ${p.hsn || ''} ${p.sku || ''} ${p.category || ''} ${p.specs || ''}`), words, p.name); if (s >= 0) prods.push([s, p]); }
      for (const a of ACTIONS) { const s = score(norm(`${t(a[0])} ${a[0]} ${a[1]}`), words, a[0]); if (s >= 0) acts.push([s, a]); }
      buyers.sort((a, b) => b[0] - a[0]); prods.sort((a, b) => b[0] - a[0]); acts.sort((a, b) => b[0] - a[0]);
      const sup = buyers.filter(([, c]) => c.partyType === 'supplier'), buy = buyers.filter(([, c]) => c.partyType !== 'supplier');
      // the group whose best match is strongest comes first
      const g = [['Actions', acts.slice(0, 4).map(x => actionItem(x[1])), acts[0] ? acts[0][0] : -1], ['Documents', docs.slice(0, 8).map(x => docItem(x[1])), docs[0] ? docs[0][0] + 1 : -1, docs.length],
        ['Buyers', buy.slice(0, 6).map(x => buyerItem(x[1])), buy[0] ? buy[0][0] + 2 : -1, buy.length], ['Suppliers', sup.slice(0, 4).map(x => buyerItem(x[1])), sup[0] ? sup[0][0] : -1, sup.length],
        ['Products', prods.slice(0, 8).map(x => productItem(x[1])), prods[0] ? prods[0][0] + (tab() === 'create-invoice' ? 40 : 0) : -1, prods.length]].filter(x => x[1].length);
      g.sort((a, b) => b[2] - a[2]);
      g.forEach(x => groups.push([x[0], x[1], x[3]]));
    }
    results = []; let html = '';
    groups.forEach(([name, items, total]) => {
      html += `<div class="gs-g" role="presentation">${esc(t(name))}${total > items.length ? ` <span>${items.length} ${esc(t('of'))} ${total}</span>` : ''}</div>`;
      items.forEach(it => {
        const i = results.push(it) - 1;
        html += `<div class="gs-r${it.low ? ' low' : ''}" role="option" id="gs-o${i}" data-r="${i}" aria-selected="false">
          <span class="gs-ic">${ic(it.icon)}</span><span class="gs-t"><b>${esc(it.title)}</b>${it.sub ? `<small>${esc(it.sub)}</small>` : ''}</span>
          ${it.meta || it.tag ? `<span class="gs-m">${it.meta ? `<b>${esc(it.meta)}</b>` : ''}${it.tag ? `<small class="gs-tag t-${esc(String(it.tag).toLowerCase().replace(/\W+/g, '-'))}">${esc(t(it.tag))}</small>` : ''}</span>` : ''}
          <span class="gs-subs">${it.subs.map(([l], j) => `<button type="button" data-sub="${j}" tabindex="-1" class="${j === 0 ? 'p' : ''}">${esc(t(l))}</button>`).join('')}</span></div>`;
      });
    });
    if (!results.length) html = `<div class="gs-empty"><b>${esc(t('Nothing found'))}</b><p>${esc(t('Try a document number, buyer name, GSTIN, product or amount.'))}</p></div>`;
    pal.querySelector('#gs-list').innerHTML = html;
    setActive(0, false);
  }
  function setActive(i, scroll = true) {
    if (!results.length) { active = 0; return; }
    active = (i + results.length) % results.length;
    pal.querySelectorAll('.gs-r').forEach(r => { const on = Number(r.dataset.r) === active; r.classList.toggle('on', on); r.setAttribute('aria-selected', on); });
    pal.querySelector('#gs-input').setAttribute('aria-activedescendant', 'gs-o' + active);
    const el = $('gs-o' + active); if (el && scroll) el.scrollIntoView({ block: 'nearest' });
  }
  function move(d) { setActive(active + d); }
  function choose(i, sub) {
    const it = results[i]; if (!it) return;
    const fn = (it.subs[sub] || it.subs[0])[1];
    if (it.k !== 'action') touch(it.k, it.id);
    close();
    try { fn(); } catch (e) { console.warn('[HGI] search action failed', e); toast(t('That could not be opened'), 'error'); }
  }

  function installSearchButtons() {
    // phone header: a search button next to the account button; rail (tablet / desktop): a search field-like button
    const head = document.querySelector('#app-container > header > div'), av = $('app-avatar');
    if (head && !$('gs-btn')) {
      const b = document.createElement('button'); b.type = 'button'; b.id = 'gs-btn'; b.className = 'gs-btn'; b.setAttribute('aria-label', t('Search')); b.innerHTML = ic('search');
      b.onclick = () => open('');
      if (av) av.before(b); else head.appendChild(b);
    }
    const rail = document.getElementById('rail-new');
    if (rail && !$('gs-rail')) {
      const b = document.createElement('button'); b.type = 'button'; b.id = 'gs-rail'; b.className = 'gs-rail';
      b.innerHTML = `${ic('search')}<span>${esc(t('Search'))}</span><kbd>${/Mac|iPhone|iPad/.test(navigator.platform || '') ? '⌘' : 'Ctrl'} K</kbd>`;
      b.onclick = () => open(''); rail.after(b);
    }
    document.addEventListener('keydown', e => {
      const typing = e.target.closest && e.target.closest('input, textarea, select, [contenteditable]');
      // on the invoice screen Ctrl/⌘ K stays the product search (v8.3); everywhere else it is the global search
      if ((e.key === 'k' || e.key === 'K') && (e.ctrlKey || e.metaKey)) { if (tab() === 'create-invoice' && !(pal && pal.classList.contains('open'))) return; e.preventDefault(); pal && pal.classList.contains('open') ? close() : open(''); }
      else if (e.key === '/' && !typing && !document.querySelector('.acct-dlg, .fixed.inset-0:not(.hidden)')) { e.preventDefault(); open(''); }
    });
  }

  /* ================================================================== dashboard widgets */
  const WIDGETS = [['b-hero', 'Money to collect'], ['b-qa', 'Quick actions'], ['b-kpis', 'This month (sales, GST, received)'], ['b-ring', 'Collection this year'],
    ['b-flow', 'Cash flow'], ['b-alerts', 'Needs attention'], ['b-recent', 'Recent documents'], ['b-owes', 'Who owes the most']];
  const DKEY = 'hgi_dash_layout';
  function layout() { try { const v = JSON.parse(ls.get(DKEY) || 'null'); if (v && Array.isArray(v.order)) return { order: v.order.filter(k => WIDGETS.some(w => w[0] === k)), hidden: (v.hidden || []).filter(k => WIDGETS.some(w => w[0] === k)) }; } catch (e) { /* default */ } return null; }
  function applyLayout() {
    const b = $('bento'); if (!b) return;
    const l = layout();
    b.classList.toggle('custom', !!l);
    WIDGETS.forEach(([k]) => { const el = b.querySelector(':scope > .' + k); if (!el) return; el.style.order = l ? String(l.order.indexOf(k) < 0 ? 99 : l.order.indexOf(k)) : ''; el.classList.toggle('w-hidden', !!(l && l.hidden.includes(k))); });
  }
  async function customizeDashboard() {
    const l = layout() || { order: WIDGETS.map(w => w[0]), hidden: [] };
    WIDGETS.forEach(([k]) => { if (!l.order.includes(k)) l.order.push(k); });
    let order = l.order.slice(), hidden = new Set(l.hidden);
    const label = k => t((WIDGETS.find(w => w[0] === k) || [k, k])[1]);
    const body = () => `<p class="ed-small">${esc(t('Choose what the dashboard shows and in which order. This is saved on this device.'))}</p><ul class="wd-list" id="wd-list">${order.map((k, i) =>
      `<li data-k="${k}"><label class="wd-ck"><input type="checkbox" ${hidden.has(k) ? '' : 'checked'} data-k="${k}"><span>${esc(label(k))}</span></label>
        <span class="wd-mv"><button type="button" data-up="${k}" ${i === 0 ? 'disabled' : ''} aria-label="${esc(t('Move up'))}: ${esc(label(k))}">${ic('chevl', 'up')}</button><button type="button" data-dn="${k}" ${i === order.length - 1 ? 'disabled' : ''} aria-label="${esc(t('Move down'))}: ${esc(label(k))}">${ic('chevr', 'dn')}</button></span></li>`).join('')}</ul>`;
    const p = dlg({ title: t('Customize dashboard'), body: body(), buttons: [{ label: t('Reset'), value: 'reset' }, { label: t('Cancel'), value: false }, { label: t('Save'), value: 'save', primary: true }] });
    const host = () => $('wd-list');
    const onClick = e => {
      const list = host(); if (!list || !list.contains(e.target)) return;
      const up = e.target.closest('[data-up]'), dn = e.target.closest('[data-dn]');
      if (up || dn) {
        e.preventDefault(); e.stopPropagation();
        const k = (up || dn).dataset.up || (up || dn).dataset.dn, i = order.indexOf(k), j = i + (up ? -1 : 1);
        if (j < 0 || j >= order.length) return;
        [order[i], order[j]] = [order[j], order[i]];
        list.outerHTML = body().replace(/^[\s\S]*?(<ul)/, '$1');
        const btn = document.querySelector(`#wd-list [data-${up ? 'up' : 'dn'}="${k}"]`); if (btn && !btn.disabled) btn.focus();
      }
    };
    const onChange = e => { if (e.target.matches('#wd-list input[type=checkbox]')) { if (e.target.checked) hidden.delete(e.target.dataset.k); else hidden.add(e.target.dataset.k); } };
    document.addEventListener('click', onClick, true); document.addEventListener('change', onChange, true);
    const v = await p;
    document.removeEventListener('click', onClick, true); document.removeEventListener('change', onChange, true);
    if (v === 'reset') { try { localStorage.removeItem(DKEY); } catch (e) { /* ignore */ } applyLayout(); toast(t('Dashboard reset'), 'info'); }
    else if (v === 'save') {
      if (hidden.size === WIDGETS.length) return toast(t('Keep at least one widget'), 'error');
      ls.set(DKEY, JSON.stringify({ order, hidden: [...hidden] })); applyLayout(); if (window.HGI_STUDIO && HGI_STUDIO.fitAll) HGI_STUDIO.fitAll($('bento')); toast(t('Dashboard saved'), 'success');
    }
  }
  function installDashboard() {
    const acts = document.querySelector('#tab-dashboard .dh-actions');
    const head = document.querySelector('#tab-dashboard .dash-head');
    if (head && !$('dash-customize')) {
      const b = document.createElement('button'); b.type = 'button'; b.id = 'dash-customize'; b.className = 'btn-ghost dash-customize';
      b.innerHTML = `${ic('settings')}<span>${esc(t('Customize'))}</span>`; b.setAttribute('aria-label', t('Customize dashboard'));
      b.onclick = customizeDashboard;
      if (acts) acts.prepend(b); else head.appendChild(b);
      // phones hide .dh-actions: give the button its own place under the greeting
      const greet = $('dash-greet');
      if (greet && !$('dash-customize-m')) { const m = b.cloneNode(true); m.id = 'dash-customize-m'; m.className = 'dash-customize-m'; m.onclick = customizeDashboard; greet.after(m); }
    }
    applyLayout();
  }

  /* ================================================================== document register: filters, sort, bulk */
  const AKEY = 'hgi_doc_adv';
  function loadAdv() { try { window.__docAdv = JSON.parse(sessionStorage.getItem(AKEY) || '{}') || {}; } catch (e) { window.__docAdv = {}; } }
  function saveAdv() { try { sessionStorage.setItem(AKEY, JSON.stringify(window.__docAdv || {})); } catch (e) { /* ignore */ } }
  const KINDS = { '': 'Any supply', b2b: 'B2B (registered buyer)', b2c: 'B2C (unregistered)', intra: 'Within state (CGST + SGST)', inter: 'Other state (IGST)', export: 'Export / SEZ' };
  const SORTS = { '': 'Newest first', oldest: 'Oldest first', high: 'Amount: high to low', low: 'Amount: low to high', balance: 'Balance due: high to low' };
  function renderAdvPills() {
    const host = $('doc-adv-pills'); if (!host) return;
    const a = window.__docAdv || {}, pills = [];
    if (a.buyer) pills.push(['buyer', `${t('Buyer')}: ${a.buyer}`]);
    if (a.min !== undefined && a.min !== '') pills.push(['min', `≥ ₹${a.min}`]);
    if (a.max !== undefined && a.max !== '') pills.push(['max', `≤ ₹${a.max}`]);
    if (a.kind) pills.push(['kind', t(KINDS[a.kind])]);
    if (a.sort) pills.push(['sort', t(SORTS[a.sort])]);
    host.innerHTML = pills.map(([k, l]) => `<button type="button" class="adv-pill" data-k="${k}" aria-label="${esc(t('Remove filter'))}: ${esc(l)}"><span>${esc(l)}</span>${ic('close')}</button>`).join('')
      + (pills.length > 1 ? `<button type="button" class="adv-pill clear" data-k="*">${esc(t('Clear all'))}</button>` : '');
    host.hidden = !pills.length;
  }
  async function openFilters() {
    const a = Object.assign({}, window.__docAdv || {});
    const names = [...new Set(state.invoices.map(d => String(d.buyerName || '').trim()).filter(Boolean))].sort((x, y) => x.localeCompare(y));
    const opt = (o, v) => Object.entries(o).map(([k, l]) => `<option value="${k}" ${k === (v || '') ? 'selected' : ''}>${esc(t(l))}</option>`).join('');
    const body = `<div class="adv-grid">
      <label class="ed-f"><span>${esc(t('Buyer / supplier'))}</span><input class="inp" id="adv-buyer" list="adv-buyers" value="${esc(a.buyer || '')}" placeholder="${esc(t('Any'))}" autocomplete="off"></label>
      <datalist id="adv-buyers">${names.slice(0, 800).map(n => `<option value="${esc(n)}"></option>`).join('')}</datalist>
      <div class="adv-two"><label class="ed-f"><span>${esc(t('Amount from (₹)'))}</span><input class="inp" id="adv-min" type="number" inputmode="decimal" min="0" value="${esc(a.min ?? '')}"></label>
        <label class="ed-f"><span>${esc(t('Amount to (₹)'))}</span><input class="inp" id="adv-max" type="number" inputmode="decimal" min="0" value="${esc(a.max ?? '')}"></label></div>
      <div class="adv-two"><label class="ed-f"><span>${esc(t('Date from'))}</span><input class="inp" id="adv-from" type="date" value="${esc($('inv-filter-from').value)}"></label>
        <label class="ed-f"><span>${esc(t('Date to'))}</span><input class="inp" id="adv-to" type="date" value="${esc($('inv-filter-to').value)}"></label></div>
      <label class="ed-f"><span>${esc(t('Supply'))}</span><select class="inp" id="adv-kind">${opt(KINDS, a.kind)}</select></label>
      <label class="ed-f"><span>${esc(t('Sort'))}</span><select class="inp" id="adv-sort">${opt(SORTS, a.sort)}</select></label></div>`;
    let got = null;
    const grab = e => { if (e.target.closest('.acct-dlg button')) got = { buyer: ($('adv-buyer') || {}).value || '', min: ($('adv-min') || {}).value || '', max: ($('adv-max') || {}).value || '', kind: ($('adv-kind') || {}).value || '', sort: ($('adv-sort') || {}).value || '', from: ($('adv-from') || {}).value || '', to: ($('adv-to') || {}).value || '' }; };
    document.addEventListener('click', grab, true);
    const v = await dlg({ title: t('Filter documents'), body, buttons: [{ label: t('Clear'), value: 'clear' }, { label: t('Cancel'), value: false }, { label: t('Apply'), value: 'apply', primary: true }] });
    document.removeEventListener('click', grab, true);
    if (!v) return;
    if (v === 'clear') { window.__docAdv = {}; $('inv-filter-from').value = ''; $('inv-filter-to').value = ''; }
    else if (got) {
      if (got.min !== '' && got.max !== '' && Number(got.min) > Number(got.max)) return toast(t('"Amount from" is more than "Amount to"'), 'error');
      if (got.from && got.to && got.from > got.to) return toast(t('"From" date is after "To" date'), 'error');
      window.__docAdv = { buyer: got.buyer.trim(), min: got.min, max: got.max, kind: got.kind, sort: got.sort };
      Object.keys(window.__docAdv).forEach(k => { if (window.__docAdv[k] === '') delete window.__docAdv[k]; });
      $('inv-filter-from').value = got.from; $('inv-filter-to').value = got.to;
    }
    saveAdv(); renderInvoiceList(); renderAdvPills();
  }

  const sel = new Set();
  let selecting = false;
  function setSelecting(on) {
    selecting = on; if (!on) sel.clear();
    document.documentElement.classList.toggle('doc-selecting', on);
    const b = $('doc-select-btn'); if (b) { b.setAttribute('aria-pressed', on); b.querySelector('span').textContent = on ? t('Done') : t('Select'); }
    paintSel();
  }
  function paintSel() {
    document.querySelectorAll('#invoices-list-tbody tr[data-id]').forEach(tr => { const on = sel.has(tr.dataset.id); tr.classList.toggle('row-sel', on); tr.setAttribute('aria-selected', selecting ? String(on) : 'false'); });
    let bar = $('bulk-bar');
    if (!selecting) { if (bar) bar.remove(); return; }
    if (!bar) {
      bar = document.createElement('div'); bar.id = 'bulk-bar'; bar.className = 'bulk-bar no-print'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', t('Selected documents'));
      bar.innerHTML = `<span class="bb-n" aria-live="polite"></span><button type="button" data-b="all">${esc(t('Select all'))}</button><button type="button" data-b="zip">${ic('pdf')}<span>PDF ZIP</span></button>
        <button type="button" data-b="csv">${ic('list')}<span>CSV</span></button><button type="button" data-b="paid">${ic('rupee')}<span>${esc(t('Mark paid'))}</span></button><button type="button" data-b="x" class="bb-x" aria-label="${esc(t('Stop selecting'))}">${ic('close')}</button>`;
      document.body.appendChild(bar);
      bar.addEventListener('click', e => { const b = e.target.closest('[data-b]'); if (b) bulk(b.dataset.b); });
    }
    const docs = selected();
    bar.querySelector('.bb-n').textContent = `${docs.length} ${t(docs.length === 1 ? 'selected' : 'selected')}`;
    bar.querySelectorAll('[data-b="zip"], [data-b="csv"]').forEach(b => { b.disabled = !docs.length; });
    bar.querySelector('[data-b="paid"]').disabled = !docs.some(d => d.docType === 'INV' && !d.cancelled && balanceOf(d) > 0.009);
  }
  const selected = () => state.invoices.filter(d => sel.has(d.id));
  async function bulk(a) {
    if (a === 'x') return setSelecting(false);
    if (a === 'all') { const list = getFilteredInvoices(); const all = list.every(d => sel.has(d.id)); list.forEach(d => (all ? sel.delete(d.id) : sel.add(d.id))); return paintSel(); }
    const docs = selected(); if (!docs.length) return;
    if (a === 'csv') {
      const head = ['Type', 'Number', 'Date', 'Against Invoice', 'Party', 'GSTIN', 'Supply Type', 'Place of Supply', 'Reverse Charge', 'Taxable', 'CGST', 'SGST', 'IGST', 'Round Off', 'Total', 'Received (incl TDS)', 'Balance', 'Status', 'E-Way Bill', 'IRN', 'PO No'];
      const rows = docs.map(d => [d.docType, d.num, fmtDate(d.date), d.refNum || '', d.buyerName, d.buyerGstin || '', d.supplyType, stateLabel(d.pos), d.reverseCharge ? 'Y' : 'N',
        d.taxable, d.cgst, d.sgst, d.igst, d.roundoff, d.grandTotal, settledOf(d), balanceOf(d), displayStatus(d), d.ewbNo || '', d.irn || '', d.poNum || '']);
      downloadBlob(new Blob([toCSV([head, ...rows])], { type: 'text/csv;charset=utf-8' }), `Selected_Documents_${todayISO()}.csv`);
      return toast(`${t('Exported')} ${docs.length}`, 'success');
    }
    if (a === 'zip') {
      if (!(window.HGI_APP && HGI_APP.isNative && window.HGI_M && HGI_M.runBulk)) return toast(t('Bulk PDF export is available in the Android app.'), 'info');
      const action = await dlg({ title: t('Export PDFs as ZIP'), body: `<p>${docs.length} ${esc(t('documents'))}</p>`, buttons: [{ label: t('Cancel'), value: false }, { label: t('Share ZIP'), value: 'share' }, { label: t('Save ZIP'), value: 'save', primary: true }] });
      if (!action) return;
      return HGI_M.runBulk(docs.slice().sort((x, y) => (x.date < y.date ? -1 : 1)), { type: 'ALL', copies: false }, action);
    }
    if (a === 'paid') {
      const due = docs.filter(d => d.docType === 'INV' && !d.cancelled && balanceOf(d) > 0.009);
      if (!due.length) return toast(t('None of the selected invoices has a balance'), 'info');
      const total = due.reduce((s, d) => s + balanceOf(d), 0);
      let f = { date: todayISO(), mode: 'NEFT' };
      const grab = e => { if (e.target.closest('.acct-dlg button')) f = { date: ($('bp-date') || {}).value || todayISO(), mode: ($('bp-mode') || {}).value || 'NEFT', ref: ($('bp-ref') || {}).value || '' }; };
      document.addEventListener('click', grab, true);
      const ok = await dlg({ title: t('Record full payment'), body: `<p>${esc(t('A receipt for the full balance is recorded on each of'))} <b>${due.length}</b> ${esc(t('invoices'))} — <b>${esc(money2(Math.round(total * 100) / 100))}</b>.${docs.length > due.length ? ` ${docs.length - due.length} ${esc(t('selected documents have no balance and are skipped.'))}` : ''}</p>
        <div class="adv-two"><label class="ed-f"><span>${esc(t('Received on'))}</span><input class="inp" type="date" id="bp-date" value="${todayISO()}"></label>
        <label class="ed-f"><span>${esc(t('Mode'))}</span><select class="inp" id="bp-mode">${['NEFT', 'RTGS', 'IMPS', 'UPI', 'Cheque', 'Cash'].map(m => `<option>${m}</option>`).join('')}</select></label></div>
        <label class="ed-f"><span>${esc(t('Reference (optional)'))}</span><input class="inp" id="bp-ref" maxlength="40"></label>
        <p class="ed-small">${esc(t('Use this only when each invoice was paid in full without TDS. Partial payments and TDS: record them one by one.'))}</p>`,
        buttons: [{ label: t('Cancel'), value: false }, { label: t('Record'), value: true, primary: true }] });
      document.removeEventListener('click', grab, true);
      if (!ok) return;
      if (f.mode === 'Cash' && due.some(d => balanceOf(d) >= 200000)) return toast(t('Cash receipts of ₹2 lakh or more are not allowed (Sec 269ST) — choose another mode or record them one by one.'), 'error');
      if (f.date > todayISO()) return toast(t('The receipt date cannot be in the future'), 'error');
      due.forEach(d => { const amount = Math.round(balanceOf(d) * 100) / 100; d.payments = d.payments || []; d.payments.push({ id: uid('PAY'), date: f.date, amount, tds: 0, mode: f.mode, ref: (f.ref || '').trim() }); d.updatedAt = new Date().toISOString(); });
      saveState(); renderAll(); paintSel();
      return toast(`${due.length} ${t('receipts recorded')} — ${money2(Math.round(total * 100) / 100)}`, 'success');
    }
  }
  function installRegister() {
    loadAdv();
    const bar = $('doc-chips'), search = $('inv-search');
    if (!search || $('doc-tools')) return;
    const tools = document.createElement('div'); tools.id = 'doc-tools'; tools.className = 'doc-tools no-print';
    tools.innerHTML = `<button type="button" id="doc-filter-btn" class="dt-btn">${ic('filter')}<span>${esc(t('Filter & sort'))}</span></button>
      <button type="button" id="doc-select-btn" class="dt-btn" aria-pressed="false">${ic('check')}<span>${esc(t('Select'))}</span></button>
      <div id="doc-adv-pills" class="adv-pills" hidden></div>`;
    (bar || search.parentElement).after(tools);
    $('doc-filter-btn').onclick = openFilters;
    $('doc-select-btn').onclick = () => setSelecting(!selecting);
    $('doc-adv-pills').addEventListener('click', e => {
      const p = e.target.closest('.adv-pill'); if (!p) return;
      if (p.dataset.k === '*') window.__docAdv = {}; else delete window.__docAdv[p.dataset.k];
      saveAdv(); renderInvoiceList(); renderAdvPills();
    });
    // selection mode: a tap on a row selects it (before the row's own action sheet / buttons)
    document.addEventListener('click', e => {
      if (!selecting) return;
      const tr = e.target.closest('#invoices-list-tbody tr[data-id]'); if (!tr) return;
      e.preventDefault(); e.stopPropagation();
      if (sel.has(tr.dataset.id)) sel.delete(tr.dataset.id); else sel.add(tr.dataset.id);
      paintSel();
    }, true);
    renderAdvPills();
  }

  /* ================================================================== hooks */
  function after(name, fn) {
    const orig = window[name]; if (typeof orig !== 'function') return;
    window[name] = function () { const out = orig.apply(this, arguments); try { fn.apply(this, arguments); } catch (e) { console.warn('[HGI] flow', e); } return out; };
  }
  function install() {
    installSearchButtons();
    installDashboard();
    installRegister();
    after('editInvoice', id => touch('doc', id));
    after('openCustomerModal', id => { if (id) touch('buyer', id); });
    after('openItemModal', id => { if (id) touch('product', id); });
    after('renderInvoiceList', () => { paintSel(); });
    after('renderDashboard', applyLayout);
    after('switchTab', tb => { if (tb !== 'invoices' && selecting) setSelecting(false); });
  }

  window.HGI_FLOW = { install, open, close, quickInvoice, repeatLast, addProduct, customizeDashboard, applyLayout, openFilters, setSelecting, recents, touch, _sel: sel };
})();
