/* HGI Billing — GST rule book (versioned, dated, sourced).
 *
 * Every legal value the app relies on lives here, with the date it took effect and where it comes from, so a change
 * in the law is a data change in ONE file (reviewed, tested) — not a hunt through the screens. The same file is loaded
 * by the app (www/gst-rules.js) and by Node tests / the server (require).
 *
 * Rules are looked up by the DOCUMENT date (a credit note against an old invoice uses the ORIGINAL invoice's date for
 * rates). Nothing here guesses a fact: where the law turns on a fact the app cannot know (who receives the goods, the
 * taxability of a 0 % line …) the functions return `need` and the app must ask the user.
 *
 * Reviewed: 04-Nov-2026 against the sources listed in SOURCES. Not legal advice — items marked `review` need a
 * qualified GST practitioner's confirmation before production use.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.HGI_GST = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const VERSION = '2026.11.04';

  const SOURCES = {
    R46: { title: 'CGST Rules, 2017 — Rule 46 (tax invoice particulars)', url: 'https://taxinformation.cbic.gov.in/content/html/tax_repository/gst/rules/cgst_rules/active/chapter6/rule46_v1.00.html' },
    R49: { title: 'CGST Rules, 2017 — Rule 49 (bill of supply)', url: 'https://cbic-gst.gov.in/gst-invoice-rules.html' },
    R5: { title: 'CGST Rules, 2017 — Rule 5 (conditions for composition levy)', url: 'https://gstzen.in/a/conditions-and-restrictions-for-composition-levy-cgst-rule-5.html' },
    IGST10: { title: 'IGST Act, 2017 — Section 10 (place of supply of goods)', url: 'https://taxheal.com/bill-to-ship-to-gst.html' },
    IGST12: { title: 'IGST Act, 2017 — Section 12 (place of supply of services, both parties in India)', url: 'https://cbic-gst.gov.in/' },
    N78_2020: { title: 'Notification 78/2020-Central Tax (HSN digits by turnover), from 01-04-2021', url: 'https://cbic-gst.gov.in/' },
    N12_2024: { title: 'Notification 12/2024-Central Tax / GSTN advisory: B2C (Large) threshold ₹2.5 lakh → ₹1 lakh, from 01-08-2024', url: 'https://taxguru.in/goods-and-service-tax/advisory-reporting-supplies-un-registered-dealers-gstr1-gstr-5.html' },
    N9_2025R: { title: 'Notification 9/2025-Central Tax (Rate) — GST 2.0 slabs 5 % / 18 % / 40 %, from 22-09-2025', url: 'https://www.businesstoday.in/latest/economy/story/gst-rate-cuts-notified-by-centre-effective-sept-22-companies-prepare-for-simplified-structure-494452-2025-09-17' },
    EINV30: { title: 'GSTN advisory (05-11-2024): e-invoice to be reported within 30 days, AATO ≥ ₹10 crore, from 01-04-2025', url: 'https://www.taxmann.com/post/blog/time-limit-of-30-days-for-reporting-e-invoice-on-irp-portal-for-taxpayers-with-aato-of-10-crores-and-above-gstn-update/' },
    N10_2023: { title: 'Notification 10/2023-Central Tax: e-invoicing above ₹5 crore AATO (any FY from 2017-18), from 01-08-2023', url: 'https://cbic-gst.gov.in/' },
    EWB180: { title: 'GSTN advisory (18-12-2024): e-way bill only for documents ≤ 180 days old; extension ≤ 360 days, from 01-01-2025', url: 'https://cleartax.in/s/time-limit-for-e-way-bill-generation' },
    R138: { title: 'CGST Rules, 2017 — Rule 138 (e-way bill, ₹50,000 consignment value; validity 200 km/day from 01-01-2021)', url: 'https://cbic-gst.gov.in/' },
    S34: { title: 'CGST Act, 2017 — Section 34(2) (credit note by 30 November after the FY end; Finance Act 2022)', url: 'https://www.gstgyaan.com/section-34-of-the-cgst-act-credit-and-debit-notes' },
    UTGST: { title: 'UTGST Act, 2017 — UTGST in Union territories without legislature (Chandigarh, DNH & DD, Lakshadweep, A&N, Ladakh, Other Territory)', url: 'https://cleartax.in/s/utgst' },
    S10C: { title: 'CGST Act, 2017 — Section 10(2)(d), 10(4) (composition: no inter-State outward supply of goods, no tax collected)', url: 'https://gstzen.in/a/conditions-and-restrictions-for-composition-levy-cgst-rule-5.html' },
    S15: { title: 'CGST Act, 2017 — Section 15 (value of supply: incidental charges added, invoice discounts deducted)', url: 'https://cbic-gst.gov.in/' },
    GSTR1: { title: 'GSTR-1 form tables 4–13 (GSTN offline tool / portal)', url: 'https://tutorial.gst.gov.in/' }
  };

  // A dated rule: the entry with the latest `from` that is ≤ the date applies.
  const DATED = {
    b2clLimit: [{ from: '2017-07-01', value: 250000, src: 'R46' }, { from: '2024-08-01', value: 100000, src: 'N12_2024' }],
    b2cAddressLimit: [{ from: '2017-07-01', value: 50000, src: 'R46' }],
    ewbThreshold: [{ from: '2018-04-01', value: 50000, src: 'R138' }],
    ewbMaxDocAgeDays: [{ from: '2018-04-01', value: null, src: 'R138' }, { from: '2025-01-01', value: 180, src: 'EWB180' }],
    einvoiceAatoCr: [{ from: '2020-10-01', value: 500 }, { from: '2021-01-01', value: 100 }, { from: '2021-04-01', value: 50 }, { from: '2022-04-01', value: 20 },
      { from: '2022-10-01', value: 10 }, { from: '2023-08-01', value: 5, src: 'N10_2023' }],
    einv30DayAatoCr: [{ from: '2023-05-01', value: 100 }, { from: '2025-04-01', value: 10, src: 'EINV30' }],
    // rates a document may carry on its date (special rates 0.1 / 0.25 / 1.5 / 3 kept throughout)
    rates: [{ from: '2017-07-01', value: [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28] },
      { from: '2025-09-22', value: [0, 0.1, 0.25, 1, 1.5, 3, 5, 18, 40], src: 'N9_2025R' }]
  };
  const GST2_DATE = '2025-09-22';

  // UTs without a legislature: an intra-UT supply carries CGST + UTGST (Delhi, Puducherry and J&K have legislatures → SGST)
  const UT_WITHOUT_LEGISLATURE = ['04', '26', '31', '35', '38', '97'];

  // HSN headings that may attract compensation cess (or its successor levies) — the app has NO cess engine, so such
  // supplies are refused rather than under-taxed. Chapter 24 (tobacco), 2106 90 20 (pan masala). review: list must be
  // re-checked whenever the cess schedule changes.
  const CESS_HSN_PREFIXES = ['2401', '2402', '2403', '2404', '21069020'];
  // before GST 2.0 cess also applied to these (aerated waters, coal, motor vehicles …): flagged on older documents
  const CESS_HSN_PREFIXES_PRE_GST2 = ['2202', '2701', '2702', '2703', '2704', '8702', '8703', '8711', '8802', '8903'];

  const TEXT = {
    composition: 'composition taxable person, not eligible to collect tax on supplies',
    billToShipTo: (ship, pos) => `Bill-to / ship-to supply: goods delivered at ${ship} to a third person on the direction of the recipient; place of supply is the recipient's principal place of business, ${pos} (Section 10(1)(b), IGST Act, 2017).`,
    rcm: 'Tax on this supply is payable by the recipient under reverse charge (Section 9(3) / 9(4) of the CGST Act, 2017).'
  };

  function at(name, iso) {
    const list = DATED[name];
    if (!list) throw new Error('unknown GST rule ' + name);
    const d = String(iso || '').slice(0, 10) || '9999-12-31';
    let hit = list[0];
    for (const r of list) if (r.from <= d) hit = r;
    return hit.value;
  }
  function sourceOf(name, iso) {
    const list = DATED[name], d = String(iso || '').slice(0, 10) || '9999-12-31';
    let hit = list[0]; for (const r of list) if (r.from <= d) hit = r;
    return hit.src ? SOURCES[hit.src] : null;
  }
  const norm = c => { c = String(c || '').trim(); return /^\d$/.test(c) ? '0' + c : c; };

  /** label of the second half of intra-state tax: UTGST inside a UT without legislature, else SGST */
  function stateTaxLabel(supplierSC, pos) {
    const s = norm(supplierSC), p = norm(pos);
    return s && s === p && UT_WITHOUT_LEGISLATURE.includes(s) ? 'UTGST' : 'SGST';
  }

  /** valid rate on a date; `legacyOk` for a note against an invoice dated before GST 2.0 */
  function rateValid(rate, iso) { return at('rates', iso).includes(Number(rate)); }

  /** 'yes' — HSN is a cess heading; 'maybe' — a shorter HSN that covers a cess heading; '' — no cess heading */
  function cessRisk(hsn, iso) {
    const h = String(hsn || '').replace(/\D/g, '');
    if (!h) return '';
    const list = String(iso || '') < GST2_DATE ? CESS_HSN_PREFIXES.concat(CESS_HSN_PREFIXES_PRE_GST2) : CESS_HSN_PREFIXES;
    if (list.some(p => h.startsWith(p))) return 'yes';
    if (list.some(p => p.length > h.length && p.startsWith(h) && h.length >= 4)) return 'maybe';
    return '';
  }

  /**
   * Place of supply of GOODS supplied within India (IGST Act s.10(1)(a)/(b)).
   *  shipMode: 'buyer'  — goods delivered to the recipient itself (its own premises / site): POS = where movement ends
   *            'third'  — goods delivered to a third person on the recipient's direction (bill-to / ship-to): POS = recipient's state
   *  The two rules give the same answer when the delivery state is the buyer's state, so the fact is only needed when they differ.
   *  Returns { pos, rule, need?, why }.
   */
  function posForGoods({ supplierSC, buyerSC, shipSC, shipMode }) {
    const b = norm(buyerSC), s = norm(shipSC), sup = norm(supplierSC);
    if (!s && !b) return { pos: sup, rule: '10(1)(a)', why: 'No buyer or delivery state — taken as your own state (over-the-counter supply).', assumed: true };
    if (!s || s === b) return { pos: b || s, rule: '10(1)(a)', why: 'Goods delivered in the buyer\'s state.' };
    if (!b) {
      if (shipMode === 'third') return { pos: '', rule: '10(1)(b)', need: 'buyerState', why: 'Bill-to / ship-to needs the buyer\'s (billing) state.' };
      return { pos: s, rule: '10(1)(a)', why: 'Goods delivered where the movement ends.' };
    }
    if (shipMode === 'buyer') return { pos: s, rule: '10(1)(a)', why: 'Goods delivered to the buyer itself — movement ends in the delivery state.' };
    if (shipMode === 'third') return { pos: b, rule: '10(1)(b)', why: 'Goods delivered to a third person on the buyer\'s direction — buyer\'s state.' };
    return { pos: '', rule: '', need: 'shipMode', why: 'Delivery state differs from the buyer\'s state: say who receives the goods.' };
  }

  /** intra/inter decision (IGST Act s.7/8); exports and SEZ are always inter-State */
  function isInterState({ supplierSC, pos, supplyType }) {
    if (['SEZWP', 'SEZWOP', 'EXPWP', 'EXPWOP'].includes(supplyType)) return true;
    const p = norm(pos);
    return p !== '' && p !== norm(supplierSC);
  }

  /** HSN digits required (Notification 78/2020-CT, from 01-04-2021). B2C under ₹5 cr: optional (0). */
  function hsnDigitsRequired(prevFyAato, registeredRecipient) {
    if (prevFyAato === 'upto5') return registeredRecipient ? 4 : 0;
    return 6;
  }

  /** e-invoicing applicability from the turnover band on a date: true / false / null (band too coarse for that date's threshold) */
  function einvoiceApplies(aatoBand, iso) {
    const cr = at('einvoiceAatoCr', iso);              // must EXCEED this AATO (₹ crore) in any FY from 2017-18
    if (aatoBand === 'upto5') return cr >= 5 ? false : null;
    if (aatoBand === '5to10') return cr <= 5 ? true : cr >= 10 ? false : null;
    if (aatoBand === 'above10') return cr <= 5 ? true : null;
    return null;
  }

  function creditNoteDeadline(invoiceIso) {
    const d = String(invoiceIso || ''); if (!d) return '';
    const y = Number(d.slice(0, 4)), m = Number(d.slice(5, 7));
    const fyEnd = m >= 4 ? y + 1 : y;
    return `${fyEnd}-11-30`;
  }

  return { VERSION, SOURCES, DATED, GST2_DATE, UT_WITHOUT_LEGISLATURE, CESS_HSN_PREFIXES, CESS_HSN_PREFIXES_PRE_GST2, TEXT,
    at, sourceOf, stateTaxLabel, rateValid, cessRisk, posForGoods, isInterState, hsnDigitsRequired, einvoiceApplies, creditNoteDeadline };
}));
