'use strict';
/**
 * The spreadsheet's tables (tabs) and how the app's records are spread over them.
 *
 * Every business row carries the owner's userId; the server takes it from the signed-in session, never from the request.
 * Keys are (userId, id), so two accounts may use the same record IDs without touching each other.
 *
 * Lossless storage: the app's record (JSON) is split into readable columns (names, GSTINs, amounts, dates…), child rows
 * (invoice lines → InvoiceItems, receipts → Payments) and one `extra` JSON cell holding the field order and every value
 * that is not a plain text / number / yes-no value (nested objects, empty texts, e-invoice data, history…). Reading the
 * rows back gives the exact same JSON text — this is checked on every save; a record that would not come back
 * identically is kept whole in `extra` instead (still readable columns, nothing lost).
 */

const SYNC = ['userId', 'id', 'rev', 'seq', 'deleted', 'hash', 'modifiedAt', 'device', 'updatedAt'];
const J = name => ({ name, json: true });

/* ------------------------------------------------------------------ entity column maps: [column, field] */
const COMPANY = [['businessName', 'name'], 'legalName', 'gstin', 'pan', 'address', 'state', 'stateCode', 'pin', 'phone', 'email', 'bankName', 'bankAcc', 'bankIfsc', 'bankBranch', 'upiId',
  'defaultCreditDays', 'aato', 'aatoPrev', 'scheme', 'lutArn', 'lutFy', 'ewbLimit', 'interestRate', 'tagline', 'showLogo'];
const CUSTOMER = ['name', 'partyType', 'gstin', 'phone', 'email', 'address', 'city', 'state', 'stateCode', 'pin', 'shipAddress', 'shipCity', 'shipState', 'shipStateCode', 'shipPin', 'creditDays', 'creditLimit', 'createdAt', ['recordUpdatedAt', 'updatedAt']];
const PRODUCT = ['name', 'sku', 'category', 'group', 'size', 'hsn', 'unit', 'rate', 'gst', 'trackStock', 'openingStock', 'minStock', 'specs', 'createdAt', ['recordUpdatedAt', 'updatedAt']];
const INVOICE = ['docType', 'num', 'date', 'dueDate', 'supplyType', 'pos', 'posRule', 'shipMode', 'reverseCharge', 'buyerName', 'buyerGstin', 'buyerAddress', 'buyerCity', 'buyerState', 'buyerStateCode', 'buyerPin', 'buyerPhone',
  'shipName', 'shipGstin', 'shipAddress', 'shipCity', 'shipState', 'shipStateCode', 'shipPin', 'refId', 'refNum', 'refDate', 'noteReason', 'poNum', 'poDate', 'lr', 'vehicle', 'transport',
  'subtotal', 'discount', 'pfCharges', 'otherCharges', 'taxable', 'cgst', 'sgst', 'igst', 'roundoff', 'grandTotal', 'status', 'cancelled', 'cancelReason', 'irn', 'ackNo', 'ackDate', 'ewbNo', 'ewbDate', 'issues', 'rulesVersion',
  'createdAt', ['recordUpdatedAt', 'updatedAt']];
const ITEM = ['desc', 'hsn', 'qty', 'unit', 'rate', 'gst', 'taxability', 'discount', 'amount'];
const PAYMENT = [['paymentId', 'id'], 'date', 'amount', 'tds', 'mode', 'ref'];
const cols = list => list.map(x => (Array.isArray(x) ? x[0] : x));

