/* =====================================================================
   HGI Billing v9.1 — E-Invoice (IRN) & E-Way Bill
   One workflow on the invoice: check eligibility → preview / validation → report to the government system through the
   HGI server (NIC IRP / e-way bill system via HGI's GSP) → IRN, acknowledgement, signed QR and e-way bill number are
   written into the invoice, which then syncs to every device like any other change.
   Nothing here creates an IRN, QR code or e-way bill number: they come only from the government system's answer.
   When the server, the API login or the internet is missing, the user gets a clear message and no number.
   ===================================================================== */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const t = s => (window.HGI_I18N ? window.HGI_I18N.t(s) : s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const S = () => window.HGI_SYNC;
  const signedIn = () => !!(S() && S().active());
  const feats = () => { const f = S() && S().features(); return f && f.checked ? (f.edoc || { irp: false, ewb: false, env: null }) : null; };
  const dlg = o => window.HGI_DIALOG(o);
  const H24 = 24 * 3600e3;
  let busy = '', featTried = false;

  const ERR = {
    offline: 'No internet connection — nothing was sent to the GST system. Try again when you are online.',
    not_signed_in: 'E-invoice and e-way bill work when you are signed in to your HGI cloud account.',
    EDOC_NOT_CONFIGURED: 'E-invoice and e-way bill access is not set up on the HGI server yet. Nothing was sent. You can still type numbers from the government portal below.',
    IRP_NOT_CONFIGURED: 'E-invoice (IRP) access is not set up on the HGI server yet. Nothing was sent.',
    EWB_NOT_CONFIGURED: 'E-way bill system access is not set up on the HGI server yet. Nothing was sent.',
    NO_CREDENTIALS: 'Add your e-invoice / e-way bill API login first: Settings → E-Invoice & E-Way Bill.',
    CREDENTIALS_ENV: 'Your saved API login is for a different GST system (sandbox / production). Enter it again in Settings → E-Invoice & E-Way Bill.',
    EDOC_BUSY: 'This document is being reported from another device right now. Wait a minute and refresh the status.',
    too_many: 'Too many requests in a minute — wait a moment and try again.'
  };
  function errText(e) {
    const b = e.body || {};
    let m = t(ERR[e.code] || e.message || String(e));
    const list = (b.errors || []).filter(x => x && x.message && !String(m).includes(x.message));
    if (list.length) m += '\n• ' + list.map(x => (x.code && /^\d+$/.test(x.code) ? x.code + ': ' : '') + x.message).join('\n• ');
    return m;
  }
  const envName = env => env === 'production' ? t('PRODUCTION — legally valid') : env === 'sandbox' ? t('SANDBOX — government test system, not valid') : env === 'test' ? t('TEST SIMULATOR — not valid') : t('not set up');
  const envBadge = env => env ? `<span class="ed-env ${env === 'production' ? 'prod' : 'test'}">${esc(env === 'production' ? t('Production') : env === 'sandbox' ? t('Sandbox') : t('Test'))}</span>` : '';

  /* ------------------------------------------------------------------ data */
  const saved = () => (typeof currentEditId !== 'undefined' && currentEditId ? state.invoices.find(x => x.id === currentEditId) : null);
  const keyOf = d => `${String(state.company.gstin || '').toUpperCase()}|${d.docType}|${d.num}|${fyOf(d.date)}`;
  const istDate = iso => { if (!iso) return ''; const x = new Date(Date.parse(iso) + 5.5 * 3600e3); return isNaN(x) ? '' : x.toISOString().slice(0, 10); };
  const VEH = /^[A-Z]{2}[0-9]{1,2}[A-Z]{0,3}[0-9]{4}$|^[A-Z]{2}[0-9]{2}BH[0-9]{4}[A-Z]{1,2}$|^TM[A-Z0-9]{6}$/;
  const live = (r, k) => !!(r && r[k] && r[k].status === 'ACT');

  function eligibility(d) {
    const co = state.company, irn = [], ewb = [];
    if (co.aato === 'upto5') irn.push(t('Your turnover in Settings is "up to ₹5 crore", so e-invoicing does not apply.'));
    if (!['INV', 'CRN', 'DBN'].includes(d.docType)) irn.push(t('Only invoices, credit notes and debit notes get an IRN.'));
    if (!['B2B', 'SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP', 'DEXP'].includes(d.supplyType)) irn.push(t('IRN is only for registered buyers, SEZ, exports and deemed exports — not B2C.'));
    if (d.docType !== 'INV') ewb.push(t('E-way bills are made for invoices.'));
    const goods = (d.items || []).some(i => i.hsn && !String(i.hsn).startsWith('99'));
    if (!goods) ewb.push(t('E-way bill is only for goods (all items are services).'));
    const total = computeDoc(d).grandTotal, limit = Number(co.ewbLimit) || 50000;
    return { irn: { ok: !irn.length, reasons: irn }, ewb: { ok: !ewb.length, reasons: ewb, required: goods && total > limit, limit, total } };
  }
  function docForApi(d) {
    const tr = d.ewbTransport || {};
    const lr = String(d.lr || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const vehicleNo = tr.vehicleNo || (VEH.test(lr) && (tr.transMode || '1') === '1' ? lr : '');
    const c = computeDoc(d);
    return {
      id: d.id, docType: d.docType, num: d.num, date: d.date, supplyType: d.supplyType, pos: d.pos, reverseCharge: !!d.reverseCharge,
      refNum: d.refNum || '', refDate: d.refDate || '', cancelled: !!d.cancelled,
      buyerName: d.buyerName, buyerGstin: d.buyerGstin, buyerPhone: d.buyerPhone, buyerAddress: d.buyerAddress, buyerState: d.buyerState, buyerStateCode: d.buyerStateCode, buyerPin: d.buyerPin,
      // an empty ship-to means "same as the buyer" (the form shows it that way)
      shipName: d.shipName || d.buyerName, shipGstin: d.shipName && d.shipName !== d.buyerName ? (d.shipGstin || '') : d.buyerGstin, shipAddress: d.shipAddress || d.buyerAddress,
      shipState: d.shipState || d.buyerState, shipStateCode: d.shipStateCode || d.buyerStateCode, shipPin: d.shipPin || d.buyerPin,
      shipMode: d.shipMode || '', posReason: d.posReason || '',
      items: (d.items || []).map(i => ({ desc: i.desc, hsn: String(i.hsn || '').trim(), gst: Number(i.gst) || 0, qty: Number(i.qty) || 0, unit: i.unit, rate: Number(i.rate) || 0 })),
      discount: Number(d.discount) || 0, pfCharges: Number(d.pfCharges) || 0, otherCharges: Number(d.otherCharges) || 0, grandTotal: c.grandTotal,
      transport: { transName: d.transport || '', transId: String(tr.transId || '').toUpperCase(), transMode: tr.transMode || '1', distance: Number(tr.distance) || 0, vehicleNo, vehicleType: tr.vehicleType || 'R',
        transDocNo: tr.transDocNo || '', transDocDate: tr.transDocDate || '' }
    };
  }
  function companyForApi() {
    const c = state.company;
    return { name: c.name, legalName: c.legalName, gstin: String(c.gstin || '').toUpperCase(), stateCode: c.stateCode, pin: c.pin, address: c.address, phone: c.phone, email: c.email, aato: c.aato, ewbLimit: c.ewbLimit };
  }
  // the form differs from the saved copy in anything that is reported (what would be sent is compared, not the raw fields)
  const sig = d => { const x = docForApi(d); delete x.id; delete x.cancelled; x.buyerGstin = String(x.buyerGstin || '').toUpperCase(); x.shipGstin = String(x.shipGstin || '').toUpperCase(); return JSON.stringify(x); };
  function unsavedChanges(sd) { try { return sig(collectDocFromForm()) !== sig(sd); } catch (e) { return false; } }

  /** writes the government answer into the invoice (it then syncs to the other devices like any edit) */
  function applyRecord(d, rec) {
    if (!d || !rec) return;
    const r = JSON.parse(JSON.stringify(rec));
    if (r.irn) delete r.irn.signedInvoice;
    r.log = (r.log || []).slice(-20);
    d.edoc = r;
    if (r.irn) {
      d.irn = r.irn.irn; d.ackNo = r.irn.ackNo; d.signedQr = r.irn.signedQr;
      d.ackDate = /^\d{4}-\d{2}-\d{2}/.test(r.irn.ackDt || '') ? r.irn.ackDt.slice(0, 10) : istDate(r.irn.ackAt);
      if (r.irn.status === 'CNL' && !d.cancelled) { d.cancelled = true; d.cancelReason = 'IRN cancelled' + (r.irn.cancelRemark ? ': ' + r.irn.cancelRemark : ''); d.cancelledAt = new Date().toISOString(); }
    }
    if (r.ewb) { d.ewbNo = r.ewb.ewbNo; d.ewbDate = istDate(r.ewb.ewbAt) || d.ewbDate; }
    d.updatedAt = new Date().toISOString();
    saveState();
    if (saved() === d) {
      const set = (id, v) => { const el = $(id); if (el) el.value = v || ''; };
      set('inv-irn', d.irn); set('inv-ack-no', d.ackNo); set('inv-ack-date', d.ackDate); set('inv-signed-qr', d.signedQr); set('inv-ewb-no', d.ewbNo); set('inv-ewb-date', d.ewbDate);
    }
    if (typeof previewDoc !== 'undefined' && previewDoc && previewDoc.id === d.id && typeof renderPreviewPages === 'function') {
      previewDoc = Object.assign({}, d, { calc: computeDoc(d) });
      try { renderPreviewPages([selectedCopies()[0] || 'ORIGINAL FOR RECIPIENT']); } catch (e) { /* preview closed */ }
    }
    if (typeof renderInvoiceList === 'function') try { renderInvoiceList(); } catch (e) { /* not on screen */ }
    render();
  }

  /* ------------------------------------------------------------------ invoice panel */
  function flag(sd) {
    const r = sd && sd.edoc;
    if (!r) return sd && (sd.irn || sd.ewbNo) ? `<span class="text-emerald-600">✓ ${esc(t('numbers recorded'))}</span>` : '';
    const parts = [];
    if (r.irn) parts.push(r.irn.status === 'CNL' ? `<span class="text-rose-600">IRN ${esc(t('cancelled'))}</span>` : `<span class="text-emerald-600">✓ IRN</span>`);
    if (r.ewb) parts.push(r.ewb.status === 'CNL' ? `<span class="text-rose-600">EWB ${esc(t('cancelled'))}</span>` : `<span class="text-emerald-600">✓ EWB ${esc(r.ewb.ewbNo)}</span>`);
    if (r.env && r.env !== 'production') parts.push(`<span class="text-amber-600">${esc(r.env.toUpperCase())}</span>`);
    return parts.join(' · ');
  }
  const btn = (act, label, cls = '', dis = false, title = '') => `<button type="button" class="ed-btn ${cls}" data-ed="${act}" ${dis || busy ? 'disabled' : ''} title="${esc(title)}">${esc(t(label))}</button>`;

  function statusHtml(r) {
    if (!r || (!r.irn && !r.ewb)) return '';
    const row = (k, v) => v ? `<div><dt>${esc(t(k))}</dt><dd>${v}</dd></div>` : '';
    const st = s => s === 'ACT' ? `<span class="ed-st ok">${esc(t('Active'))}</span>` : s === 'CNL' ? `<span class="ed-st bad">${esc(t('Cancelled'))}</span>` : esc(s || '');
    let h = `<div class="ed-status">${envBadge(r.env)}<dl>`;
    if (r.irn) {
      const left = r.irn.status === 'ACT' && r.irn.ackAt ? H24 - (Date.now() - Date.parse(r.irn.ackAt)) : 0;
      h += row('IRN', `${st(r.irn.status)} <code class="ed-irn">${esc(r.irn.irn)}</code>`) + row('Ack No. / Date', `${esc(r.irn.ackNo)} · ${esc(r.irn.ackDt || '')}`)
        + row('Signed QR', r.irn.signedQr ? esc(t('received — printed on the invoice')) : '') + (left > 0 ? row('IRN cancel window', esc(Math.floor(left / 3600e3) + ' h ' + Math.floor(left % 3600e3 / 60e3) + ' min')) : '')
        + (r.irn.recovered ? row('Note', esc(t('Recovered from the IRP (it was already registered).'))) : '');
    }
    if (r.ewb) {
      const exp = r.ewb.validAt && Date.parse(r.ewb.validAt) < Date.now();
      h += row('E-Way Bill', `${st(exp && r.ewb.status === 'ACT' ? 'EXP' : r.ewb.status)}${exp && r.ewb.status === 'ACT' ? `<span class="ed-st bad">${esc(t('Validity over'))}</span>` : ''} <strong>${esc(r.ewb.ewbNo)}</strong> · ${esc(r.ewb.ewbDt || '')}`)
        + row('Valid till', r.ewb.validUpto ? esc(r.ewb.validUpto) : esc(t('Part-B (vehicle) not entered yet — goods cannot move')))
        + row('Vehicle', esc(((r.ewb.transport || {}).vehicleNo) || '')) + row('Route', esc(r.ewb.via === 'IRP' ? t('Generated with the IRN (IRP)') : t('E-way bill system')));
    }
    h += `</dl>${r.irn && r.irn.checkedAt || r.ewb && r.ewb.checkedAt ? `<p class="ed-small">${esc(t('Status checked'))}: ${esc(new Date((r.ewb && r.ewb.checkedAt) || r.irn.checkedAt).toLocaleString('en-IN'))}</p>` : ''}</div>`;
    return h;
  }

  function render() {
    const el = $('edoc-panel'); if (!el) return;
    const sd = saved();
    const r = sd && sd.edoc;
    // numbers from the government system are never typed over
    const lockManual = !!(r && (r.irn || r.ewb));
    ['inv-ewb-no', 'inv-ewb-date', 'inv-irn', 'inv-ack-no', 'inv-ack-date', 'inv-signed-qr'].forEach(id => { const i = $(id); if (i) { i.readOnly = lockManual; i.classList.toggle('ed-ro', lockManual); } });
    if (!sd) { el.innerHTML = `<p class="ed-note">${esc(t('Save the document first. The e-invoice and e-way bill are made from the saved invoice — no data is typed twice.'))}</p>`; return; }
    if (['QUO', 'PI', 'CPO', 'PO'].includes(sd.docType)) { el.innerHTML = `<p class="ed-note">${esc(t('Not a tax document — no IRN or e-way bill. Convert it to a GST invoice first.'))}</p>`; return; }
    if (!signedIn()) { el.innerHTML = statusHtml(r) + `<p class="ed-note">${esc(t(ERR.not_signed_in))}</p>`; return; }
    const f = feats();
    if (!f) { el.innerHTML = `<p class="ed-note">${esc(t('Checking e-invoice set-up…'))}</p>`; if (!featTried) { featTried = true; S().refreshFeatures().then(render); } return; }
    const el2 = eligibility(sd);
    const ewbRequired = el2.ewb.ok && el2.ewb.required;
    let h = statusHtml(r);
    if (!f.irp && !f.ewb) {
      el.innerHTML = h + `<p class="ed-note">${esc(t(ERR.EDOC_NOT_CONFIGURED))}</p>`; return;
    }
    if (sd.cancelled && !(r && (live(r, 'irn') || live(r, 'ewb')))) {
      el.innerHTML = h + `<p class="ed-note">${esc(r && r.irn && r.irn.status === 'CNL' ? t('The IRN was cancelled — this invoice number can never be reported again. Create a new invoice.') : t('This document is cancelled.'))}</p>`
        + (r ? `<div class="ed-actions">${btn('refresh', 'Refresh status')}</div>` : ''); return;
    }
    const pending = unsavedChanges(sd);
    if (pending) h += `<p class="ed-warn">${esc(t('You have unsaved changes. Save the document before reporting it.'))}</p>`;
    if (busy) h += `<p class="ed-busy"><span class="gx-spin" aria-hidden="true"></span>${esc(t(busy))}</p>`;
    const acts = [];
    const irnCnl = r && r.irn && r.irn.status === 'CNL';
    if (!irnCnl) {
      if (!(r && r.irn)) {
        if (el2.irn.ok && f.irp) {
          if (el2.ewb.ok && !live(r, 'ewb')) acts.push(btn('irn+ewb', 'Generate IRN + E-Way Bill', 'primary', pending));
          acts.push(btn('irn', 'Generate IRN only', el2.ewb.ok && !live(r, 'ewb') ? '' : 'primary', pending));
        }
      }
      if (el2.ewb.ok && !live(r, 'ewb') && (live(r, 'irn') ? f.irp : f.ewb)) acts.push(btn('ewb', live(r, 'irn') ? 'Generate E-Way Bill (from IRN)' : 'Generate E-Way Bill only', !el2.irn.ok || live(r, 'irn') ? 'primary' : '', pending));
    }
    acts.push(btn('refresh', r ? 'Refresh status' : 'Check GST system'));
    if (live(r, 'ewb')) {
      acts.push(btn('ewb-share', 'Share E-Way Bill PDF'));
      if (f.ewb) acts.push(btn('partb', 'Update vehicle (Part-B)'));
      if (f.ewb) acts.push(btn('transporter', 'Change transporter'));
      acts.push(btn('cancel-ewb', 'Cancel E-Way Bill', 'danger'));
    }
    if (live(r, 'irn') && f.irp) acts.push(btn('cancel-irn', 'Cancel IRN', 'danger', live(r, 'ewb'), live(r, 'ewb') ? t('Cancel the e-way bill first') : ''));
    const notes = [];
    if (!el2.irn.ok && !(r && r.irn)) notes.push(...el2.irn.reasons.map(x => 'IRN: ' + x));
    if (!el2.ewb.ok && !(r && r.ewb)) notes.push(...el2.ewb.reasons.map(x => t('E-way bill') + ': ' + x));
    if (ewbRequired && !live(r, 'ewb')) notes.push(t('Value is above') + ` ₹${el2.ewb.limit.toLocaleString('en-IN')}: ` + t('an e-way bill is needed before the goods move.'));
    if (irnCnl) notes.push(t('The IRN was cancelled — this invoice number can never be reported again. Create a new invoice.'));
    h += `<div class="ed-actions">${acts.join('')}</div>` + (notes.length ? `<ul class="ed-notes">${notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul>` : '')
      + `<p class="ed-small">${esc(t('GST system'))}: ${esc(envName(f.env))}</p>`;
    el.innerHTML = h;
  }

  async function run(label, fn) {
    if (busy) return;
    busy = label; render();
    try { return await fn(); }
    catch (e) { await dlg({ title: t('Could not complete'), body: `<p style="white-space:pre-line">${esc(errText(e))}</p>`, buttons: [{ label: t('OK'), value: true, primary: true }] }); }
    finally { busy = ''; render(); }
  }

  async function generate(mode) {
    const sd = saved(); if (!sd) return;
    if (unsavedChanges(sd)) return toast(t('Save the document first'), 'error');
    // never report a document whose GST treatment is unresolved (same rule book as the editor and the server)
    const blocks = typeof runChecks === 'function' ? runChecks(sd, { audit: true }).filter(x => x.lvl === 'block') : [];
    if (blocks.length) {
      await dlg({ title: t('Fix these before reporting'), body: `<ul class="ed-list">${blocks.slice(0, 8).map(e => `<li>${esc(e.msg)}</li>`).join('')}</ul><p class="ed-small">${esc(t('Nothing was sent to the GST system.'))}</p>`, buttons: [{ label: t('OK'), value: true, primary: true }] });
      return;
    }
    const maxAge = window.HGI_GST ? HGI_GST.at('ewbMaxDocAgeDays', todayISO()) : 180;
    if (mode !== 'irn' && maxAge && daysBetween(sd.date, todayISO()) > maxAge)
      return toast(t(`The e-way bill system does not accept documents older than ${maxAge} days.`), 'error');
    const f = feats() || {};
    const body = { doc: docForApi(sd), company: companyForApi(), mode };
    await run('Checking the document…', async () => {
      const pv = await S().edocApi('POST', '/preview', body);
      if (pv.record && (pv.record.irn || pv.record.ewb) && !(sd.edoc && (sd.edoc.irn || sd.edoc.ewb))) applyRecord(sd, pv.record);   // known on the server already (other phone)
      if (pv.errors && pv.errors.length) {
        await dlg({ title: t('Fix these before reporting'), body: `<ul class="ed-list">${pv.errors.map(e => `<li>${esc(e.message)}</li>`).join('')}</ul><p class="ed-small">${esc(t('Nothing was sent to the GST system.'))}</p>`, buttons: [{ label: t('OK'), value: true, primary: true }] });
        return;
      }
      const what = { 'irn+ewb': t('IRN (e-invoice) and e-way bill'), irn: t('IRN (e-invoice)'), ewb: t('e-way bill') }[mode];
      const c = computeDoc(sd);
      const warn = (pv.warnings || []).map(w => `<li>${esc(w.message)}</li>`).join('');
      const go = await dlg({ title: t('Report to the GST system?'), body:
        `<p><strong>${esc(sd.num)}</strong> · ${esc(sd.buyerName)} · ${esc(money(c.grandTotal))}</p><p>${esc(t('This will generate the'))} <strong>${esc(what)}</strong> ${esc(t('on'))}: <strong>${esc(envName(f.env))}</strong></p>`
        + (warn ? `<p class="ed-small">${esc(t('Warnings'))}:</p><ul class="ed-list">${warn}</ul>` : '')
        + `<p class="ed-small">${esc(t('After this, the invoice values and buyer cannot be changed. An IRN or e-way bill can be cancelled only within 24 hours, and a cancelled invoice number can never be used again.'))}</p>`,
        buttons: [{ label: t('Cancel'), value: false }, { label: t('Generate'), value: true, primary: true }] });
      if (!go) return;
      busy = 'Talking to the GST system… keep the app open.'; render();
      let r;
      try { r = await S().edocApi('POST', '/generate', body); }
      catch (e) {
        if (e.status === 0 || e.status >= 500) e.message = errText(e) + '\n\n' + t('If you are not sure whether it reached the GST system, tap Generate again: the server finds an IRN that already exists and never makes a second one.');
        throw e;
      }
      applyRecord(sd, r.record);
      const got = [r.record.irn && live(r.record, 'irn') ? 'IRN' : '', live(r.record, 'ewb') ? t('e-way bill') + ' ' + r.record.ewb.ewbNo : ''].filter(Boolean).join(' + ');
      toast(`${got || t('Done')}${f.env !== 'production' ? ' (' + (f.env || '').toUpperCase() + ')' : ''}`, 'success');
      if (r.ewbErrors && r.ewbErrors.length)
        await dlg({ title: t('IRN generated — e-way bill not generated'), body: `<ul class="ed-list">${r.ewbErrors.map(x => `<li>${esc(x)}</li>`).join('')}</ul><p>${esc(t('Fix the transport details, save, and use "Generate E-Way Bill (from IRN)".'))}</p>`, buttons: [{ label: t('OK'), value: true, primary: true }] });
    });
  }

  async function refresh() {
    const sd = saved(); if (!sd) return;
    const key = (sd.edoc && sd.edoc.key) || keyOf(sd);
    await run('Asking the GST system for the status…', async () => {
      let r;
      try { r = await S().edocApi('POST', '/refresh', { key }); }
      catch (e) { if (e.status === 404) { toast(t('Nothing has been reported for this document yet.'), 'info'); return; } throw e; }
      applyRecord(sd, r.record);
      if (r.notes && r.notes.length) toast(r.notes.join(' · '), 'warn'); else toast(t('Status updated'), 'success');
    });
  }

  const tmp = {};
  window.__edF = (k, v) => { tmp[k] = v; };
  const field = (k, label, html) => `<label class="ed-f"><span>${esc(t(label))}</span>${html.replace(/^<(input|select)/, `<$1 data-edf="${k}" oninput="__edF('${k}',this.value)" onchange="__edF('${k}',this.value)"`)}</label>`;
  const opts = (o, sel) => Object.entries(o).map(([v, l]) => `<option value="${v}" ${v === sel ? 'selected' : ''}>${esc(t(l))}</option>`).join('');

  async function cancel(kind) {
    const sd = saved(); if (!sd || !sd.edoc) return;
    const reasons = kind === 'irn' ? { 1: 'Duplicate', 2: 'Data entry mistake', 3: 'Order cancelled', 4: 'Others' } : { 1: 'Duplicate', 2: 'Order cancelled', 3: 'Data entry mistake', 4: 'Others' };
    Object.keys(tmp).forEach(k => delete tmp[k]); tmp.reason = '2'; tmp.remark = '';
    const ok = await dlg({ title: kind === 'irn' ? t('Cancel IRN?') : t('Cancel e-way bill?'), danger: true, body:
      `<p>${esc(kind === 'irn' ? t('The e-invoice is cancelled on the IRP. The invoice number can never be reported again; this invoice is marked cancelled in your register.') : t('The e-way bill is cancelled on the e-way bill system. Goods must not move on it.'))}</p>`
      + field('reason', 'Reason', `<select class="inp">${opts(reasons, '2')}</select>`) + field('remark', 'Remark (required)', `<input class="inp" maxlength="${kind === 'irn' ? 100 : 50}" placeholder="${esc(t('e.g. wrong quantity'))}">`),
      buttons: [{ label: t('Keep'), value: false }, { label: kind === 'irn' ? t('Cancel IRN') : t('Cancel e-way bill'), value: true, danger: true }] });
    if (!ok) return;
    if (!String(tmp.remark || '').trim()) return toast(t('Enter a remark for the cancellation.'), 'error');
    await run('Cancelling on the GST system…', async () => {
      const r = await S().edocApi('POST', kind === 'irn' ? '/cancel-irn' : '/cancel-ewb', { key: sd.edoc.key, reasonCode: tmp.reason, remark: tmp.remark.trim() });
      applyRecord(sd, r.record);
      toast(kind === 'irn' ? t('IRN cancelled') : t('E-way bill cancelled'), 'info');
    });
  }

  async function partB() {
    const sd = saved(); if (!sd || !live(sd.edoc, 'ewb')) return;
    Object.keys(tmp).forEach(k => delete tmp[k]);
    const co = state.company;
    Object.assign(tmp, { vehicleNo: '', fromPlace: '', fromState: co.stateCode || '', reasonCode: '4', reasonRem: '', transMode: '1', transDocNo: '' });
    const ok = await dlg({ title: t('Update vehicle (Part-B)'), body:
      field('transMode', 'Mode', `<select class="inp">${opts({ 1: 'Road', 2: 'Rail', 3: 'Air', 4: 'Ship' }, '1')}</select>`)
      + field('vehicleNo', 'Vehicle No.', `<input class="inp uppercase" maxlength="15" placeholder="GJ05AB1234">`)
      + field('transDocNo', 'Transport Doc No. (rail / air / ship)', `<input class="inp" maxlength="15">`)
      + field('fromPlace', 'Moving from (place)', `<input class="inp" maxlength="50">`)
      + field('fromState', 'From state code', `<input class="inp" maxlength="2" value="${esc(co.stateCode || '')}">`)
      + field('reasonCode', 'Reason', `<select class="inp">${opts({ 4: 'First time', 1: 'Break down', 2: 'Transshipment', 3: 'Others' }, '4')}</select>`)
      + field('reasonRem', 'Remarks', `<input class="inp" maxlength="50">`),
      buttons: [{ label: t('Cancel'), value: false }, { label: t('Update'), value: true, primary: true }] });
    if (!ok) return;
    await run('Updating the e-way bill…', async () => {
      const r = await S().edocApi('POST', '/partb', Object.assign({ key: sd.edoc.key }, tmp, { vehicleNo: String(tmp.vehicleNo || '').toUpperCase() }));
      applyRecord(sd, r.record); toast(t('Vehicle updated on the e-way bill'), 'success');
    });
  }
  async function transporter() {
    const sd = saved(); if (!sd || !live(sd.edoc, 'ewb')) return;
    Object.keys(tmp).forEach(k => delete tmp[k]); tmp.tid = '';
    const ok = await dlg({ title: t('Change transporter'), body: field('tid', 'Transporter ID (GSTIN / TRANSIN)', `<input class="inp uppercase" maxlength="15">`),
      buttons: [{ label: t('Cancel'), value: false }, { label: t('Update'), value: true, primary: true }] });
    if (!ok) return;
    await run('Updating the e-way bill…', async () => {
      const r = await S().edocApi('POST', '/transporter', { key: sd.edoc.key, transporterId: String(tmp.tid || '').toUpperCase().trim() });
      applyRecord(sd, r.record); toast(t('Transporter updated'), 'success');
    });
  }

  /* ------------------------------------------------------------------ e-way bill page (PDF / print) — only from a recorded e-way bill */
  function ewbPage(d) {
    const r = d && d.edoc, e = r && r.ewb;
    if (!e) return '<div class="a4-page"><p>No e-way bill</p></div>';
    const co = state.company, c = d.calc || computeDoc(d), tr = Object.assign({}, d.ewbTransport || {}, e.transport || {});
    const modes = { 1: 'Road', 2: 'Rail', 3: 'Air', 4: 'Ship' };
    const hsn = [...new Set((d.items || []).filter(i => i.hsn && !String(i.hsn).startsWith('99')).map(i => i.hsn))].join(', ');
    const row = (k, v) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`;
    const veh = (e.vehicles && e.vehicles.length ? e.vehicles : (tr.vehicleNo ? [{ vehicleNo: tr.vehicleNo, fromPlace: '', enteredDate: e.ewbDt }] : []));
    return `<div class="a4-page ewb-page"><div class="main-invoice-body">
      <div class="ewb-head"><div><div class="ewb-title">E-WAY BILL</div><div class="ewb-sub">${esc(e.via === 'IRP' ? 'Generated with the IRN through the IRP' : 'Generated on the NIC e-way bill system')} · ${esc(envName(r.env))}</div></div>
        ${e.status === 'CNL' ? '<div class="ewb-stamp">CANCELLED</div>' : ''}</div>
      <table class="ewb-t">
        ${row('E-Way Bill No.', `<strong>${esc(e.ewbNo)}</strong>`)}${row('Generated', esc(e.ewbDt || ''))}${row('Generated by', esc(co.gstin) + ' — ' + esc(co.legalName || co.name))}
        ${row('Valid upto', esc(e.validUpto || 'Part-B not entered'))}${e.status === 'CNL' ? row('Cancelled', esc((e.cancelDate || '') + ' — ' + (e.cancelRemark || ''))) : ''}
        ${r.irn ? row('IRN', `<code>${esc(r.irn.irn)}</code>`) : ''}
      </table>
      <h4>Part-A</h4>
      <table class="ewb-t">
        ${row('GSTIN of supplier', esc(co.gstin))}${row('Place of dispatch', esc(withPin(co.address, co.pin)).replace(/\n/g, ', '))}
        ${row('GSTIN of recipient', esc(d.buyerGstin || 'URP'))}${row('Place of delivery', esc(withPin(d.shipAddress || d.buyerAddress, d.shipPin || d.buyerPin)).replace(/\n/g, ', '))}
        ${row('Document', `${esc(DOC_TYPES[d.docType].title)} ${esc(d.num)} dt. ${esc(fmtDate(d.date))}`)}${row('Value of goods', esc(money(c.grandTotal)) + ` (taxable ${esc(money(c.taxable))})`)}
        ${row('HSN code(s)', esc(hsn))}${row('Reason for transport', 'Outward — Supply')}${row('Transporter', esc([tr.transId, d.transport].filter(Boolean).join(' — ') || '-'))}
        ${row('Approx. distance', esc(tr.distance ? tr.distance + ' km' : 'calculated by the e-way bill system'))}
      </table>
      <h4>Part-B</h4>
      <table class="ewb-t ewb-veh"><tr><th>Mode</th><th>Vehicle / Trans. Doc No.</th><th>From</th><th>Entered</th></tr>
        ${veh.length ? veh.map(v => `<tr><td>${esc(modes[v.transMode || tr.transMode || 1] || 'Road')}</td><td>${esc(v.vehicleNo || tr.transDocNo || '')}</td><td>${esc(v.fromPlace || '')}</td><td>${esc(v.enteredDate || '')}</td></tr>`).join('') : '<tr><td colspan="4">Not entered — goods cannot move until Part-B is updated.</td></tr>'}
      </table>
      <p class="ewb-foot">Details as returned by the government system for this e-way bill. Verify at ewaybillgst.gov.in (Search → E-Way Bill).</p>
    </div></div>`;
  }
  async function shareEwb() {
    const sd = saved(); if (!sd || !sd.edoc || !sd.edoc.ewb) return;
    const M = window.HGI_M, N = window.Capacitor && Capacitor.Plugins && Capacitor.Plugins.HgiNative;
    const name = `EWB_${sd.edoc.ewb.ewbNo}_${String(sd.num).replace(/[\/\\]/g, '-')}.pdf`;
    const d = Object.assign({}, sd, { calc: computeDoc(sd) });
    if (M && M.withRendered && N && N.sharePdf && window.HGI_APP && HGI_APP.isNative) {
      await run('Preparing the e-way bill PDF…', () => M.withRendered(d, ['E-WAY BILL'], () => N.sharePdf({ fileName: name, text: `E-Way Bill ${sd.edoc.ewb.ewbNo} · ${sd.num} · ${state.company.name}`, title: `E-Way Bill ${sd.edoc.ewb.ewbNo}` })));
    } else if (M && M.withRendered) {
      await M.withRendered(d, ['E-WAY BILL'], async () => { window.print(); });
    }
  }

  /* ------------------------------------------------------------------ Settings → E-Invoice & E-Way Bill (API login) */
  async function renderSettings() {
    const col = document.querySelector('#tab-settings .set-col') || $('tab-settings');
    if (!col || typeof state === 'undefined') return;
    let card = $('edoc-card');
    if (!card) {
      card = document.createElement('div'); card.id = 'edoc-card'; card.className = 'bg-white p-6 rounded-lg shadow-sm border border-slate-200 set-card';
      const acct = $('acct-card'); if (acct) acct.after(card); else col.prepend(card);
      const nav = document.querySelector('#tab-settings .set-index');
      if (nav && !nav.querySelector('[data-t="edoc-card"]')) { const b = document.createElement('button'); b.type = 'button'; b.dataset.t = 'edoc-card'; b.innerHTML = `<span>${esc(t('E-Invoice & E-Way Bill'))}</span>`; const a = nav.querySelector('[data-t="acct-card"]'); if (a) a.after(b); else nav.prepend(b); }
    }
    const head = `<h3 class="text-sm font-bold text-slate-800 uppercase mb-2"><i class="fa-solid fa-qrcode mr-1"></i>${esc(t('E-Invoice & E-Way Bill'))}</h3>`;
    if (!signedIn()) { card.innerHTML = head + `<p class="ed-note">${esc(t(ERR.not_signed_in))}</p>`; return; }
    const f = feats() || (await S().refreshFeatures()).edoc || { irp: false, ewb: false };
    const g = String(state.company.gstin || '').toUpperCase();
    let creds = [];
    if (f.irp || f.ewb) { try { creds = (await S().edocApi('GET', '/credentials')).credentials || []; } catch (e) { /* shown below */ } }
    const mine = creds.find(c => c.gstin === g);
    const st = (on, l) => `${esc(t(l))}: <strong>${on ? esc(t('available')) : esc(t('not set up on the server'))}</strong>`;
    card.innerHTML = head + `<p class="text-[11px] text-slate-500">${st(f.irp, 'E-invoice (IRP)')} · ${st(f.ewb, 'E-way bill system')} · ${esc(t('GST system'))}: <strong>${esc(envName(f.env))}</strong></p>`
      + (!(f.irp || f.ewb) ? `<p class="ed-note">${esc(t(ERR.EDOC_NOT_CONFIGURED))}</p>` : !/^[0-9]{2}[A-Z0-9]{13}$/.test(g) ? `<p class="ed-note">${esc(t('Add your GSTIN in the Company section first.'))}</p>` : `
      <p class="text-[12px] mt-2">${esc(t('Your own API login for GSTIN'))} <strong>${esc(g)}</strong>${mine ? ` — ${esc(t('saved'))} (${esc(mine.irpUser || '-')} / ${esc(mine.ewbUser || '-')}, ${esc(t('verified'))} ${esc(new Date(mine.updatedAt).toLocaleDateString('en-IN'))}${mine.env !== f.env ? ', <span class="text-rose-600">' + esc(t('for another GST system — enter again')) + '</span>' : ''})` : ` — <span class="text-amber-700">${esc(t('not saved yet'))}</span>`}</p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-3 mt-2">
        ${f.irp ? `<div><label class="field-label">${esc(t('E-invoice API user name'))}</label><input id="ed-irp-user" class="inp" autocomplete="off" autocapitalize="off"></div>
        <div><label class="field-label">${esc(t('E-invoice API password'))}</label><input id="ed-irp-pass" type="password" class="inp" autocomplete="new-password" placeholder="${mine && mine.hasIrp ? esc(t('(saved — leave empty to keep)')) : ''}"></div>` : ''}
        ${f.ewb ? `<div><label class="field-label">${esc(t('E-way bill API user name'))}</label><input id="ed-ewb-user" class="inp" autocomplete="off" autocapitalize="off"></div>
        <div><label class="field-label">${esc(t('E-way bill API password'))}</label><input id="ed-ewb-pass" type="password" class="inp" autocomplete="new-password" placeholder="${mine && mine.hasEwb ? esc(t('(saved — leave empty to keep)')) : ''}"></div>` : ''}
      </div>
      <div class="flex flex-wrap gap-2 mt-3"><button type="button" id="ed-save" class="ed-btn primary">${esc(t('Verify & save'))}</button>${mine ? `<button type="button" id="ed-del" class="ed-btn danger">${esc(t('Remove login'))}</button>` : ''}</div>
      <p id="ed-msg" class="text-[12px] mt-2" role="status"></p>
      <details class="mt-2 text-[11px] text-slate-600"><summary class="cursor-pointer font-semibold">${esc(t('How to get these logins'))}</summary>
        <ol class="list-decimal ml-5 mt-1 space-y-1">
          <li>${esc(t('E-invoice: einvoice1.gst.gov.in → API Registration → User Credentials → Create API User → "Through GSP" → choose the GSP named in the HGI Billing listing → pick a user name and password.'))}</li>
          <li>${esc(t('E-way bill: ewaybillgst.gov.in → Registration → For GSP → same GSP → create the API user.'))}</li>
          <li>${esc(t('Enter them here. HGI checks them by logging in to the GST system, then keeps them encrypted on the HGI server. They are never shown again or stored on this phone.'))}</li>
        </ol></details>`);
    const save = $('ed-save');
    if (save) save.onclick = async () => {
      const v = id => ($(id) ? $(id).value : undefined);
      const body = {};
      if (v('ed-irp-user')) { body.irpUser = v('ed-irp-user').trim(); if (v('ed-irp-pass')) body.irpPass = v('ed-irp-pass'); }
      if (v('ed-ewb-user')) { body.ewbUser = v('ed-ewb-user').trim(); if (v('ed-ewb-pass')) body.ewbPass = v('ed-ewb-pass'); }
      if (!Object.keys(body).length) { $('ed-msg').textContent = t('Enter a user name and password.'); return; }
      save.disabled = true; $('ed-msg').textContent = t('Logging in to the GST system to check…');
      try { await S().edocApi('PUT', '/credentials/' + g, body); toast(t('API login verified and saved'), 'success'); renderSettings(); }
      catch (e) { $('ed-msg').textContent = errText(e); $('ed-msg').className = 'text-[12px] mt-2 text-rose-600'; save.disabled = false; }
    };
    const del = $('ed-del');
    if (del) del.onclick = async () => {
      const ok = await dlg({ title: t('Remove API login?'), danger: true, body: `<p>${esc(t('E-invoice and e-way bill generation stops for this GSTIN until a login is saved again.'))}</p>`, buttons: [{ label: t('Keep'), value: false }, { label: t('Remove'), value: true, danger: true }] });
      if (!ok) return;
      try { await S().edocApi('DELETE', '/credentials/' + g); renderSettings(); } catch (e) { toast(errText(e), 'error'); }
    };
  }

  /* ------------------------------------------------------------------ hooks */
  function after(name, fn) {
    const orig = window[name]; if (typeof orig !== 'function') return;
    window[name] = function () { const out = orig.apply(this, arguments); try { fn.apply(this, arguments); } catch (e) { console.warn('edoc', e); } return out; };
  }
  function install() {
    const p = $('edoc-panel'); if (!p) return;
    p.addEventListener('click', e => {
      const b = e.target.closest('[data-ed]'); if (!b || b.disabled) return;
      const a = b.dataset.ed;
      if (a === 'irn' || a === 'irn+ewb' || a === 'ewb') generate(a);
      else if (a === 'refresh') refresh();
      else if (a === 'cancel-irn') cancel('irn');
      else if (a === 'cancel-ewb') cancel('ewb');
      else if (a === 'partb') partB();
      else if (a === 'transporter') transporter();
      else if (a === 'ewb-share') shareEwb();
    });
    after('doRefreshForm', render);
    after('loadDocIntoForm', () => setTimeout(render, 0));
    after('saveCurrentInvoice', () => setTimeout(render, 0));
    after('loadSettingsForm', () => { renderSettings(); });
    // a document with a live IRN / e-way bill is cancelled through the GST system, not only in the register
    const origCancel = window.cancelInvoice;
    if (typeof origCancel === 'function') window.cancelInvoice = function (id) {
      const d = state.invoices.find(x => x.id === id);
      if (d && d.edoc && (live(d.edoc, 'irn') || live(d.edoc, 'ewb'))) { if (typeof editInvoice === 'function') editInvoice(id); const blk = $('edoc-block'); if (blk) blk.open = true; return toast(t('This document has a live IRN / e-way bill — cancel it in the E-Invoice & E-Way Bill section (within 24 hours) or issue a credit note.'), 'warn'); }
      return origCancel.apply(this, arguments);
    };
    render();
  }

  window.HGI_EDOC = { install, render, flag: sd => flag(sd), ewbPage, eligibility, docForApi, companyForApi, applyRecord, renderSettings, generate, refresh, _tmp: tmp };
})();
