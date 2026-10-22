/* =====================================================================
   HGI Billing — Demo Mode sample data.
   Used ONLY when the user explicitly turns on Demo Mode. It is stored under its
   own key ('hgi_billing_demo' + native mirror 'state-demo'), never mixed with
   real business data, and every printed page carries a "DEMO — NOT A VALID
   TAX INVOICE" watermark. Names, GSTINs and bank details are fictitious.
   ===================================================================== */
(function () {
  'use strict';

  function build() {
    const s = defaultState();
    s.company = Object.assign(JSON.parse(JSON.stringify(DEFAULT_COMPANY)), {
      name: 'Demo Traders (Sample)', legalName: 'Demo Traders (Sample)',
      address: 'Sample Address, Sample Road,\nAhmedabad, Gujarat', gstin: '24AAPFU0939F1Z1', pan: 'AAPFU0939F',
      state: 'Gujarat', stateCode: '24', pin: '380001', phone: '', email: '',
      bankName: 'SAMPLE BANK (DEMO)', bankAcc: 'XXXXXXXX0000', bankIfsc: 'SMPL0000000', bankBranch: 'Demo branch',
      upiId: '',               // deliberately empty: a QR in demo data must never pay a real account
      tagline: 'Demo data — not a real business'
    });
    s.ui = Object.assign({}, s.ui, { onboarded: true, demo: true });

    const today = todayISO(), fyStart = fyStartISO(today), fy = fyOf(today);
    const back = n => { const d = addDays(today, -n); return d < fyStart ? fyStart : d; };

    s.products = [
      { id: 'DEMO-P1', name: 'Steel Bracket (Sample)', hsn: '7326', unit: 'NOS', rate: 450, gst: 18, trackStock: true, openingStock: 200, minStock: 20, stockIns: [] },
      { id: 'DEMO-P2', name: 'Industrial Fastener Kit (Sample)', hsn: '7318', unit: 'SET', rate: 1200, gst: 18, trackStock: true, openingStock: 40, minStock: 10, stockIns: [] },
      { id: 'DEMO-P3', name: 'Packing Carton (Sample)', hsn: '4819', unit: 'PCS', rate: 35, gst: 5, trackStock: true, openingStock: 500, minStock: 50, stockIns: [] },
      { id: 'DEMO-P4', name: 'Installation Service (Sample)', hsn: '9987', unit: 'OTH', rate: 2500, gst: 18 }
    ];
    s.customers = [
      { id: 'DEMO-C1', name: 'Sample Buyer Pvt Ltd (Demo)', gstin: '27AAPFU0939F1ZV', phone: '', address: 'Demo Industrial Area, Pune', shipAddress: 'Demo Industrial Area, Pune', state: 'Maharashtra', stateCode: '27', pin: '411001', shipPin: '411001', creditDays: 30 },
      { id: 'DEMO-C2', name: 'Example Enterprises (Demo)', gstin: '24ABCDE1234F1Z6', phone: '', address: 'Example Market, Surat', shipAddress: 'Example Market, Surat', state: 'Gujarat', stateCode: '24', pin: '395003', shipPin: '395003', creditDays: 15 },
      { id: 'DEMO-C3', name: 'Walk-in Customer (Demo)', gstin: '', phone: '', address: 'Ahmedabad', shipAddress: 'Ahmedabad', state: 'Gujarat', stateCode: '24', pin: '', shipPin: '', creditDays: 0 }
    ];

    const item = (p, qty) => ({ desc: p.name, hsn: p.hsn, gst: p.gst, qty, unit: p.unit, rate: p.rate });
    const P = s.products, C = s.customers;
    let n = { INV: 0, QUO: 0, CRN: 0 };
    const mk = (docType, cust, daysAgo, items, extra) => {
      n[docType]++;
      const date = back(daysAgo);
      const d = Object.assign({
        id: 'DEMO-D' + docType + n[docType], docType, num: `${s.company.prefixes[docType] || ''}${String(n[docType]).padStart(2, '0')}/${fy}`, date,
        supplyType: cust.gstin ? 'B2B' : 'B2C', pos: cust.stateCode, reverseCharge: false, refId: '', refNum: '', refDate: '', noteReason: '',
        creditDays: cust.creditDays, poNum: '', poDate: '', transport: '', lr: '', deliveryTerms: '', ewbNo: '', ewbDate: '', irn: '', ackNo: '', ackDate: '', signedQr: '',
        buyerName: cust.name, buyerGstin: cust.gstin, buyerPhone: '', buyerAddress: cust.address, buyerState: cust.state, buyerStateCode: cust.stateCode, buyerPin: cust.pin,
        shipName: '', shipGstin: '', shipPhone: '', shipAddress: cust.shipAddress, shipState: cust.state, shipStateCode: cust.stateCode, shipPin: cust.shipPin,
        discount: 0, pfCharges: 0, otherCharges: 0, terms: s.company.terms, items,
        payments: [], cancelled: false, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), issues: 0, demo: true
      }, extra || {});
      Object.assign(d, totalsOf(computeDoc(d, s.company)));
      return d;
    };
    const i1 = mk('INV', C[0], 40, [item(P[0], 50), item(P[1], 10)]);
    i1.payments = [{ id: 'DEMO-PAY1', date: back(30), amount: i1.grandTotal, tds: 0, mode: 'NEFT/RTGS', ref: 'DEMO' }];
    const i2 = mk('INV', C[1], 20, [item(P[2], 300), item(P[3], 1)]);
    i2.payments = [{ id: 'DEMO-PAY2', date: back(10), amount: Math.round(i2.grandTotal / 2), tds: 0, mode: 'UPI', ref: 'DEMO' }];
    const i3 = mk('INV', C[2], 5, [item(P[0], 4)]);
    const i4 = mk('INV', C[0], 1, [item(P[1], 6), item(P[3], 2)]);
    const q1 = mk('QUO', C[1], 3, [item(P[0], 100), item(P[2], 500)], { creditDays: 15 });
    s.invoices = [i1, i2, i3, i4, q1];
    return s;
  }

  window.HGI_DEMO_DATA = { build };
})();