const TABLES = [
  { name: 'Users', key: ['userId'], index: ['usernameKey'], columns: ['userId', 'username', 'usernameKey', 'passwordHash', 'status', 'createdAt', 'updatedAt', 'lastLoginAt',
    'failedLogins', 'lockedUntil', 'passwordChangedAt', 'seq', 'lastSyncAt', 'deletedAt'] },
  { name: 'Sessions', key: ['sessionId'], index: ['userId'], columns: ['sessionId', 'userId', 'createdAt', 'expiresAt', 'revokedAt', 'device', 'renewedAt'] },
  { name: 'Settings', key: ['userId', 'kind', 'id'], index: ['userId'], columns: [...SYNC, 'kind', ...cols(COMPANY), J('extra')] },
  { name: 'Customers', key: ['userId', 'id'], index: ['userId'], columns: [...SYNC, ...cols(CUSTOMER), J('extra')] },
  { name: 'Products', key: ['userId', 'id'], index: ['userId'], columns: [...SYNC, ...cols(PRODUCT), J('extra')] },
  { name: 'Invoices', key: ['userId', 'id'], index: ['userId'], columns: [...SYNC, ...cols(INVOICE), J('extra')] },
  { name: 'InvoiceItems', key: ['userId', 'invoiceId', 'lineNo'], index: ['userId', 'invoiceId'], columns: ['userId', 'invoiceId', 'lineNo', 'invoiceNum', 'invoiceDate', 'docType', ...cols(ITEM), J('extra')] },
  { name: 'Payments', key: ['userId', 'invoiceId', 'lineNo'], index: ['userId', 'invoiceId'], columns: ['userId', 'invoiceId', 'lineNo', 'invoiceNum', ...cols(PAYMENT), J('extra')] },
  { name: 'DocNumbers', key: ['userId', 'numKey'], index: ['userId'], columns: ['userId', 'numKey', 'docType', 'num', 'docId', 'claimedAt'] },
  // server-side records of other features (e-invoice records, encrypted e-invoice API logins, PDF index, GSTIN cache)
  { name: 'Store', key: ['path'], index: ['userId'], columns: ['path', 'userId', 'kind', J('data'), 'updatedAt'] }
];

// record kinds of the sync protocol → tab + entity map
const KIND_TAB = { company: 'Settings', settings: 'Settings', customer: 'Customers', product: 'Products', invoice: 'Invoices' };
const RECORD_TABS = ['Settings', 'Customers', 'Products', 'Invoices'];

/* ------------------------------------------------------------------ generic entity codec */
const PLAIN_MAX = 40000;
const isPlain = v => (typeof v === 'string' && v !== '' && v.length <= PLAIN_MAX) || (typeof v === 'number' && Number.isFinite(v)) || typeof v === 'boolean';
const mapOf = list => { const f2c = new Map(), c2f = new Map(); for (const x of list) { const [c, f] = Array.isArray(x) ? x : [x, x]; f2c.set(f, c); c2f.set(c, f); } return { f2c, c2f }; };
const MAPS = { company: mapOf(COMPANY), customer: mapOf(CUSTOMER), product: mapOf(PRODUCT), invoice: mapOf(INVOICE), item: mapOf(ITEM), payment: mapOf(PAYMENT) };

/** obj → { cols: {column: value}, extra: {o: [keys in order], x: {non-plain values}} } ; skip = fields kept elsewhere (child rows) */
function encodeEntity(obj, map, skip = new Set(), keepAll = false) {
  const cols = {}, x = {}, o = Object.keys(obj);
  for (const k of o) {
    if (skip.has(k)) continue;
    const v = obj[k], c = map.f2c.get(k);
    if (c && isPlain(v)) { cols[c] = v; if (keepAll) x[k] = v; } else x[k] = v;
  }
  return { cols, extra: { o, x } };
}
/** rows → obj ; children = {field: value} for the skipped fields */
function decodeEntity(cols, extra, map, children = {}) {
  const out = {};
  const o = extra && Array.isArray(extra.o) ? extra.o : null;
  const x = (extra && extra.x) || {};
  if (!o) {   // a row written by hand / an older layout: take what the columns say
    for (const [c, f] of map.c2f) if (cols[c] !== undefined) out[f] = cols[c];
    return Object.assign(out, x, children);
  }
  for (const k of o) {
    if (Object.prototype.hasOwnProperty.call(x, k)) out[k] = x[k];
    else if (Object.prototype.hasOwnProperty.call(children, k)) out[k] = children[k];
    else { const c = map.f2c.get(k); if (c && cols[c] !== undefined) out[k] = cols[c]; }
  }
  return out;
}

/* ------------------------------------------------------------------ record ⇄ rows */
const childList = v => Array.isArray(v) && v.every(e => e && typeof e === 'object' && !Array.isArray(e));

