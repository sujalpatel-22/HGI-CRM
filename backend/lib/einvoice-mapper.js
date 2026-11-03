'use strict';
const GST_RULES = (() => { try { return require('./gst-rules.js'); } catch (e) { return null; } })();
/**
 * Maps a billing-app document to:
 *   - e-Invoice JSON (FORM GST INV-01, schema version 1.1) for the IRP
 *   - e-Way Bill JSON (NIC EWB API v1.03, GENEWAYBILL)
 *   - "Generate EWB by IRN" request
 * and validates them against the published rules before anything is sent.
 */
const { computeDoc, round2, STATES, normUQC, normState, isExportish, ddmmyyyy, fyOf } = require('./gst-calc');

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$|^[0-9]{4}[A-Z]{3}[0-9]{5}[UN][A-Z0-9]{3}$/;
const DOCNO_IRP_RE = /^[a-zA-Z1-9][a-zA-Z0-9/-]{0,15}$/;          // IRP: cannot start with 0, '/' or '-'
const DOCNO_EWB_RE = /^[a-zA-Z0-9/-]{1,16}$/;
const PIN_RE = /^[1-9][0-9]{5}$/;
const VEH_RE = /^[A-Z0-9]{7,15}$/;
const TRANSID_RE = /^[0-9]{2}[A-Z0-9]{13}$/;

function gstinChecksumOk(g) {
  const chars = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  let sum = 0;
  for (let i = 0; i < 14; i++) { const p = chars.indexOf(g[i]) * (i % 2 === 0 ? 1 : 2); sum += Math.floor(p / 36) + (p % 36); }
  return chars[(36 - (sum % 36)) % 36] === g[14];
}

const clip = (s, n) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const digits = s => String(s ?? '').replace(/\D/g, '');

/** Split a free-text address into Addr1 / Addr2 (100 chars each) and a locality (city). */
function splitAddress(address, fallbackLoc) {
  const lines = String(address || '').split(/\r?\n|,/).map(s => s.trim()).filter(Boolean);
  const pinless = lines.map(l => l.replace(/[-–\s]*\b[1-9][0-9]{5}\b/, '').trim()).filter(Boolean);
  // locality = last segment that is not a state / country name
  const stateNames = new Set(Object.values(STATES).map(x => x.toLowerCase()).concat(['india']));
  const locSeg = [...pinless].reverse().find(x => !stateNames.has(x.toLowerCase())) || fallbackLoc || '';
  const loc = clip(locSeg.replace(/^(dist\.?|district)\s*/i, ''), 50);
  const full = pinless.join(', ');
  return { addr1: clip(full.slice(0, 100), 100), addr2: full.length > 100 ? clip(full.slice(100), 100) : undefined, loc };
}
const pinOf = (pin, address) => {
  const p = digits(pin);
  if (p.length === 6) return Number(p);
  const m = String(address || '').match(/\b([1-9][0-9]{5})\b/);
  return m ? Number(m[1]) : null;
};

function partyBlocks(doc, company) {
  const sellerAddr = splitAddress(company.address, STATES[normState(company.stateCode)]);
  const buyerAddr = splitAddress(doc.buyerAddress, doc.buyerState);
  const shipSame = !doc.shipAddress || doc.shipAddress === doc.buyerAddress;
  const shipAddr = shipSame ? buyerAddr : splitAddress(doc.shipAddress, doc.shipState);
  return {
    seller: { gstin: company.gstin, legal: company.legalName || company.name, trade: company.name, ...sellerAddr,
      pin: pinOf(company.pin, company.address), stcd: normState(company.stateCode), ph: digits(company.phone).slice(-12), em: company.email },
    buyer: { gstin: doc.buyerGstin, legal: doc.buyerName, ...buyerAddr, pin: pinOf(doc.buyerPin, doc.buyerAddress), stcd: normState(doc.buyerStateCode), ph: digits(doc.buyerPhone).slice(-12) },
    ship: { same: shipSame && (!doc.shipName || doc.shipName === doc.buyerName), gstin: doc.shipGstin, legal: doc.shipName || doc.buyerName, ...shipAddr,
      pin: pinOf(doc.shipPin || (shipSame ? doc.buyerPin : ''), shipSame ? doc.buyerAddress : doc.shipAddress), stcd: normState(doc.shipStateCode || doc.buyerStateCode) }
  };
}

