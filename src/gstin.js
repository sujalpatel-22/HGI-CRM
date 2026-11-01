/* =====================================================================
   HGI Billing v9 — GSTIN auto-fetch (Buyer form + invoice buyer)
   When a complete, valid GSTIN is typed, the buyer's registered details are fetched from
   GST records through the HGI server (authorised GST data provider). Every field stays
   editable; nothing is filled when the records cannot be reached — the user types it.
   ===================================================================== */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const t = s => (window.HGI_I18N ? window.HGI_I18N.t(s) : s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const enabled = () => !!(window.HGI_SYNC && HGI_SYNC.active());
  let seq = 0, last = null;                       // last successful answer for the GSTIN in the buyer form

  const ERR = {
    offline: 'No internet connection — enter the details manually; you can fetch them later.',
    gst_not_configured: 'GST look-up is not set up on the HGI server yet — enter the details manually.',
    gstin_not_found: 'No taxpayer with this GSTIN was found in GST records. Check the number.',
    invalid_gstin: 'This GSTIN is not valid (check digit). Check the number.',
    gst_unavailable: 'GST records could not be reached right now — enter the details manually or try again.',
    too_many: 'Too many look-ups in a minute — wait a moment and try again.',
    not_signed_in: 'GST look-up works when you are signed in to your HGI cloud account.'
  };
  const statusClass = s => /^active$/i.test(s) ? 'ok' : /cancel|suspend|inactive/i.test(s) ? 'bad' : 'warn';

  function card(d) {
    const st = d.status || t('Unknown');
    const warn = statusClass(st) !== 'ok' ? `<p class="gx-warn">${esc(t('This registration is'))} <strong>${esc(st)}</strong>${d.cancellationDate ? ` ${esc(t('since'))} ${esc(d.cancellationDate)}` : ''}. ${esc(t('A tax invoice to this GSTIN may not be valid — check with the buyer.'))}</p>` : '';
    const row = (k, v) => v ? `<div><dt>${esc(t(k))}</dt><dd>${esc(v)}</dd></div>` : '';
    return `<div class="gx-head"><span class="gx-badge ${statusClass(st)}">${esc(st)}</span><span class="gx-src">${esc(t('From GST records'))} · ${esc(d.source || '')} · ${esc(new Date(d.fetchedAt).toLocaleDateString('en-IN'))}${d.cached ? ' · ' + esc(t('saved copy')) : ''}</span></div>${warn}
      <dl class="gx-dl">${row('Legal name', d.legalName)}${row('Trade name', d.tradeName)}${row('Registered address', [d.address && d.address.line, d.address && d.address.pin].filter(Boolean).join(' – '))}
      ${row('State', `${d.address && d.address.state ? d.address.state : ''} (${d.stateCode})`)}${row('Registered on', d.registrationDate)}${row('Constitution', d.constitution)}${row('Taxpayer type', d.taxpayerType)}
      ${row('Business activity', (d.natureOfBusiness || []).join(', '))}${row('Jurisdiction', [d.stateJurisdiction, d.centreJurisdiction].filter(Boolean).join(' · '))}</dl>`;
  }

  /* ------------------------------------------------------------------ Buyer form */
  function panel() {
    let p = $('gst-fetch');
    if (!p) {
      p = document.createElement('div'); p.id = 'gst-fetch'; p.className = 'gx hidden'; p.setAttribute('aria-live', 'polite');
      const anchor = $('modal-gstin-status'); anchor.parentElement.parentElement.after(p);
    }
    return p;
  }
  function show(html, cls) { const p = panel(); p.className = 'gx ' + (cls || ''); p.innerHTML = html; }
  const fieldIds = { name: 'modal-cust-name', address: 'modal-cust-address', state: 'modal-cust-state', code: 'modal-cust-state-code', pin: 'modal-cust-pin' };
  function valuesFrom(d) { return { name: d.tradeName || d.legalName, address: d.address.line, state: d.address.state, code: d.stateCode, pin: d.address.pin }; }
  // fill empty fields (and fields still holding what an earlier fetch put there); anything the user typed stays
  function fill(d, overwrite) {
    const v = valuesFrom(d), changed = [];
    Object.entries(fieldIds).forEach(([k, id]) => {
      const el = $(id); if (!el || !v[k]) return;
      const auto = el.dataset.gstAuto === '1';
      if (overwrite || !el.value.trim() || auto || (k === 'state' || k === 'code')) { if (el.value !== v[k]) changed.push(k); el.value = v[k]; el.dataset.gstAuto = '1'; }
    });
    return changed;
  }
  async function fetchFor(gstin, fresh) {
    const my = ++seq;
    show(`<div class="gx-load"><span class="gx-spin" aria-hidden="true"></span>${esc(t('Fetching details from GST records…'))}</div>`, 'loading');
    try {
      const d = await HGI_SYNC.gstLookup(gstin, fresh);
      if (my !== seq || $('modal-cust-gstin').value.trim().toUpperCase() !== gstin) return;     // the user typed on
      last = d;
      const filled = fill(d, false);
      const v = valuesFrom(d);
      const differs = Object.entries(fieldIds).some(([k, id]) => v[k] && $(id).value.trim() !== v[k]);
      show(card(d) + `<div class="gx-actions">${differs ? `<button type="button" class="gx-btn" id="gx-use">${esc(t('Use GST details for all fields'))}</button>` : ''}<button type="button" class="gx-link" id="gx-refresh">${esc(t('Fetch again'))}</button></div>
        ${filled.length ? `<p class="gx-note">${esc(t('Filled from GST records — you can still edit any field.'))}</p>` : ''}`, 'done ' + statusClass(d.status));
      const u = $('gx-use'); if (u) u.onclick = () => { fill(d, true); fetchShow(d); };
      $('gx-refresh').onclick = () => fetchFor(gstin, true);
    } catch (e) {
      if (my !== seq) return;
      last = null;
      show(`<p class="gx-err">${esc(t(ERR[e.code] || ('Could not fetch GST details: ' + (e.message || e))))}</p>${e.code === 'gst_unavailable' || e.code === 'offline' ? `<button type="button" class="gx-link" id="gx-retry">${esc(t('Try again'))}</button>` : ''}`, 'error');
      const r = $('gx-retry'); if (r) r.onclick = () => fetchFor(gstin, false);
    }
  }
  function fetchShow(d) { show(card(d) + `<p class="gx-note">${esc(t('All fields now match GST records — you can still edit them.'))}</p>`, 'done ' + statusClass(d.status)); }
  let debounce = null;
  function onGstin() {
    const g = $('modal-cust-gstin').value.trim().toUpperCase();
    const res = validateGSTIN(g);
    clearTimeout(debounce);
    if (res.status !== 'ok' || !/^[0-9]{2}[A-Z0-9]{10}[0-9A-Z]Z[0-9A-Z]$/.test(g)) { seq++; last = null; panel().className = 'gx hidden'; return; }
    if (!enabled()) { show(`<p class="gx-note">${esc(t(ERR.not_signed_in))}</p>`, 'info'); return; }
    seq++;                                                         // an answer for an earlier GSTIN is ignored
    show(`<div class="gx-load"><span class="gx-spin" aria-hidden="true"></span>${esc(t('Fetching details from GST records…'))}</div>`, 'loading');
    debounce = setTimeout(() => fetchFor(g, false), 250);
  }
  function onOpen(id) {
    seq++; last = null;
    Object.values(fieldIds).forEach(f => { const el = $(f); if (el) delete el.dataset.gstAuto; });
    const c = id ? state.customers.find(x => x.id === id) : null;
    if (c && c.gstInfo && c.gstInfo.gstin === (c.gstin || '').toUpperCase()) show(card(c.gstInfo) + `<div class="gx-actions"><button type="button" class="gx-link" id="gx-refresh">${esc(t('Check GST records again'))}</button></div>`, 'done ' + statusClass(c.gstInfo.status));
    else panel().className = 'gx hidden';
    const r = $('gx-refresh'); if (r && c) r.onclick = () => enabled() ? fetchFor(c.gstin.toUpperCase(), true) : show(`<p class="gx-note">${esc(t(ERR.not_signed_in))}</p>`, 'info');
  }
  // the registration details are kept with the buyer (shown again later, and used for the cancelled-GSTIN warning)
  function attachToSaved(id, gstin) {
    if (!last || last.gstin !== gstin) return;
    const c = id ? state.customers.find(x => x.id === id) : state.customers[state.customers.length - 1];
    if (!c || (c.gstin || '').toUpperCase() !== gstin) return;
    const { address, ...rest } = last;
    c.gstInfo = { ...rest, addressLine: address.line };
    saveState();
  }

  /* ------------------------------------------------------------------ invoice form: "Fetch" next to the buyer GSTIN */
  function invoiceButton() {
    const inp = $('inv-buyer-gstin'); if (!inp || $('inv-gst-fetch')) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'inv-gst-fetch'; b.className = 'gx-inv hidden'; b.textContent = t('Fetch GST details');
    inp.parentElement.appendChild(b);
    const upd = () => { const g = inp.value.trim().toUpperCase(); b.classList.toggle('hidden', !(enabled() && validateGSTIN(g).status === 'ok')); };
    inp.addEventListener('input', upd);
    b.onclick = async () => {
      const g = inp.value.trim().toUpperCase();
      b.disabled = true; const label = b.textContent; b.textContent = t('Fetching…');
      try {
        const d = await HGI_SYNC.gstLookup(g, false);
        const v = valuesFrom(d), map = { name: 'inv-buyer-name', address: 'inv-buyer-address', state: 'inv-buyer-state', code: 'inv-buyer-state-code', pin: 'inv-buyer-pin' };
        const filled = [];
        Object.entries(map).forEach(([k, id]) => { const el = $(id); if (el && v[k] && (!el.value.trim() || k === 'state' || k === 'code')) { el.value = v[k]; filled.push(k); } });
        if (typeof refreshForm === 'function') refreshForm();
        const bad = statusClass(d.status) !== 'ok';
        toast(bad ? `${t('GST registration is')} ${d.status}${d.cancellationDate ? ' (' + d.cancellationDate + ')' : ''} — ${t('check before issuing a tax invoice.')}` : `${d.tradeName || d.legalName} · ${t('details filled from GST records')}`, bad ? 'error' : 'success');
      } catch (e) { toast(t(ERR[e.code] || ('Could not fetch GST details: ' + (e.message || e))), 'error'); }
      finally { b.disabled = false; b.textContent = label; }
    };
    upd();
  }

  function install() {
    if (typeof window.onModalGstinInput === 'function' && !window.onModalGstinInput.__gx) {
      const o = window.onModalGstinInput;
      window.onModalGstinInput = function () { const r = o.apply(this, arguments); onGstin(); return r; };
      window.onModalGstinInput.__gx = true;
    }
    if (typeof window.openCustomerModal === 'function' && !window.openCustomerModal.__gx) {
      const o = window.openCustomerModal;
      window.openCustomerModal = function (id) { const r = o.apply(this, arguments); onOpen(id); return r; };
      window.openCustomerModal.__gx = true;
    }
    if (typeof window.saveCustomerFromModal === 'function' && !window.saveCustomerFromModal.__gx) {
      const o = window.saveCustomerFromModal;
      window.saveCustomerFromModal = function () {
        const id = $('modal-cust-id').value, g = $('modal-cust-gstin').value.trim().toUpperCase(), n = state.customers.length;
        const r = o.apply(this, arguments);
        if (id || state.customers.length > n) attachToSaved(id, g);
        return r;
      };
      window.saveCustomerFromModal.__gx = true;
    }
    // typing in a filled field makes it the user's own
    Object.values(fieldIds).forEach(f => { const el = $(f); if (el) el.addEventListener('input', () => { delete el.dataset.gstAuto; }); });
    invoiceButton();
  }
  window.HGI_GSTIN = { install, _last: () => last };
})();