/**
 * record (kind, id, obj) → { main: {columns}, items: [{columns}], payments: [{columns}] } — without the sync columns
 */
function recordToRows(kind, obj, keepAll = false) {
  if (kind === 'company' || kind === 'settings') {
    const e = kind === 'company' ? encodeEntity(obj, MAPS.company, undefined, keepAll) : { cols: {}, extra: { o: Object.keys(obj), x: { ...obj } } };
    return { main: { kind, ...e.cols, extra: e.extra }, items: [], payments: [] };
  }
  if (kind === 'customer' || kind === 'product') {
    const e = encodeEntity(obj, MAPS[kind], keepAll ? new Set() : new Set(['id']), keepAll);
    return { main: { ...e.cols, extra: e.extra }, items: [], payments: [] };
  }
  // invoice / note / quotation / proforma / order
  const splitItems = !keepAll && childList(obj.items), splitPays = !keepAll && childList(obj.payments);
  const skip = new Set([...(keepAll ? [] : ['id']), ...(splitItems ? ['items'] : []), ...(splitPays ? ['payments'] : [])]);
  const e = encodeEntity(obj, MAPS.invoice, skip, keepAll);
  const ref = { invoiceNum: isPlain(obj.num) ? obj.num : undefined };
  const items = splitItems ? obj.items.map((it, i) => { const c = encodeEntity(it, MAPS.item); return { lineNo: i + 1, ...ref, invoiceDate: isPlain(obj.date) ? obj.date : undefined, docType: isPlain(obj.docType) ? obj.docType : undefined, ...c.cols, extra: c.extra }; }) : [];
  const payments = splitPays ? obj.payments.map((p, i) => { const c = encodeEntity(p, MAPS.payment); return { lineNo: i + 1, ...ref, ...c.cols, extra: c.extra }; }) : [];
  return { main: { ...e.cols, extra: { ...e.extra, items: splitItems ? obj.items.length : undefined, payments: splitPays ? obj.payments.length : undefined } }, items, payments };
}

/** rows → record object */
function rowsToRecord(kind, id, main, items = [], payments = []) {
  const pick = (row, list) => { const c = {}; for (const x of list) { const col = Array.isArray(x) ? x[0] : x; if (row[col] !== undefined) c[col] = row[col]; } return c; };
  if (kind === 'company') return decodeEntity(pick(main, COMPANY), main.extra, MAPS.company);
  if (kind === 'settings') return decodeEntity({}, main.extra, { f2c: new Map(), c2f: new Map() });
  if (kind === 'customer' || kind === 'product') return decodeEntity(pick(main, kind === 'customer' ? CUSTOMER : PRODUCT), main.extra, MAPS[kind], { id });
  const ex = main.extra || {};
  const children = { id };
  if (typeof ex.items === 'number') children.items = [...items].sort((a, b) => a.lineNo - b.lineNo).slice(0, ex.items).map(r => decodeEntity(pick(r, ITEM), r.extra, MAPS.item));
  if (typeof ex.payments === 'number') children.payments = [...payments].sort((a, b) => a.lineNo - b.lineNo).slice(0, ex.payments).map(r => decodeEntity(pick(r, PAYMENT), r.extra, MAPS.payment));
  return decodeEntity(pick(main, INVOICE), ex, MAPS.invoice, children);
}

/** encode, decode, compare: the rows that give back exactly `text` */
function rowsFor(kind, id, obj, text) {
  let rows = recordToRows(kind, obj);
  const back = JSON.stringify(rowsToRecord(kind, id, rows.main, rows.items, rows.payments));
  if (back === text) return { rows, lossless: true };
  rows = recordToRows(kind, obj, true);           // every field also in `extra`: identical by construction
  const back2 = JSON.stringify(rowsToRecord(kind, id, rows.main, rows.items, rows.payments));
  return { rows, lossless: back2 === text, fallback: true };
}

module.exports = { TABLES, KIND_TAB, RECORD_TABS, SYNC, recordToRows, rowsToRecord, rowsFor, encodeEntity, decodeEntity, isPlain, MAPS };
