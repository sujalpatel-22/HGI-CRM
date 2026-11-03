// Browser-side generator of a realistic business book (runs inside the app page: uses the app's own computeDoc / totalsOf).
// window.__bigBook({buyers, products, invoices, seed}) → replaces state.* (in-memory) with generated data.
// Deterministic (seeded), so benchmarks and screenshots are repeatable.
window.__bigBook = function ({ buyers = 120, products = 160, invoices = 600, seed = 7 } = {}) {
  let s = seed;
  const rnd = () => (s = (s * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const CH = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const gst = b => { for (const c of CH) { const g = b + c; let sum = 0; for (let i = 0; i < 14; i++) { const p = CH.indexOf(g[i]) * (i % 2 ? 2 : 1); sum += Math.floor(p / 36) + (p % 36); } if (CH[(36 - (sum % 36)) % 36] === g[14]) return g; } };
  const states = [['24', 'Gujarat', 'Ahmedabad', '380015'], ['24', 'Gujarat', 'Surat', '395003'], ['27', 'Maharashtra', 'Pune', '411026'], ['27', 'Maharashtra', 'Mumbai', '400072'],
    ['08', 'Rajasthan', 'Jaipur', '302012'], ['29', 'Karnataka', 'Bengaluru', '560058'], ['33', 'Tamil Nadu', 'Chennai', '600032'], ['07', 'Delhi', 'New Delhi', '110020']];
  const first = ['Shree', 'Om', 'Jay', 'Maruti', 'Krishna', 'Sai', 'Ambica', 'Balaji', 'Ganesh', 'Laxmi', 'Patel', 'Mehta', 'Shah', 'Desai', 'Rathod', 'Kirloskar', 'Bharat', 'National', 'Prime', 'Royal'];
  const kind = ['Engineering', 'Pumps', 'Agro', 'Industries', 'Traders', 'Hardware', 'Irrigation', 'Enterprises', 'Steel', 'Polymers'];
  const pan = i => 'AA' + String.fromCharCode(65 + i % 26) + 'P' + String.fromCharCode(65 + (i * 7) % 26) + String(1000 + i).slice(-4) + String.fromCharCode(65 + (i * 3) % 26);
  const co = state.company;
  Object.assign(co, { name: co.name || 'HARI GURU INDUSTRIES', legalName: co.legalName || 'HARI GURU INDUSTRIES', gstin: co.gstin || '24AAACH7409R1Z7', state: 'Gujarat', stateCode: '24', pin: co.pin || '382330',
    address: co.address || 'Plot 123, Phase 3, GIDC Naroda\nAhmedabad', phone: co.phone || '9876500000', email: co.email || 'accounts@hariguru.example', bankName: co.bankName || 'Punjab National Bank',
    bankAcc: co.bankAcc || '21380021000086', bankIfsc: co.bankIfsc || 'PUNB0213800', aato: co.aato || '5to10' });
  state.customers = [];
  for (let i = 0; i < buyers; i++) {
    const st = pick(states), name = `${pick(first)} ${pick(kind)}${i > 40 ? ' ' + (i + 1) : ''}`;
    const reg = rnd() > 0.15;
    state.customers.push({ id: 'C' + i, name, gstin: reg ? gst(st[0] + pan(i) + '1Z') : '', phone: '98' + String(10000000 + i * 7919).slice(-8), address: `Plot ${i + 1}, GIDC Estate\n${st[2]}`,
      state: st[1], stateCode: st[0], pin: st[3], city: st[2], partyType: i % 17 === 0 ? 'supplier' : undefined });
  }
  state.products = [];
  const groups = [['DWC Pipe', '3917', 'MTR', 18, ['40mm', '63mm', '90mm', '110mm', '160mm']], ['Monoblock Pump', '8413', 'NOS', 18, ['0.5HP', '1HP', '1.5HP', '2HP', '3HP']], ['MS Flange', '7307', 'NOS', 18, ['1 Inch', '2 Inch', '3 Inch', '4 Inch']],
    ['PVC Elbow', '3917', 'PCS', 18, ['20mm', '25mm', '32mm', '40mm']], ['Submersible Cable', '8544', 'MTR', 18, ['1.5 sqmm', '2.5 sqmm', '4 sqmm']], ['Drip Lateral', '3917', 'ROL', 12, ['12mm', '16mm', '20mm']],
    ['Gate Valve', '8481', 'NOS', 18, ['15mm', '25mm', '50mm', '80mm']], ['Fertiliser Tank', '3925', 'NOS', 18, ['60L', '90L', '120L']], ['Installation Service', '9987', 'OTH', 18, ['Standard']]];
  let n = 0;
  while (state.products.length < products) {
    const g = groups[n % groups.length], size = g[4][Math.floor(n / groups.length) % g[4].length], round = Math.floor(n / (groups.length * 5));
    state.products.push({ id: 'P' + n, name: `${g[0]} ${size}${round ? ' Type ' + round : ''}`, hsn: g[1] + (g[1].length === 4 ? '10' : ''), unit: g[2], rate: Math.round((200 + rnd() * 9000) / 5) * 5, gst: g[3],
      trackStock: g[1] !== '9987', openingStock: g[1] !== '9987' ? Math.round(rnd() * 400) : 0, minStock: 10, stockIns: [] });
    n++;
  }
  state.invoices = [];
  const today = todayISO(), startFy = fyStartISO(today);
  const seqByFy = {};
  for (let i = 0; i < invoices; i++) {
    const daysBack = Math.floor(rnd() * 420);
    const date = addDays(today, -daysBack);
    const fy = fyOf(date); seqByFy[fy] = (seqByFy[fy] || 0) + 1;
    const b = state.customers[Math.floor(rnd() * state.customers.length)];
    const lines = 1 + Math.floor(rnd() * 5), items = [];
    for (let k = 0; k < lines; k++) { const p = state.products[Math.floor(rnd() * state.products.length)]; items.push({ desc: p.name, hsn: p.hsn, gst: p.gst, qty: 1 + Math.floor(rnd() * 20), unit: p.unit, rate: p.rate }); }
    const d = { id: 'D' + i, docType: 'INV', num: `${String(seqByFy[fy]).padStart(2, '0')}/${fy}`, date, supplyType: b.gstin ? 'B2B' : 'B2C', pos: b.stateCode, reverseCharge: false,
      buyerName: b.name, buyerGstin: b.gstin, buyerPhone: b.phone, buyerAddress: b.address, buyerState: b.state, buyerStateCode: b.stateCode, buyerPin: b.pin,
      shipName: '', shipGstin: '', shipAddress: '', shipState: '', shipStateCode: '', shipPin: '', items, discount: 0, pfCharges: rnd() > 0.8 ? 500 : 0, otherCharges: 0,
      creditDays: 30, terms: '', payments: [], cancelled: rnd() > 0.985, createdAt: date + 'T10:00:00.000Z', updatedAt: date + 'T10:00:00.000Z', issues: 0 };
    const c = computeDoc(d); Object.assign(d, totalsOf(c));
    const r = rnd();
    if (r > 0.45) d.payments.push({ id: 'Y' + i, date: addDays(date, Math.floor(rnd() * 40)), amount: d.grandTotal, tds: 0, mode: 'NEFT', ref: 'UTR' + i });
    else if (r > 0.3) d.payments.push({ id: 'Y' + i, date: addDays(date, 10), amount: Math.round(d.grandTotal / 2), tds: 0, mode: 'UPI', ref: '' });
    state.invoices.push(d);
  }
  void startFy;
  sortInvoices();
  return { buyers: state.customers.length, products: state.products.length, invoices: state.invoices.length };
};