function baseChecks(doc, company, c, errors, warnings) {
  const E = (f, m) => errors.push({ field: f, message: m });
  if (!['INV', 'CRN', 'DBN'].includes(doc.docType)) E('docType', 'Document type must be INV, CRN or DBN.');
  if (!doc.date || !/^\d{4}-\d{2}-\d{2}$/.test(doc.date)) E('date', 'Document date is missing.');
  if (!(c.items.length)) E('items', 'At least one item is required.');
  if (!/^[0-9]{2}[A-Z0-9]{13}$/.test(String(company.gstin || ''))) E('company.gstin', 'Your GSTIN is missing in Settings → Company.');
  if (c.items.length > 1000) E('items', 'Maximum 1000 items per e-invoice.');
  c.items.forEach((it, i) => {
    const n = `Item ${i + 1}`;
    if (!/^\d{4}$|^\d{6}$|^\d{8}$/.test(String(it.hsn || ''))) E(`items[${i}].hsn`, `${n}: HSN/SAC must be 4, 6 or 8 digits.`);
    if (!(it.qty > 0)) E(`items[${i}].qty`, `${n}: quantity must be more than 0.`);
    if (!it.desc) E(`items[${i}].desc`, `${n}: description is required.`);
    if (!normUQC(it.unit)) warnings.push({ field: `items[${i}].unit`, message: `${n}: "${it.unit}" is not a GST UQC; OTH will be sent.` });
  });
  // place of supply must follow the FACTS recorded with the document (IGST Act s.10(1)(a)/(b)) — the server re-derives it
  const exportish = ['EXPWP', 'EXPWOP', 'SEZWP', 'SEZWOP'].includes(doc.supplyType);
  const goods = c.items.some(it => !String(it.hsn || '').startsWith('99'));
  const bSC = normState(doc.buyerStateCode), sSC = normState(doc.shipStateCode || doc.buyerStateCode);
  if (GST_RULES && goods && !exportish && bSC && sSC && bSC !== sSC) {
    const r = GST_RULES.posForGoods({ supplierSC: company.stateCode, buyerSC: bSC, shipSC: sSC, shipMode: doc.shipMode });
    if (r.need === 'shipMode') E('shipMode', 'Delivery state differs from the buyer\'s state, but the document does not record who receives the goods (buyer itself or a third person on its instruction). Open it in the app, answer that question and save.');
    else if (r.pos && normState(doc.pos) !== r.pos && !String(doc.posReason || '').trim())
      E('pos', `Place of supply ${normState(doc.pos)} contradicts Sec ${r.rule} of the IGST Act (${r.pos}).`);
    else if (r.pos && normState(doc.pos) !== r.pos) warnings.push({ field: 'pos', message: `Place of supply set by hand (${normState(doc.pos)}; the rule gives ${r.pos}): ${doc.posReason}` });
  }
  // the browser's totals must match our own calculation
  if (doc.grandTotal !== undefined && Math.abs(Number(doc.grandTotal) - c.grandTotal) > 0.009)
    E('grandTotal', `Totals mismatch: app shows ${doc.grandTotal}, server calculates ${c.grandTotal}. Re-save the document.`);
}

function sellerChecks(p, cfgGstin, errors) {
  const E = (f, m) => errors.push({ field: f, message: m });
  if (cfgGstin && p.seller.gstin !== cfgGstin) E('company.gstin', `Company GSTIN in the app (${p.seller.gstin}) is not the GSTIN whose e-invoice login is saved (${cfgGstin}).`);
  if (!p.seller.pin || !PIN_RE.test(String(p.seller.pin))) E('company.pin', 'Company PIN code is required (Settings → PIN).');
  if (!STATES[p.seller.stcd]) E('company.stateCode', 'Company state code is invalid.');
  if (p.seller.legal.length < 3) E('company.legalName', 'Company legal name must be at least 3 characters.');
  if (p.seller.addr1.length < 1) E('company.address', 'Company address is required.');
  if (p.seller.loc.length < 3) E('company.address', 'Company address must contain a city / place (at least 3 letters).');
}

