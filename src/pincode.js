/* =====================================================================
   HGI Billing v9.1 — PIN code → State, State Code, City / District
   Data: India Post "All India Pincode Directory" (data.gov.in), bundled offline (pincodes.json, built by tools/build-pincodes.py).
   Each address block (billing, shipping, buyer master, company) is looked up on its own: a shipping PIN never changes the
   billing state, and a billing PIN never overrides the state of the buyer's GSTIN. A PIN that India Post lists in more than
   one state is never guessed — the user picks. The place of supply is then recalculated by the invoice form.
   ===================================================================== */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const t = s => (window.HGI_I18N ? window.HGI_I18N.t(s) : s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const stName = c => (typeof GST_STATES !== 'undefined' && GST_STATES[c]) || c;
  const normSC = c => (typeof normalizeStateCode === 'function' ? normalizeStateCode(c) : String(c || '').trim().padStart(2, '0'));

  /* ------------------------------------------------------------------ data */
  let map = null, loading = null, source = '';
  function decode(j) {
    const m = new Map(), D = j.D;
    let pin = 0;
    for (let i = 0; i < j.P.length; i += 2) { pin += j.P[i]; const d = D[j.P[i + 1]]; m.set(String(pin), [{ district: d[0], code: d[1], offices: 0 }]); }
    Object.entries(j.A || {}).forEach(([p, list]) => m.set(p, list.map(([k, n]) => ({ district: D[k][0], code: D[k][1], offices: n }))));
    source = j.source || '';
    return m;
  }
  function load() {
    if (map) return Promise.resolve(map);
    if (!loading) loading = fetch('pincodes.json').then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(j => (map = decode(j))).catch(e => { loading = null; throw e; });
    return loading;
  }
  /** → null (not in the directory) | { pin, states:[{code, state, districts:[…], offices}], ambiguousState, districts } */
  async function lookup(pin) {
    pin = String(pin || '').trim();
    if (!/^[1-9][0-9]{5}$/.test(pin)) return null;
    const m = await load();
    const c = m.get(pin);
    if (!c) return null;
    const by = new Map();
    c.forEach(x => { const s = by.get(x.code) || { code: x.code, state: stName(x.code), districts: [], offices: 0 }; s.districts.push(x.district); s.offices += x.offices; by.set(x.code, s); });
    const states = [...by.values()].sort((a, b) => b.offices - a.offices);
    return { pin, states, ambiguousState: states.length > 1 };
  }

  /* ------------------------------------------------------------------ address blocks */
  const BLOCKS = {
    buyer: { pin: 'inv-buyer-pin', code: 'inv-buyer-state-code', state: 'inv-buyer-state', city: 'inv-buyer-city', address: 'inv-buyer-address', gstin: 'inv-buyer-gstin', status: 'buyer-pin-status', billing: true, invoice: true },
    ship: { pin: 'inv-ship-pin', code: 'inv-ship-state-code', state: 'inv-ship-state', city: 'inv-ship-city', address: 'inv-ship-address', gstin: 'inv-ship-gstin', status: 'ship-pin-status', invoice: true, shipping: true },
    cust: { pin: 'modal-cust-pin', code: 'modal-cust-state-code', state: 'modal-cust-state', city: 'modal-cust-city', address: 'modal-cust-address', gstin: 'modal-cust-gstin', status: 'cust-pin-status', billing: true },
    custship: { pin: 'modal-cust-ship-pin', code: 'modal-cust-ship-state-code', state: 'modal-cust-ship-state', city: 'modal-cust-ship-city', address: 'modal-cust-ship-address', status: 'custship-pin-status', shipping: true },
    company: { pin: 'set-comp-pin', code: 'set-comp-state-code', state: 'set-comp-state', address: 'set-comp-address', gstin: 'set-comp-gstin', status: 'company-pin-status', billing: true }
  };
  const val = id => ($(id) ? $(id).value.trim() : '');
  function gstinState(g) {
    g = String(g || '').trim().toUpperCase();
    if (g.length !== 15 || typeof validateGSTIN !== 'function') return '';
    const r = validateGSTIN(g); return r && r.code ? normSC(r.code) : '';
  }
  function status(b, cls, html) {
    let el = $(b.status);
    if (!el && $(b.pin)) { el = document.createElement('p'); el.id = b.status; el.className = 'pin-status hidden'; el.setAttribute('aria-live', 'polite'); const host = $(b.pin).closest('.grid') || $(b.pin).parentElement; host.after(el); }
    if (!el) return;
    el.className = 'pin-status' + (cls ? ' ' + cls : '') + (html ? '' : ' hidden');
    el.innerHTML = html || '';
  }
  function setField(id, v) { const el = $(id); if (!el) return false; if (el.value !== v) { el.value = v; el.dataset.pinAuto = '1'; return true; } el.dataset.pinAuto = '1'; return false; }
  function after(b) {
    if (b.invoice && typeof refreshForm === 'function') refreshForm();
  }
  const pick = (name, s, d) => `<button type="button" class="pin-pick" data-pin-pick="${esc(name)}" data-code="${esc(s.code)}" data-district="${esc(d || s.districts[0] || '')}">${esc(s.state)} (${esc(s.code)})${d || s.districts[0] ? ' · ' + esc(d || s.districts[0]) : ''}</button>`;

  /** applies one state (+ district) to a block; the billing state of a registered party stays the GSTIN's state */
  function apply(name, b, s, district, opts = {}) {
    const notes = [];
    const gCode = b.billing ? gstinState(val(b.gstin)) : '';
    const curCode = normSC(val(b.code));
    if (b.billing && gCode && gCode !== s.code && !opts.force) {
      notes.push(`${t('PIN')} ${esc(val(b.pin))} ${t('is in')} <strong>${esc(s.state)} (${esc(s.code)})</strong>, ${t('but the GSTIN is registered in')} <strong>${esc(stName(gCode))} (${esc(gCode)})</strong>. ${t('The state code stays the GSTIN state — check the PIN and the address.')}`);
      if (b.city && (!val(b.city) || $(b.city).dataset.pinAuto === '1')) setField(b.city, district || s.districts[0] || '');
      status(b, 'warn', notes.join('<br>') + ` <button type="button" class="pin-pick" data-pin-pick="${esc(name)}" data-code="${esc(s.code)}" data-district="${esc(district || '')}" data-force="1">${esc(t('Use'))} ${esc(s.state)} ${esc(t('anyway'))}</button>`);
      after(b); return;
    }
    const changed = curCode && curCode !== s.code;
    setField(b.code, s.code); setField(b.state, s.state);
    if (b.city) {
      const cityEl = $(b.city), d = district || s.districts[0] || '';
      // a city the user typed stays; an empty, copied or earlier auto-filled one follows the PIN
      if (cityEl && (!cityEl.value.trim() || cityEl.dataset.pinAuto !== '0' || opts.force || opts.picked)) setField(b.city, d);
    }
    if (b.shipping && b.gstin) {
      const sg = gstinState(val(b.gstin));
      if (sg && sg !== s.code) notes.push(`${t('Delivery PIN is in')} ${esc(s.state)} (${esc(s.code)}), ${t('but the consignee GSTIN is from')} ${esc(stName(sg))} (${esc(sg)}). ${t('Check the consignee details.')}`);
    }
    const others = s.districts.filter(x => x !== (district || s.districts[0]));
    let html = `✓ ${esc(s.state)} (${esc(s.code)})${b.city ? ' · ' + esc(district || s.districts[0]) : ''} <span class="pin-src">${esc(t('India Post PIN directory'))}</span>`;
    if (others.length && b.city) html += `<br>${esc(t('This PIN also covers'))}: ${others.map(d => pick(name, s, d)).join(' ')}`;
    if (changed) notes.unshift(`${t('State changed from')} ${esc(stName(curCode))} (${esc(curCode)}).`);
    if (notes.length) html += '<br>' + notes.join('<br>');
    status(b, notes.length ? 'warn' : 'ok', html);
    after(b);
  }

  const seq = {};
  async function check(name, opts = {}) {
    const b = BLOCKS[name]; if (!b || !$(b.pin)) return;
    const pin = val(b.pin).replace(/\s+/g, '');
    const my = (seq[name] = (seq[name] || 0) + 1);
    if (!pin) { status(b, '', ''); return; }
    if (!/^\d+$/.test(pin) || pin.length > 6 || (pin.length === 6 && pin[0] === '0')) { status(b, 'bad', esc(t('A PIN code has 6 digits and does not start with 0.'))); return; }
    if (pin.length < 6) { status(b, '', ''); return; }
    let r;
    try { r = await lookup(pin); }
    catch (e) { if (my === seq[name]) status(b, 'warn', esc(t('The PIN directory could not be opened — enter the state and state code yourself.'))); return; }
    if (my !== seq[name] || val(b.pin).replace(/\s+/g, '') !== pin) return;   // typed on meanwhile
    if (!r) { status(b, 'warn', esc(t('This PIN is not in the India Post directory. Check it, or enter the state and state code yourself.'))); return; }
    if (r.ambiguousState) {
      // never guessed: the user chooses, and nothing changes until then
      status(b, 'warn', `${esc(t('India Post lists PIN'))} ${esc(pin)} ${esc(t('in more than one state. Choose the right one:'))}<br>${r.states.map(s => pick(name, s)).join(' ')}`);
      return;
    }
    apply(name, b, r.states[0], null, { fromPin: true, quiet: opts.quiet });
  }

  /* the address text is checked against the PIN and the state code */
  function checkAddress(name) {
    const b = BLOCKS[name]; if (!b || !$(b.address)) return;
    const addr = val(b.address), pin = val(b.pin);
    const m = addr.match(/(?:^|\D)([1-9]\d{2}\s?\d{3})(?!\d)/);
    const inText = m ? m[1].replace(/\s/g, '') : '';
    const el = $(b.status);
    const keep = el && !el.classList.contains('hidden') && !el.dataset.addr ? el.innerHTML : '';
    if (inText && !pin) { $(b.pin).value = inText; check(name); return; }
    const warn = [];
    if (inText && pin && inText !== pin) warn.push(`${t('The address mentions PIN')} ${esc(inText)}, ${t('but the PIN field says')} ${esc(pin)}.`);
    const code = normSC(val(b.code));
    if (code && typeof GST_STATES !== 'undefined') {
      const low = ' ' + addr.toLowerCase().replace(/[^a-z& ]+/g, ' ') + ' ';
      const named = Object.entries(GST_STATES).filter(([c, n]) => c !== '96' && c !== '97' && n.length > 3 && low.includes(' ' + n.toLowerCase().replace(/[^a-z& ]+/g, ' ').trim() + ' '));
      const other = named.find(([c]) => c === code) ? null : named.find(([c]) => c !== code);
      if (other) warn.push(`${t('The address names')} ${esc(other[1])} (${esc(other[0])}), ${t('but the state code is')} ${esc(code)}.`);
    }
    if (warn.length) { status(b, 'warn', (keep ? keep + '<br>' : '') + warn.join('<br>')); const e2 = $(b.status); if (e2) e2.dataset.addr = '1'; }
    else if (el && el.dataset.addr) { delete el.dataset.addr; check(name); }
  }

  function install() {
    Object.entries(BLOCKS).forEach(([name, b]) => {
      const p = $(b.pin); if (!p || p.dataset.pinWired) return;
      p.dataset.pinWired = '1';
      p.addEventListener('input', () => { const v = p.value.replace(/\s+/g, ''); if (v.length >= 6 || !v) check(name); else status(b, '', ''); });
      p.addEventListener('change', () => check(name));
      if ($(b.city)) $(b.city).addEventListener('input', () => { $(b.city).dataset.pinAuto = '0'; });
      if ($(b.code)) $(b.code).addEventListener('input', () => { $(b.code).dataset.pinAuto = ''; });
      if ($(b.address)) { let tm; $(b.address).addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => checkAddress(name), 500); }); }
    });
    // editing any shipping field means the delivery address is no longer "same as billing"
    ['inv-ship-name', 'inv-ship-gstin', 'inv-ship-address', 'inv-ship-state', 'inv-ship-state-code', 'inv-ship-pin', 'inv-ship-city'].forEach(id => {
      const el = $(id); if (!el) return;
      el.addEventListener('input', () => { const c = $('sync-shipping-chk'); if (c && c.checked) { c.checked = false; } });
    });
    // "Same as billing" copies the billing PIN status too
    const sync = $('sync-shipping-chk');
    if (sync) sync.addEventListener('change', () => { if (!sync.checked) return; const a = $('buyer-pin-status'), s = $('ship-pin-status'); if (a && s) { s.className = a.className; s.innerHTML = a.innerHTML.replace(/data-pin-pick="buyer"/g, 'data-pin-pick="ship"'); } });
    document.addEventListener('click', e => {
      const btn = e.target.closest('[data-pin-pick]'); if (!btn) return;
      const name = btn.dataset.pinPick, b = BLOCKS[name]; if (!b) return;
      lookup(val(b.pin)).then(r => {
        const s = r && r.states.find(x => x.code === btn.dataset.code); if (!s) return;
        apply(name, b, s, btn.dataset.district || null, { force: btn.dataset.force === '1', picked: true });
        if (b.city && btn.dataset.district) setField(b.city, btn.dataset.district);
        if (name === 'ship') { const c = $('sync-shipping-chk'); if (c) c.checked = false; }
      });
    });
    load().catch(() => {});   // warm up (≈150 KB, offline)
  }

  window.HGI_PIN = { install, lookup, check, checkAddress, load, source: () => source };
})();
