/* =====================================================================
   HGI Billing — UI translations (English / हिन्दी / ગુજરાતી)
   Translates app chrome only (menus, labels, buttons, statuses).
   The printed invoice / GST documents always stay in English.
   ===================================================================== */
(function () {
  const T = {
    hi: {
      'Dashboard': 'डैशबोर्ड', 'Home': 'होम', 'New Invoice': 'नया बिल', 'New': 'नया', 'Documents': 'दस्तावेज़', 'Docs': 'बिल', 'GST Returns': 'GST रिटर्न',
      'Items': 'आइटम', 'Buyers': 'ग्राहक', 'Settings': 'सेटिंग्स', 'More': 'और', 'Reports': 'रिपोर्ट',
      'Business Overview': 'व्यापार सारांश', 'Net Sales (FY)': 'कुल बिक्री (वित्त वर्ष)', 'Received (FY)': 'प्राप्त राशि (वित्त वर्ष)',
      'Outstanding (All)': 'बकाया (कुल)', 'Overdue': 'देय तिथि पार', 'Output GST (This Month)': 'आउटपुट GST (इस महीने)',
      'Monthly Billing vs Collection (Current FY)': 'मासिक बिलिंग बनाम वसूली (चालू वर्ष)', 'Smart Alerts': 'स्मार्ट अलर्ट',
      'Recent Documents': 'हाल के दस्तावेज़', 'Top Outstanding Buyers': 'सबसे ज़्यादा बकाया ग्राहक',
      'New Tax Invoice': 'नया टैक्स इनवॉइस', 'Document Type': 'दस्तावेज़ प्रकार', 'Number': 'नंबर', 'Date': 'तारीख', 'Saved Buyer': 'सेव ग्राहक',
      'Supply Type': 'सप्लाई प्रकार', 'Place of Supply': 'सप्लाई का स्थान', 'Tax under Reverse Charge?': 'रिवर्स चार्ज में टैक्स?',
      'Credit Period (Days)': 'उधार अवधि (दिन)', 'Valid For (Days)': 'मान्य (दिन)', 'PO Number': 'PO नंबर', 'PO Date': 'PO तारीख',
      'Transporter': 'ट्रांसपोर्टर', 'Vehicle No.': 'गाड़ी नंबर', 'Delivery Terms': 'डिलीवरी शर्तें',
      'Billed To (Recipient)': 'बिल किसे (ग्राहक)', 'Shipped To (Consignee)': 'माल किसे भेजा', 'Buyer Name': 'ग्राहक का नाम', 'Phone': 'फ़ोन',
      'Billing Address': 'बिलिंग पता', 'Delivery Address': 'डिलीवरी पता', 'State': 'राज्य', 'State Code': 'राज्य कोड', 'PIN': 'पिन',
      'Same as Billing': 'बिलिंग जैसा', 'Consignee Name': 'प्राप्तकर्ता का नाम', 'Consignee GSTIN': 'प्राप्तकर्ता GSTIN', 'Save to Buyer Master': 'ग्राहक सूची में सेव करें',
      'Item / Service Details': 'आइटम / सेवा विवरण', 'Add Item Row': 'आइटम जोड़ें', 'Description of Goods / Services': 'माल / सेवा का विवरण',
      'Qty': 'मात्रा', 'Rate (₹)': 'दर (₹)', 'Amount (₹)': 'राशि (₹)', 'Discount (₹, before tax)': 'छूट (₹, टैक्स से पहले)',
      'Packing & Forwarding (₹)': 'पैकिंग व फॉरवर्डिंग (₹)', 'Freight / Other Charges (₹)': 'भाड़ा / अन्य शुल्क (₹)',
      'Terms & Conditions': 'नियम व शर्तें', 'Save': 'सेव करें', 'Preview & Print': 'देखें व प्रिंट करें', 'Clear Form': 'फॉर्म साफ़ करें',
      '+ Credit Note': '+ क्रेडिट नोट', '+ Debit Note': '+ डेबिट नोट', 'Tax Invoice': 'टैक्स इनवॉइस', 'Credit Note': 'क्रेडिट नोट', 'Debit Note': 'डेबिट नोट',
      'Quotation / Estimate': 'कोटेशन / अनुमान', 'Quotation': 'कोटेशन', 'Quotations': 'कोटेशन', 'Invoices': 'इनवॉइस', 'Credit Notes': 'क्रेडिट नोट', 'Debit Notes': 'डेबिट नोट',
      'Document Register': 'दस्तावेज़ रजिस्टर', 'Sales Register': 'बिक्री रजिस्टर', 'All Types': 'सभी प्रकार', 'All Status': 'सभी स्थिति',
      'Type': 'प्रकार', 'Due': 'देय', 'Party': 'पार्टी', 'Taxable': 'कर योग्य', 'GST': 'GST', 'Total': 'कुल', 'Balance': 'बाकी', 'Status': 'स्थिति', 'Actions': 'कार्य',
      'Paid': 'भुगतान हुआ', 'Unpaid': 'बाकी', 'Partial': 'आंशिक', 'Cancelled': 'रद्द', 'Issued': 'जारी', 'Open': 'खुला', 'Converted': 'बिल बना', 'Expired': 'समाप्त',
      'GST Returns Workbench': 'GST रिटर्न वर्कबेंच', 'Tax Period': 'टैक्स अवधि',
      'Product / Item Master': 'आइटम सूची', 'Add Product': 'आइटम जोड़ें', 'Item Name': 'आइटम का नाम', 'Default Rate': 'डिफ़ॉल्ट दर', 'Stock': 'स्टॉक',
      'Times Billed': 'कितनी बार बिका', 'Check': 'जांच', 'Buyer / Customer Master': 'ग्राहक सूची', 'Add Buyer': 'ग्राहक जोड़ें', 'Credit': 'उधार', 'Outstanding': 'बकाया',
      'Company Settings & GST Profile': 'कंपनी सेटिंग्स व GST प्रोफ़ाइल', 'Save Company Settings': 'कंपनी सेटिंग्स सेव करें',
      'Data Backup & Recovery': 'डेटा बैकअप व रिकवरी', 'Export Backup (JSON)': 'बैकअप डाउनलोड करें', 'Restore Backup': 'बैकअप वापस लाएँ',
      'Print Preview': 'प्रिंट पूर्वावलोकन', 'Print / Save PDF': 'प्रिंट / PDF', 'Record Receipt': 'भुगतान दर्ज करें', 'Receive Full Balance': 'पूरी राशि प्राप्त',
      'Add Receipt': 'भुगतान जोड़ें', 'Cancel': 'रद्द करें', 'Save Item': 'आइटम सेव करें', 'Save Buyer': 'ग्राहक सेव करें', 'Close': 'बंद करें',
      'Share PDF': 'PDF शेयर करें', 'Save PDF': 'PDF सेव करें', 'Print': 'प्रिंट', 'Language': 'भाषा', 'Theme': 'थीम', 'Light': 'लाइट', 'Dark': 'डार्क', 'System': 'सिस्टम',
      'App Lock (PIN)': 'ऐप लॉक (PIN)', 'Lock now': 'अभी लॉक करें', 'Share Backup': 'बैकअप शेयर करें', 'App Preferences': 'ऐप पसंद',
      'Enter PIN': 'PIN डालें', 'Wrong PIN': 'गलत PIN', 'Welcome': 'स्वागत है', 'Next': 'आगे', 'Back': 'पीछे', 'Skip': 'छोड़ें', 'Finish': 'पूरा करें',
      'Your Business': 'आपका व्यापार', 'Bank & UPI': 'बैंक व UPI', 'Security': 'सुरक्षा', 'Business / Trade Name': 'व्यापार का नाम',
      'Restore from a backup': 'बैकअप से वापस लाएँ', 'Get started': 'शुरू करें', 'Stock In': 'स्टॉक आया', 'Convert to Invoice': 'बिल बनाएँ'
    },
    gu: {
      'Dashboard': 'ડેશબોર્ડ', 'Home': 'હોમ', 'New Invoice': 'નવું બિલ', 'New': 'નવું', 'Documents': 'દસ્તાવેજો', 'Docs': 'બિલ', 'GST Returns': 'GST રિટર્ન',
      'Items': 'આઇટમ', 'Buyers': 'ગ્રાહકો', 'Settings': 'સેટિંગ્સ', 'More': 'વધુ', 'Reports': 'રિપોર્ટ',
      'Business Overview': 'વ્યવસાય સારાંશ', 'Net Sales (FY)': 'કુલ વેચાણ (નાણાકીય વર્ષ)', 'Received (FY)': 'મળેલ રકમ (નાણાકીય વર્ષ)',
      'Outstanding (All)': 'બાકી (કુલ)', 'Overdue': 'મુદત વીતી', 'Output GST (This Month)': 'આઉટપુટ GST (આ મહિને)',
      'Monthly Billing vs Collection (Current FY)': 'માસિક બિલિંગ સામે વસૂલાત (ચાલુ વર્ષ)', 'Smart Alerts': 'સ્માર્ટ એલર્ટ',
      'Recent Documents': 'તાજેતરના દસ્તાવેજો', 'Top Outstanding Buyers': 'સૌથી વધુ બાકી ગ્રાહકો',
      'New Tax Invoice': 'નવું ટેક્સ ઇન્વોઇસ', 'Document Type': 'દસ્તાવેજ પ્રકાર', 'Number': 'નંબર', 'Date': 'તારીખ', 'Saved Buyer': 'સેવ ગ્રાહક',
      'Supply Type': 'સપ્લાય પ્રકાર', 'Place of Supply': 'સપ્લાયનું સ્થળ', 'Tax under Reverse Charge?': 'રિવર્સ ચાર્જ હેઠળ ટેક્સ?',
      'Credit Period (Days)': 'ઉધાર મુદત (દિવસ)', 'Valid For (Days)': 'માન્ય (દિવસ)', 'PO Number': 'PO નંબર', 'PO Date': 'PO તારીખ',
      'Transporter': 'ટ્રાન્સપોર્ટર', 'Vehicle No.': 'વાહન નંબર', 'Delivery Terms': 'ડિલિવરી શરતો',
      'Billed To (Recipient)': 'બિલ કોને (ગ્રાહક)', 'Shipped To (Consignee)': 'માલ કોને મોકલ્યો', 'Buyer Name': 'ગ્રાહકનું નામ', 'Phone': 'ફોન',
      'Billing Address': 'બિલિંગ સરનામું', 'Delivery Address': 'ડિલિવરી સરનામું', 'State': 'રાજ્ય', 'State Code': 'રાજ્ય કોડ', 'PIN': 'પિન',
      'Same as Billing': 'બિલિંગ પ્રમાણે', 'Consignee Name': 'મેળવનારનું નામ', 'Consignee GSTIN': 'મેળવનાર GSTIN', 'Save to Buyer Master': 'ગ્રાહક યાદીમાં સેવ કરો',
      'Item / Service Details': 'આઇટમ / સેવા વિગતો', 'Add Item Row': 'આઇટમ ઉમેરો', 'Description of Goods / Services': 'માલ / સેવાનું વર્ણન',
      'Qty': 'જથ્થો', 'Rate (₹)': 'ભાવ (₹)', 'Amount (₹)': 'રકમ (₹)', 'Discount (₹, before tax)': 'ડિસ્કાઉન્ટ (₹, ટેક્સ પહેલાં)',
      'Packing & Forwarding (₹)': 'પેકિંગ અને ફોરવર્ડિંગ (₹)', 'Freight / Other Charges (₹)': 'ભાડું / અન્ય ચાર્જ (₹)',
      'Terms & Conditions': 'નિયમો અને શરતો', 'Save': 'સેવ કરો', 'Preview & Print': 'જુઓ અને પ્રિન્ટ કરો', 'Clear Form': 'ફોર્મ સાફ કરો',
      '+ Credit Note': '+ ક્રેડિટ નોટ', '+ Debit Note': '+ ડેબિટ નોટ', 'Tax Invoice': 'ટેક્સ ઇન્વોઇસ', 'Credit Note': 'ક્રેડિટ નોટ', 'Debit Note': 'ડેબિટ નોટ',
      'Quotation / Estimate': 'કોટેશન / અંદાજ', 'Quotation': 'કોટેશન', 'Quotations': 'કોટેશન', 'Invoices': 'ઇન્વોઇસ', 'Credit Notes': 'ક્રેડિટ નોટ', 'Debit Notes': 'ડેબિટ નોટ',
      'Document Register': 'દસ્તાવેજ રજિસ્ટર', 'Sales Register': 'વેચાણ રજિસ્ટર', 'All Types': 'બધા પ્રકાર', 'All Status': 'બધી સ્થિતિ',
      'Type': 'પ્રકાર', 'Due': 'મુદત', 'Party': 'પાર્ટી', 'Taxable': 'કરપાત્ર', 'GST': 'GST', 'Total': 'કુલ', 'Balance': 'બાકી', 'Status': 'સ્થિતિ', 'Actions': 'ક્રિયાઓ',
      'Paid': 'ચૂકવેલ', 'Unpaid': 'બાકી', 'Partial': 'આંશિક', 'Cancelled': 'રદ', 'Issued': 'જારી', 'Open': 'ખુલ્લું', 'Converted': 'બિલ બન્યું', 'Expired': 'સમાપ્ત',
      'GST Returns Workbench': 'GST રિટર્ન વર્કબેન્ચ', 'Tax Period': 'ટેક્સ સમયગાળો',
      'Product / Item Master': 'આઇટમ યાદી', 'Add Product': 'આઇટમ ઉમેરો', 'Item Name': 'આઇટમનું નામ', 'Default Rate': 'મૂળ ભાવ', 'Stock': 'સ્ટોક',
      'Times Billed': 'કેટલી વાર વેચાયું', 'Check': 'તપાસ', 'Buyer / Customer Master': 'ગ્રાહક યાદી', 'Add Buyer': 'ગ્રાહક ઉમેરો', 'Credit': 'ઉધાર', 'Outstanding': 'બાકી',
      'Company Settings & GST Profile': 'કંપની સેટિંગ્સ અને GST પ્રોફાઇલ', 'Save Company Settings': 'કંપની સેટિંગ્સ સેવ કરો',
      'Data Backup & Recovery': 'ડેટા બેકઅપ અને રિકવરી', 'Export Backup (JSON)': 'બેકઅપ ડાઉનલોડ કરો', 'Restore Backup': 'બેકઅપ પાછું લાવો',
      'Print Preview': 'પ્રિન્ટ પૂર્વાવલોકન', 'Print / Save PDF': 'પ્રિન્ટ / PDF', 'Record Receipt': 'ચુકવણી નોંધો', 'Receive Full Balance': 'પૂરી રકમ મળી',
      'Add Receipt': 'ચુકવણી ઉમેરો', 'Cancel': 'રદ કરો', 'Save Item': 'આઇટમ સેવ કરો', 'Save Buyer': 'ગ્રાહક સેવ કરો', 'Close': 'બંધ કરો',
      'Share PDF': 'PDF શેર કરો', 'Save PDF': 'PDF સેવ કરો', 'Print': 'પ્રિન્ટ', 'Language': 'ભાષા', 'Theme': 'થીમ', 'Light': 'લાઇટ', 'Dark': 'ડાર્ક', 'System': 'સિસ્ટમ',
      'App Lock (PIN)': 'એપ લોક (PIN)', 'Lock now': 'હમણાં લોક કરો', 'Share Backup': 'બેકઅપ શેર કરો', 'App Preferences': 'એપ પસંદગી',
      'Enter PIN': 'PIN દાખલ કરો', 'Wrong PIN': 'ખોટો PIN', 'Welcome': 'સ્વાગત છે', 'Next': 'આગળ', 'Back': 'પાછળ', 'Skip': 'છોડો', 'Finish': 'પૂર્ણ કરો',
      'Your Business': 'તમારો વ્યવસાય', 'Bank & UPI': 'બેંક અને UPI', 'Security': 'સુરક્ષા', 'Business / Trade Name': 'વ્યવસાયનું નામ',
      'Restore from a backup': 'બેકઅપમાંથી પાછું લાવો', 'Get started': 'શરૂ કરો', 'Stock In': 'સ્ટોક આવ્યો', 'Convert to Invoice': 'બિલ બનાવો'
    }
  };
  const LANGS = { en: 'English', hi: 'हिन्दी', gu: 'ગુજરાતી' };
  const ORIG = '__i18nOrig';
  let lang = 'en';
  // never translate the invoice paper, user-typed values or code-like text
  const SKIP = el => !!(el.closest && el.closest('#invoice-preview-container, script, style, textarea, pre, .no-i18n'));

  function translateText(node) {
    const raw = node[ORIG] !== undefined ? node[ORIG] : node.nodeValue;
    const key = raw.trim();
    if (!key || key.length > 80) return;
    const dict = T[lang];
    const tr = dict && dict[key];
    if (node[ORIG] === undefined && !tr) return;
    if (node[ORIG] === undefined) node[ORIG] = raw;
    node.nodeValue = tr ? raw.replace(key, tr) : node[ORIG];
  }
  function translateAttr(el, attr) {
    const k = `${ORIG}_${attr}`;
    const raw = el[k] !== undefined ? el[k] : el.getAttribute(attr);
    if (!raw) return;
    const tr = T[lang] && T[lang][raw.trim()];
    if (el[k] === undefined && !tr) return;
    if (el[k] === undefined) el[k] = raw;
    el.setAttribute(attr, tr || el[k]);
  }
  function translateTree(root) {
    if (!root || (root.nodeType === 1 && SKIP(root))) return;
    if (root.nodeType === 3) { if (root.parentElement && !SKIP(root.parentElement)) translateText(root); return; }
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement && SKIP(n.parentElement) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let n; while ((n = w.nextNode())) translateText(n);
    if (root.querySelectorAll) root.querySelectorAll('[placeholder],[title]').forEach(el => { if (!SKIP(el)) { translateAttr(el, 'placeholder'); translateAttr(el, 'title'); } });
  }
  let observer = null;
  function setLang(l) {
    lang = LANGS[l] ? l : 'en';
    document.documentElement.lang = lang === 'en' ? 'en' : lang;
    translateTree(document.body);
    if (!observer) {
      observer = new MutationObserver(muts => {
        if (lang === 'en' && !muts.some(m => m.target[ORIG] !== undefined)) return;
        muts.forEach(m => m.type === 'characterData' ? null : m.addedNodes.forEach(translateTree));
      });
      observer.observe(document.body, { childList: true, subtree: true });
    }
  }
  const t = s => (T[lang] && T[lang][s]) || s;
  window.HGI_I18N = { setLang, t, LANGS, get lang() { return lang; }, translateTree };
})();
