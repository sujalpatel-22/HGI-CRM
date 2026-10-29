'use strict';
/**
 * Turns the app's data into plain, readable tabs for the company owner (Invoices, Items sold, Payments, Customers,
 * Products, Company). These tabs are a VIEW: the app restores from the exact copy in the hidden _data tabs,
 * so editing these cells never changes the app.
 */

const TYPE = { INV: 'Tax Invoice', QUO: 'Quotation', CRN: 'Credit Note', DBN: 'Debit Note', PRO: 'Proforma Invoice', DC: 'Delivery Challan', BOS: 'Bill of Supply' };
const n = v => (v === undefined || v === null || v === '' || isNaN(Number(v)) ? '' : Number(v));
const s = v => (v === undefined || v === null ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v));
// Sheets cells hold at most 50,000 characters
const cell = v => { const x = typeof v === 'number' ? v : s(v); return typeof x === 'string' && x.length > 49000 ? x.slice(0, 49000) + '…' : x; };
const round2 = x => Math.round((Number(x) || 0) * 100) / 100;

function tabs(state) {
  const st = state && typeof state === 'object' ? state : {};
  const docs = Array.isArray(st.invoices) ? st.invoices : [];
  const settled = d => round2((d.payments || []).reduce((a, p) => a + (Number(p.amount) || 0) + (Number(p.tds) || 0), 0));

  const invoices = [['Type', 'Number', 'Date', 'Buyer', 'Buyer GSTIN', 'Buyer state', 'Place of supply', 'Taxable value', 'CGST', 'SGST', 'IGST', 'Grand total', 'Received (incl. TDS)', 'Balance', 'Status', 'Reference', 'IRN', 'E-way bill', 'Document ID']];
  const items = [['Document', 'Type', 'Date', 'Buyer', 'Description', 'HSN/SAC', 'Qty', 'Unit', 'Rate', 'GST %', 'Line value (before tax)']];
  const pays = [['Document', 'Buyer', 'Payment date', 'Amount', 'TDS', 'Mode', 'Reference']];
  for (const d of docs) {
    if (!d || typeof d !== 'object') continue;
    const got = settled(d);
    const isSale = d.docType === 'INV' || !d.docType;
    invoices.push([TYPE[d.docType] || s(d.docType), s(d.num), s(d.date), s(d.buyerName), s(d.buyerGstin), s(d.buyerState), s(d.pos),
      n(d.taxable), n(d.cgst), n(d.sgst), n(d.igst), n(d.grandTotal), isSale ? got : '', isSale ? round2((Number(d.grandTotal) || 0) - got) : '',
      d.cancelled ? 'Cancelled' : '', s(d.refNum), s(d.irn), s(d.ewbNo), s(d.id)]);
    for (const it of Array.isArray(d.items) ? d.items : []) {
      items.push([s(d.num), TYPE[d.docType] || s(d.docType), s(d.date), s(d.buyerName), s(it.desc), s(it.hsn), n(it.qty), s(it.unit), n(it.rate), n(it.gst), round2((Number(it.qty) || 0) * (Number(it.rate) || 0))]);
    }
    for (const p of Array.isArray(d.payments) ? d.payments : []) pays.push([s(d.num), s(d.buyerName), s(p.date), n(p.amount), n(p.tds), s(p.mode), s(p.ref)]);
  }

  const custCols = ['name', 'gstin', 'phone', 'email', 'address', 'state', 'stateCode', 'pin'];
  const customers = [['Name', 'GSTIN', 'Phone', 'E-mail', 'Address', 'State', 'State code', 'PIN', 'Customer ID']];
  for (const c of Array.isArray(st.customers) ? st.customers : []) if (c) customers.push([...custCols.map(k => s(c[k])), s(c.id)]);

  const products = [['Name', 'HSN/SAC', 'Unit', 'Rate', 'GST %', 'Stock', 'Product ID']];
  for (const p of Array.isArray(st.products) ? st.products : []) if (p) products.push([s(p.name || p.desc), s(p.hsn), s(p.unit), n(p.rate), n(p.gst), n(p.stock), s(p.id)]);

  const co = st.company || {};
  const company = [['Field', 'Value']];
  for (const [k, label] of [['name', 'Business name'], ['legalName', 'Legal name'], ['gstin', 'GSTIN'], ['pan', 'PAN'], ['address', 'Address'], ['state', 'State'],
    ['stateCode', 'State code'], ['pin', 'PIN'], ['phone', 'Phone'], ['email', 'E-mail'], ['bankName', 'Bank'], ['bankAcc', 'Account no.'], ['bankIfsc', 'IFSC'],
    ['bankBranch', 'Branch'], ['upiId', 'UPI ID']]) company.push([label, s(co[k])]);

  const t = { Company: company, Invoices: invoices, 'Items sold': items, Payments: pays, Customers: customers, Products: products };
  for (const k of Object.keys(t)) t[k] = t[k].map(r => r.map(cell));
  return t;
}

module.exports = { tabs, READABLE_TABS: ['Company', 'Invoices', 'Items sold', 'Payments', 'Customers', 'Products'] };