/* ---------------------------------------------------------------- e-Invoice */

function buildIrpPayload(doc, company, { cfgGstin, withEwb = false } = {}) {
  const errors = [], warnings = [];
  const E = (f, m) => errors.push({ field: f, message: m });
  const c = computeDoc(doc, company.stateCode);
  const p = partyBlocks(doc, company);
  const st = doc.supplyType;
  const exportSupply = st === 'EXPWP' || st === 'EXPWOP';

  baseChecks(doc, company, c, errors, warnings);
  sellerChecks(p, cfgGstin, errors);
  if (!['B2B', 'SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP', 'DEXP'].includes(st))
    E('supplyType', `E-invoicing does not apply to ${st || 'this'} supply (B2C invoices are not reported to the IRP).`);
  if (!DOCNO_IRP_RE.test(doc.num || '')) E('num', `Document number "${doc.num}" is not accepted by the IRP: it must be 1–16 characters, start with a letter or 1–9 (not 0, "/" or "-"). Set an invoice prefix such as "HGI/" in Settings.`);
  if (doc.cancelled) E('cancelled', 'Document is cancelled.');
  if (doc.reverseCharge) warnings.push({ field: 'reverseCharge', message: 'Reverse-charge e-invoice: confirm with your CA how the IRP expects the invoice value for your goods.' });
  if (!exportSupply) {
    const g = String(doc.buyerGstin || '').toUpperCase();
    if (!GSTIN_RE.test(g)) E('buyerGstin', 'Buyer GSTIN is missing or invalid.');
    else if (!gstinChecksumOk(g) && g.length === 15 && /^[0-9]{2}[A-Z]{5}/.test(g)) E('buyerGstin', 'Buyer GSTIN check-digit is wrong.');
    if (g === p.seller.gstin) E('buyerGstin', 'Buyer GSTIN cannot be the same as yours.');
    if (!p.buyer.pin) E('buyerPin', 'Buyer PIN code is required.');
    if (!STATES[p.buyer.stcd]) E('buyerStateCode', 'Buyer state code is required.');
    if (p.buyer.loc.length < 3) E('buyerAddress', 'Buyer address must contain a city / place.');
  }
  if (!doc.buyerName || doc.buyerName.trim().length < 3) E('buyerName', 'Buyer legal name must be at least 3 characters.');
  if (!STATES[normState(doc.pos)]) E('pos', 'Place of supply is invalid.');

  // --- items: discount via item Discount; packing/freight via extra lines per HSN+rate
  const lines = [];
  const discTotal = c.discount;
  let discAlloc = 0;
  const charges = {};
  const noCharges = round2(c.pf + c.other) === 0;
  c.items.forEach((it, i) => {
    // item.taxable (engine) = amount + netShare, netShare = chargeShare - discountShare
    let disc = noCharges ? Math.max(0, -it.netShare)
      : (i === c.items.length - 1 ? round2(discTotal - discAlloc) : (c.subtotal > 0 ? round2(discTotal * it.amount / c.subtotal) : 0));
    discAlloc = round2(discAlloc + disc);
    let charge = round2(it.netShare + disc);                         // positive share of packing / freight
    if (charge < 0) { disc = round2(disc + charge); charge = 0; }     // paisa rounding guard
    const isServc = String(it.hsn).startsWith('99') ? 'Y' : 'N';
    lines.push({ hsn: String(it.hsn), rate: it.gst, isServc, desc: clip(it.desc, 300), qty: it.qty, unit: normUQC(it.unit) || 'OTH',
      unitPrice: it.rate, totAmt: it.amount, discount: round2(Math.min(disc, it.amount)), assAmt: 0 });
    if (charge > 0.004) {
      const k = `${it.hsn}|${it.gst}|${isServc}`;
      charges[k] = charges[k] || { hsn: String(it.hsn), rate: it.gst, isServc, amt: 0 };
      charges[k].amt = round2(charges[k].amt + charge);
    }
  });
  Object.values(charges).forEach(ch => lines.push({ hsn: ch.hsn, rate: ch.rate, isServc: ch.isServc, desc: 'Packing, forwarding & freight (part of supply)',
    qty: undefined, unit: undefined, unitPrice: ch.amt, totAmt: ch.amt, discount: 0, assAmt: ch.amt }));
  lines.forEach(l => { l.assAmt = round2(l.totAmt - l.discount); });

  // taxes per line, reconciled so HSN+rate totals equal the printed invoice exactly
  const target = {};
  c.taxLines.forEach(g => { const k = `${g.hsn}|${g.rate}`; const t = target[k] || (target[k] = { igst: 0, cgst: 0, sgst: 0 }); t.igst = round2(t.igst + g.igst); t.cgst = round2(t.cgst + g.cgst); t.sgst = round2(t.sgst + g.sgst); });
  lines.forEach(l => {
    if (c.lut) { l.igstAmt = 0; l.cgstAmt = 0; l.sgstAmt = 0; }
    else if (c.isInter) { l.igstAmt = round2(l.assAmt * l.rate / 100); l.cgstAmt = 0; l.sgstAmt = 0; }
    else { l.cgstAmt = round2(l.assAmt * l.rate / 200); l.sgstAmt = l.cgstAmt; l.igstAmt = 0; }
  });
  Object.entries(target).forEach(([k, t]) => {
    const grp = lines.filter(l => `${l.hsn}|${l.rate}` === k);
    if (!grp.length) return;
    const big = grp.reduce((a, b) => (b.assAmt > a.assAmt ? b : a));
    for (const f of ['igst', 'cgst', 'sgst']) {
      const sum = round2(grp.reduce((a, l) => a + l[f + 'Amt'], 0));
      big[f + 'Amt'] = round2(big[f + 'Amt'] + (t[f] - sum));
    }
  });
  const assSum = round2(lines.reduce((a, l) => a + l.assAmt, 0));
  if (Math.abs(assSum - c.taxable) > 0.009) E('items', `Internal mapping error: assessable value ${assSum} ≠ ${c.taxable}.`);

  const opt = (o) => { Object.keys(o).forEach(k => (o[k] === undefined || o[k] === '' || o[k] === null) && delete o[k]); return o; };
  const payload = {
    Version: '1.1',
    TranDtls: opt({ TaxSch: 'GST', SupTyp: st, RegRev: doc.reverseCharge ? 'Y' : 'N', EcmGstin: null,
      IgstOnIntra: c.isInter && normState(doc.pos) === p.seller.stcd && !exportSupply ? 'Y' : 'N' }),
    DocDtls: { Typ: doc.docType, No: doc.num, Dt: ddmmyyyy(doc.date) },
    SellerDtls: opt({ Gstin: p.seller.gstin, LglNm: clip(p.seller.legal, 100), TrdNm: clip(p.seller.trade, 100), Addr1: p.seller.addr1, Addr2: p.seller.addr2,
      Loc: p.seller.loc, Pin: p.seller.pin, Stcd: p.seller.stcd, Ph: p.seller.ph && p.seller.ph.length >= 6 ? p.seller.ph : undefined,
      Em: /^\S+@\S+\.\S+$/.test(p.seller.em || '') ? clip(p.seller.em, 100) : undefined }),
    BuyerDtls: opt(exportSupply
      ? { Gstin: 'URP', LglNm: clip(doc.buyerName, 100), Pos: '96', Addr1: p.buyer.addr1 || 'Outside India', Addr2: p.buyer.addr2, Loc: p.buyer.loc || 'Outside India', Pin: 999999, Stcd: '96' }
      : { Gstin: String(doc.buyerGstin).toUpperCase(), LglNm: clip(doc.buyerName, 100), Pos: normState(doc.pos), Addr1: p.buyer.addr1, Addr2: p.buyer.addr2,
          Loc: p.buyer.loc, Pin: p.buyer.pin, Stcd: p.buyer.stcd, Ph: p.buyer.ph && p.buyer.ph.length >= 6 ? p.buyer.ph : undefined }),
    ItemList: lines.map((l, i) => opt({
      SlNo: String(i + 1), PrdDesc: l.desc, IsServc: l.isServc, HsnCd: l.hsn, Qty: l.qty !== undefined ? round3(l.qty) : undefined, Unit: l.unit,
      UnitPrice: round3(l.unitPrice), TotAmt: l.totAmt, Discount: l.discount, AssAmt: l.assAmt, GstRt: l.rate,
      IgstAmt: l.igstAmt, CgstAmt: l.cgstAmt, SgstAmt: l.sgstAmt, CesRt: 0, CesAmt: 0, CesNonAdvlAmt: 0, StateCesRt: 0, StateCesAmt: 0, StateCesNonAdvlAmt: 0,
      OthChrg: 0, TotItemVal: round2(l.assAmt + l.igstAmt + l.cgstAmt + l.sgstAmt)
    })),
    ValDtls: { AssVal: c.taxable, CgstVal: c.cgst, SgstVal: c.sgst, IgstVal: c.igst, CesVal: 0, StCesVal: 0, Discount: 0, OthChrg: 0, RndOffAmt: c.roundoff, TotInvVal: c.grandTotal }
  };
  if (doc.docType !== 'INV' && doc.refNum) {
    payload.RefDtls = { PrecDocDtls: [opt({ InvNo: doc.refNum, InvDt: ddmmyyyy(doc.refDate) })] };
  }
  if (!p.ship.same && !exportSupply) {
    const sg = String(doc.shipGstin || '').toUpperCase();
    if (sg && sg === String(doc.buyerGstin).toUpperCase())
      warnings.push({ field: 'shipGstin', message: 'Ship-to GSTIN equals Bill-to GSTIN. Since 01-Aug-2026 the IRP/EWB rejects identical Bill-to and Ship-to GSTINs when an e-way bill is generated.' });
    if (!p.ship.pin) E('shipPin', 'Consignee PIN code is required.');
    payload.ShipDtls = opt({ Gstin: sg || 'URP', LglNm: clip(p.ship.legal, 100), TrdNm: clip(p.ship.legal, 100), Addr1: p.ship.addr1, Addr2: p.ship.addr2,
      Loc: p.ship.loc, Pin: p.ship.pin, Stcd: p.ship.stcd });
  }
  if (exportSupply && (p.ship.pin || doc.shipAddress)) {
    // goods leave India through this port / location
    payload.ShipDtls = opt({ Gstin: 'URP', LglNm: clip(p.ship.legal, 100), Addr1: p.ship.addr1 || 'Port', Loc: p.ship.loc || 'Port', Pin: p.ship.pin || undefined, Stcd: p.ship.stcd || undefined });
  }
  if (withEwb) {
    const t = transportOf(doc);
    transportChecks(t, errors, warnings, { needPartB: false });
    payload.EwbDtls = opt({ TransId: t.transId, TransName: t.transName, TransMode: t.vehicleNo || t.transDocNo ? t.transMode : undefined,
      Distance: t.distance, TransDocNo: t.transDocNo, TransDocDt: t.transDocDate, VehNo: t.vehicleNo, VehType: t.vehicleNo ? t.vehicleType : undefined });
    if (lines.every(l => l.isServc === 'Y')) E('items', 'E-way bill is only for goods; all items are services.');
  }
  return { payload, errors, warnings, totals: c };
}
const round3 = n => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;

