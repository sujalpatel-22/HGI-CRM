'use strict';
/**
 * Server-side copy of the billing app's tax engine (computeDoc in src/app.template.html).
 * The backend NEVER trusts totals sent by the browser: it recalculates them and
 * refuses to report a document whose numbers don't match.
 */
const round2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const STATES = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh', '05': 'Uttarakhand', '06': 'Haryana',
  '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh', '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland',
  '14': 'Manipur', '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal', '20': 'Jharkhand',
  '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat', '26': 'Dadra & Nagar Haveli and Daman & Diu',
  '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa', '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh', '97': 'Other Territory', '96': 'Other Countries'
};

const UQC = new Set(['BAG', 'BAL', 'BDL', 'BKL', 'BOU', 'BOX', 'BTL', 'BUN', 'CAN', 'CBM', 'CCM', 'CMS', 'CTN', 'DOZ', 'DRM', 'GGK', 'GMS', 'GRS', 'GYD',
  'KGS', 'KLR', 'KME', 'LTR', 'MLT', 'MTR', 'MTS', 'NOS', 'OTH', 'PAC', 'PCS', 'PRS', 'QTL', 'ROL', 'SET', 'SQF', 'SQM', 'SQY', 'TBS', 'TGM', 'THD',
  'TON', 'TUB', 'UGS', 'UNT', 'YDS']);

const UQC_ALIAS = { NO: 'NOS', NOS: 'NOS', NUMBER: 'NOS', NUMBERS: 'NOS', PC: 'PCS', PCS: 'PCS', PIECE: 'PCS', PIECES: 'PCS', KG: 'KGS', KGS: 'KGS',
  KILO: 'KGS', G: 'GMS', GM: 'GMS', GRAM: 'GMS', L: 'LTR', LTR: 'LTR', LITRE: 'LTR', LITER: 'LTR', ML: 'MLT', M: 'MTR', MTR: 'MTR', METER: 'MTR', METRE: 'MTR',
  MT: 'MTS', TONNE: 'TON', TON: 'TON', SET: 'SET', SETS: 'SET', BOX: 'BOX', BOXES: 'BOX', PAIR: 'PRS', PAIRS: 'PRS', DOZEN: 'DOZ', SQFT: 'SQF', SQM: 'SQM',
  ROLL: 'ROL', ROLLS: 'ROL', BAG: 'BAG', BAGS: 'BAG', UNIT: 'UNT', UNITS: 'UNT', LOT: 'OTH', JOB: 'OTH', HRS: 'OTH', HR: 'OTH' };
/** the app's normUQC(): GST unit code, or '' when the unit is not one */
const normUQC = u => { const k = String(u || '').trim().toUpperCase().replace(/[^A-Z]/g, ''); return UQC.has(k) ? k : (UQC_ALIAS[k] || ''); };
const normState = c => { c = String(c || '').trim(); return /^\d$/.test(c) ? '0' + c : c; };
const isExportish = st => ['SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP'].includes(st);
const isLUT = st => st === 'SEZWOP' || st === 'EXPWOP';

function fyOf(iso) {
  const [y, m] = String(iso).split('-').map(Number);
  const s = m < 4 ? y - 1 : y;
  return `${String(s).slice(-2)}-${String(s + 1).slice(-2)}`;
}
const ddmmyyyy = iso => { const [y, m, d] = String(iso || '').split('-'); return y && m && d ? `${d}/${m}/${y}` : ''; };

function computeDoc(d, companyStateCode) {
  const items = (d.items || []).map(it => {
    const qty = Number(it.qty) || 0, rate = Number(it.rate) || 0;
    return { ...it, qty, rate, gst: Number(it.gst) || 0, amount: round2(qty * rate) };
  });
  const subtotal = round2(items.reduce((a, it) => a + it.amount, 0));
  const discount = round2(Number(d.discount ?? d.discountAmt) || 0);
  const pf = round2(Number(d.pfCharges) || 0), other = round2(Number(d.otherCharges) || 0);
  const adj = round2(pf + other - discount);
  let alloc = 0;
  items.forEach((it, i) => {
    const share = i === items.length - 1 ? round2(adj - alloc) : (subtotal > 0 ? round2(adj * it.amount / subtotal) : 0);
    alloc = round2(alloc + share);
    it.netShare = share;
    it.taxable = round2(Math.max(0, it.amount + share));
  });
  const taxable = round2(items.reduce((a, it) => a + it.taxable, 0));
  const st = d.supplyType || 'B2B';
  const pos = normState(d.pos);
  const comp = normState(companyStateCode);
  const isInter = isExportish(st) || (pos !== '' && pos !== comp);
  const lut = isLUT(st), rcm = !!d.reverseCharge;
  const groups = {};
  items.forEach(it => {
    const key = `${(it.hsn || '').trim() || '-'}|${it.gst}|${normUQC(it.unit) || 'OTH'}`;
    const g = groups[key] || (groups[key] = { hsn: (it.hsn || '').trim(), rate: it.gst, taxable: 0 });
    g.taxable = round2(g.taxable + it.taxable);
  });
  const taxLines = Object.values(groups).map(g => {
    g.cgst = 0; g.sgst = 0; g.igst = 0;
    if (!lut) { if (isInter) g.igst = round2(g.taxable * g.rate / 100); else { g.cgst = round2(g.taxable * g.rate / 200); g.sgst = g.cgst; } }
    return g;
  });
  const cgst = round2(taxLines.reduce((a, g) => a + g.cgst, 0));
  const sgst = round2(taxLines.reduce((a, g) => a + g.sgst, 0));
  const igst = round2(taxLines.reduce((a, g) => a + g.igst, 0));
  const raw = round2(taxable + (rcm ? 0 : cgst + sgst + igst));
  const grandTotal = Math.round(raw);
  return { items, subtotal, discount, pf, other, taxable, cgst, sgst, igst, taxLines, isInter, lut, rcm, roundoff: round2(grandTotal - raw), grandTotal, pos };
}

module.exports = { computeDoc, round2, STATES, UQC, normUQC, normState, isExportish, isLUT, fyOf, ddmmyyyy };