/* ---------------------------------------------------------------- transport */

function transportOf(doc) {
  const t = doc.transport || {};
  const veh = String(t.vehicleNo || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return {
    transId: String(t.transId || '').toUpperCase().trim() || undefined,
    transName: clip(t.transName || '', 100) || undefined,
    transMode: String(t.transMode || '1'),
    distance: Math.max(0, parseInt(t.distance ?? 0, 10) || 0),
    transDocNo: clip(t.transDocNo || '', 15) || undefined,
    transDocDate: t.transDocDate ? ddmmyyyy(t.transDocDate) : undefined,
    vehicleNo: veh || undefined,
    vehicleType: t.vehicleType === 'O' ? 'O' : 'R'
  };
}

function transportChecks(t, errors, warnings, { needPartB }) {
  const E = (f, m) => errors.push({ field: f, message: m });
  if (!['1', '2', '3', '4'].includes(t.transMode)) E('transMode', 'Transport mode must be Road, Rail, Air or Ship.');
  if (t.distance > 4000) E('distance', 'Distance must be less than 4000 km (0 = let the portal calculate from PIN codes).');
  if (t.transId && !TRANSID_RE.test(t.transId)) E('transId', 'Transporter ID must be a 15-character GSTIN / TRANSIN.');
  if (t.vehicleNo && t.transMode === '1' && !VEH_RE.test(t.vehicleNo)) E('vehicleNo', 'Vehicle number looks invalid (e.g. GJ05AB1234).');
  if (t.transMode !== '1' && !t.transDocNo && (t.vehicleNo || needPartB)) E('transDocNo', 'Rail / Air / Ship needs the transport document number and date.');
  if (t.transDocNo && !t.transDocDate) E('transDocDate', 'Transport document date is required with the document number.');
  if (!t.vehicleNo && !t.transDocNo) {
    if (needPartB && !t.transId) E('vehicleNo', 'Enter the vehicle number (Part-B) or a transporter ID (Part-A only).');
    else warnings.push({ field: 'vehicleNo', message: 'No vehicle / transport document: only Part-A will be generated; goods cannot move until Part-B is updated.' });
  }
  return errors.length === 0;
}

function buildEwbByIrnBody(irn, doc) {
  const errors = [], warnings = [];
  const t = transportOf(doc);
  transportChecks(t, errors, warnings, { needPartB: false });
  if (!/^[0-9a-f]{64}$/i.test(irn || '')) errors.push({ field: 'irn', message: 'A valid IRN is required.' });
  const body = { Irn: irn, Distance: t.distance };
  if (t.transId) body.TransId = t.transId;
  if (t.transName) body.TransName = t.transName;
  if (t.vehicleNo || t.transDocNo) {
    body.TransMode = t.transMode;
    if (t.transDocNo) { body.TransDocNo = t.transDocNo; body.TransDocDt = t.transDocDate; }
    if (t.vehicleNo) { body.VehNo = t.vehicleNo; body.VehType = t.vehicleType; }
  }
  return { body, errors, warnings };
}

/* ---------------------------------------------------------------- e-Way Bill (no IRN) */

function buildEwbPayload(doc, company, { cfgGstin } = {}) {
  const errors = [], warnings = [];
  const E = (f, m) => errors.push({ field: f, message: m });
  const c = computeDoc(doc, company.stateCode);
  const p = partyBlocks(doc, company);
  baseChecks(doc, company, c, errors, warnings);
  sellerChecks(p, cfgGstin, errors);
  if (doc.docType !== 'INV') E('docType', 'E-way bill from this app is for outward invoices only.');
  if (!DOCNO_EWB_RE.test(doc.num || '')) E('num', 'Document number must be 1–16 letters, digits, "/" or "-".');
  if (doc.cancelled) E('cancelled', 'Document is cancelled.');
  const st = doc.supplyType;
  const exportSupply = st === 'EXPWP' || st === 'EXPWOP';
  const allZero = c.items.length && c.items.every(i => i.gst === 0);
  if (c.items.some(i => String(i.hsn).startsWith('99'))) warnings.push({ field: 'items', message: 'Service (SAC 99…) lines are not goods and will be left out of the e-way bill.' });
  const goods = c.items.filter(i => !String(i.hsn).startsWith('99'));
  if (!goods.length) E('items', 'E-way bill is only for movement of goods.');
  if (goods.length > 250) E('items', 'E-way bill allows at most 250 item lines.');

  const toGstin = exportSupply ? 'URP' : (String(doc.buyerGstin || '').toUpperCase() || 'URP');
  if (toGstin !== 'URP' && !GSTIN_RE.test(toGstin)) E('buyerGstin', 'Buyer GSTIN is invalid.');
  const shipPin = p.ship.pin, actTo = p.ship.stcd;
  if (!shipPin) E('shipPin', 'Delivery PIN code is required for the e-way bill.');
  if (!STATES[actTo] && !exportSupply) E('shipStateCode', 'Delivery state code is required.');
  const t = transportOf(doc);
  transportChecks(t, errors, warnings, { needPartB: false });
  const sameParty = doc.shipMode === 'third' ? false : p.ship.same;   // recorded bill-to / ship-to (Sec 10(1)(b)) → transaction type 2
  // GSTN advisory 18-12-2024: from 01-01-2025 no e-way bill for a document older than 180 days
  const maxAge = GST_RULES ? GST_RULES.at('ewbMaxDocAgeDays', new Date().toISOString().slice(0, 10)) : 180;
  if (maxAge && doc.date && /^\d{4}-\d{2}-\d{2}$/.test(doc.date)) {
    const todayIst = new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
    const age = Math.round((Date.parse(todayIst) - Date.parse(doc.date)) / 86400e3);
    if (age > maxAge) E('date', `The document is ${age} days old: the e-way bill system does not accept documents older than ${maxAge} days.`);
  }
  const transactionType = sameParty ? 1 : 2;      // 1 Regular, 2 Bill To - Ship To
  const opt = (o) => { Object.keys(o).forEach(k => (o[k] === undefined || o[k] === '' || o[k] === null) && delete o[k]); return o; };
  const payload = opt({
    supplyType: 'O', subSupplyType: exportSupply ? '3' : '1', docType: allZero && !exportSupply ? 'BIL' : 'INV',
    docNo: doc.num, docDate: ddmmyyyy(doc.date),
    fromGstin: p.seller.gstin, fromTrdName: clip(p.seller.trade, 100), fromAddr1: p.seller.addr1.slice(0, 120), fromAddr2: p.seller.addr2,
    fromPlace: clip(p.seller.loc, 50), fromPincode: p.seller.pin, fromStateCode: Number(p.seller.stcd), actFromStateCode: Number(p.seller.stcd),
    toGstin, toTrdName: clip(doc.buyerName, 100), toAddr1: p.ship.addr1.slice(0, 120), toAddr2: p.ship.addr2, toPlace: clip(p.ship.loc, 50),
    toPincode: shipPin, toStateCode: exportSupply ? 99 : Number(normState(doc.pos)), actToStateCode: Number(actTo || 99),
    transactionType, totalValue: c.taxable, cgstValue: c.cgst, sgstValue: c.sgst, igstValue: c.igst, cessValue: 0, cessNonAdvolValue: 0,
    otherValue: c.roundoff, totInvValue: c.grandTotal,
    transporterId: t.transId, transporterName: t.transName, transDocNo: t.transDocNo, transDocDate: t.transDocDate,
    transMode: t.vehicleNo || t.transDocNo ? t.transMode : undefined, transDistance: String(t.distance), vehicleNo: t.vehicleNo,
    vehicleType: t.vehicleNo ? t.vehicleType : undefined,
    itemList: goods.map(it => opt({
      productName: clip(it.desc, 100), productDesc: clip(it.desc, 100), hsnCode: Number(it.hsn), quantity: round3(it.qty),
      qtyUnit: normUQC(it.unit) || 'OTH', taxableAmount: it.taxable,
      cgstRate: c.isInter || c.lut ? 0 : it.gst / 2, sgstRate: c.isInter || c.lut ? 0 : it.gst / 2, igstRate: c.isInter && !c.lut ? it.gst : 0, cessRate: 0
    }))
  });
  return { payload, errors, warnings, totals: c };
}

function docKey(company, doc) { return `${company.gstin}|${doc.docType}|${doc.num}|${fyOf(doc.date)}`; }

module.exports = { buildIrpPayload, buildEwbPayload, buildEwbByIrnBody, transportOf, transportChecks, docKey, splitAddress, GSTIN_RE, DOCNO_IRP_RE, VEH_RE, TRANSID_RE };
