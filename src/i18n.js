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
      'Restore from a backup': 'बैकअप से वापस लाएँ', 'Get started': 'शुरू करें', 'Stock In': 'स्टॉक आया', 'Convert to Invoice': 'बिल बनाएँ',
      'To collect': 'वसूली बाकी', 'Due': 'देय', 'Billed by month': 'महीनेवार बिलिंग', 'this FY': 'इस वित्त वर्ष', 'Sales this month': 'इस महीने की बिक्री',
      'Output GST this month': 'इस महीने का आउटपुट GST', 'for GSTR-3B': 'GSTR-3B के लिए', 'invoice': 'बिल', 'invoices': 'बिल', 'pending': 'बाकी', 'overdue': 'देय तिथि पार',
      'Nothing pending — all invoices are paid': 'कुछ बाकी नहीं — सभी बिलों का भुगतान हो गया', 'New invoice': 'नया बिल', 'Document': 'दस्तावेज़',
      'Original invoice': 'मूल बिल', 'Tax settings': 'टैक्स सेटिंग', 'Order & transport': 'ऑर्डर व ट्रांसपोर्ट', 'Customer': 'ग्राहक', 'Discount & charges': 'छूट व शुल्क',
      'Terms': 'शर्तें', 'Summary': 'सारांश', 'Total': 'कुल',
      'Use': 'इस्तेमाल करें', 'Enter your business name': 'अपने व्यापार का नाम लिखें', 'PIN code must be 6 digits': 'पिन कोड 6 अंकों का होना चाहिए',
      'GSTIN looks invalid — fix it or leave it blank': 'GSTIN गलत लग रहा है — ठीक करें या खाली छोड़ें',
      'Billing and collection': 'बिलिंग और वसूली', 'Needs attention': 'ध्यान दें', 'Recent documents': 'हाल के दस्तावेज़', 'See all': 'सभी देखें',
      'Who owes you': 'किससे लेना बाकी है', 'Billed': 'बिल किया', 'Overdue by age': 'कितने दिन से बाकी', 'billed this FY': 'इस वित्त वर्ष बिल किया',
      '1–30 days': '1–30 दिन', '31–60 days': '31–60 दिन', '61–90 days': '61–90 दिन', '90+ days': '90+ दिन', 'Invoice': 'बिल', 'Credit note': 'क्रेडिट नोट', 'Debit note': 'डेबिट नोट',
      'Unpaid': 'बाकी', 'Filters': 'फ़िल्टर', 'Credit notes': 'क्रेडिट नोट', 'Debit notes': 'डेबिट नोट', 'All': 'सभी',
      'Business details': 'व्यापार विवरण',
      'Fix before filing': 'फ़ाइल करने से पहले ठीक करें', 'Nothing to report this month': 'इस महीने कुछ रिपोर्ट नहीं करना', 'Download CSV': 'CSV डाउनलोड करें',
      'Demo Mode': 'डेमो मोड', 'Exit demo': 'डेमो बंद करें', 'Exit Demo Mode': 'डेमो मोड बंद करें', 'Try with sample data': 'नमूना डेटा से आज़माएँ',
      'Workspace': 'कार्यक्षेत्र', 'Records': 'रिकॉर्ड', 'Sign out': 'साइन आउट', 'GST billing': 'GST बिलिंग', 'Add buyer': 'ग्राहक जोड़ें', 'Cash flow': 'नकद प्रवाह', 'Received': 'प्राप्त', 'Collection': 'वसूली', 'collected': 'वसूल', 'Billed this FY': 'इस वर्ष बिल', 'Avg. days to get paid': 'भुगतान में औसत दिन', 'day': 'दिन', 'days': 'दिन', 'Received this month': 'इस महीने प्राप्त', 'Open quotations': 'खुले कोटेशन', 'awaiting reply': 'जवाब बाकी', 'awaiting replies': 'जवाब बाकी', 'incl. TDS': 'TDS सहित', 'Good morning.': 'सुप्रभात।', 'Good afternoon.': 'नमस्कार।', 'Good evening.': 'शुभ संध्या।', 'Here is where your money stands.': 'आपके पैसों की पूरी स्थिति यहाँ है।', 'Live preview': 'लाइव झलक', 'Full preview': 'पूरा देखें', 'Charges': 'शुल्क', 'Tax': 'टैक्स', 'Transport': 'परिवहन', 'Modern': 'मॉडर्न', 'Classic': 'क्लासिक', 'document': 'दस्तावेज़', 'documents': 'दस्तावेज़', 'billed': 'बिल', 'received': 'प्राप्त', 'Every invoice, quotation and note you have issued.': 'आपके जारी किए गए सभी बिल, कोटेशन और नोट।', 'Products and services with HSN, GST rate and stock.': 'HSN, GST दर और स्टॉक के साथ माल और सेवाएँ।', 'Your buyers, their GSTINs and what they owe.': 'आपके ग्राहक, उनके GSTIN और बकाया।', 'Business profile, GST rules, branding and backups.': 'व्यापार प्रोफ़ाइल, GST नियम, ब्रांडिंग और बैकअप।',
      'DEMO MODE': 'डेमो मोड', '— sample data, not real invoices': '— नमूना डेटा, असली बिल नहीं',
      'Just looking? Explore with sample data (Demo Mode)': 'सिर्फ़ देख रहे हैं? नमूना डेटा से आज़माएँ (डेमो मोड)',
      'Open Demo Mode?': 'डेमो मोड खोलें?', 'Leave Demo Mode?': 'डेमो मोड बंद करें?',
      'Demo Mode shows sample customers and invoices so you can try the app. Your own data is kept separately and is not changed. Demo documents are watermarked "NOT A VALID TAX INVOICE".': 'डेमो मोड में नमूना ग्राहक और बिल दिखते हैं ताकि आप ऐप आज़मा सकें। आपका अपना डेटा अलग सुरक्षित रहता है और बदला नहीं जाता। डेमो बिलों पर "NOT A VALID TAX INVOICE" वॉटरमार्क रहता है।',
      'The sample data will be deleted and your own data will open.': 'नमूना डेटा हटा दिया जाएगा और आपका अपना डेटा खुलेगा।'
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
      'Restore from a backup': 'બેકઅપમાંથી પાછું લાવો', 'Get started': 'શરૂ કરો', 'Stock In': 'સ્ટોક આવ્યો', 'Convert to Invoice': 'બિલ બનાવો',
      'To collect': 'વસૂલવાનું બાકી', 'Due': 'બાકી', 'Billed by month': 'મહિના મુજબ બિલિંગ', 'this FY': 'આ નાણાકીય વર્ષ', 'Sales this month': 'આ મહિનાનું વેચાણ',
      'Output GST this month': 'આ મહિનાનો આઉટપુટ GST', 'for GSTR-3B': 'GSTR-3B માટે', 'invoice': 'બિલ', 'invoices': 'બિલ', 'pending': 'બાકી', 'overdue': 'મુદત વીતી',
      'Nothing pending — all invoices are paid': 'કંઈ બાકી નથી — બધા બિલ ચૂકવાઈ ગયા', 'New invoice': 'નવું બિલ', 'Document': 'દસ્તાવેજ',
      'Original invoice': 'મૂળ બિલ', 'Tax settings': 'ટેક્સ સેટિંગ', 'Order & transport': 'ઓર્ડર અને ટ્રાન્સપોર્ટ', 'Customer': 'ગ્રાહક', 'Discount & charges': 'ડિસ્કાઉન્ટ અને ચાર્જ',
      'Terms': 'શરતો', 'Summary': 'સારાંશ', 'Total': 'કુલ',
      'Use': 'વાપરો', 'Enter your business name': 'તમારા વ્યવસાયનું નામ લખો', 'PIN code must be 6 digits': 'પિન કોડ 6 અંકનો હોવો જોઈએ',
      'GSTIN looks invalid — fix it or leave it blank': 'GSTIN ખોટો લાગે છે — સુધારો અથવા ખાલી રાખો',
      'Billing and collection': 'બિલિંગ અને વસૂલાત', 'Needs attention': 'ધ્યાન આપો', 'Recent documents': 'તાજેતરના દસ્તાવેજો', 'See all': 'બધા જુઓ',
      'Who owes you': 'કોની પાસે લેવાનું બાકી છે', 'Billed': 'બિલ કર્યું', 'Overdue by age': 'કેટલા દિવસથી બાકી', 'billed this FY': 'આ નાણાકીય વર્ષે બિલ કર્યું',
      '1–30 days': '1–30 દિવસ', '31–60 days': '31–60 દિવસ', '61–90 days': '61–90 દિવસ', '90+ days': '90+ દિવસ', 'Invoice': 'બિલ', 'Credit note': 'ક્રેડિટ નોટ', 'Debit note': 'ડેબિટ નોટ',
      'Filters': 'ફિલ્ટર', 'Credit notes': 'ક્રેડિટ નોટ', 'Debit notes': 'ડેબિટ નોટ', 'All': 'બધા',
      'Business details': 'વ્યવસાય વિગતો',
      'Fix before filing': 'ફાઇલ કરતા પહેલા સુધારો', 'Nothing to report this month': 'આ મહિને કંઈ રિપોર્ટ કરવાનું નથી', 'Download CSV': 'CSV ડાઉનલોડ કરો',
      'Demo Mode': 'ડેમો મોડ', 'Exit demo': 'ડેમો બંધ કરો', 'Exit Demo Mode': 'ડેમો મોડ બંધ કરો', 'Try with sample data': 'નમૂના ડેટાથી અજમાવો',
      'Workspace': 'કાર્યક્ષેત્ર', 'Records': 'રેકોર્ડ', 'Sign out': 'સાઇન આઉટ', 'GST billing': 'GST બિલિંગ', 'Add buyer': 'ગ્રાહક ઉમેરો', 'Cash flow': 'રોકડ પ્રવાહ', 'Received': 'મળેલ', 'Collection': 'વસૂલાત', 'collected': 'વસૂલ', 'Billed this FY': 'આ વર્ષે બિલ', 'Avg. days to get paid': 'ચુકવણીના સરેરાશ દિવસ', 'day': 'દિવસ', 'days': 'દિવસ', 'Received this month': 'આ મહિને મળેલ', 'Open quotations': 'ખુલ્લા ક્વોટેશન', 'awaiting reply': 'જવાબ બાકી', 'awaiting replies': 'જવાબ બાકી', 'incl. TDS': 'TDS સહિત', 'Good morning.': 'સુપ્રભાત.', 'Good afternoon.': 'નમસ્તે.', 'Good evening.': 'શુભ સાંજ.', 'Here is where your money stands.': 'તમારા પૈસાની સંપૂર્ણ સ્થિતિ અહીં છે.', 'Live preview': 'લાઇવ ઝલક', 'Full preview': 'પૂરું જુઓ', 'Charges': 'ચાર્જ', 'Tax': 'ટેક્સ', 'Transport': 'પરિવહન', 'Modern': 'મોડર્ન', 'Classic': 'ક્લાસિક', 'document': 'દસ્તાવેજ', 'documents': 'દસ્તાવેજ', 'billed': 'બિલ', 'received': 'મળેલ', 'Every invoice, quotation and note you have issued.': 'તમે જારી કરેલા બધા બિલ, ક્વોટેશન અને નોટ.', 'Products and services with HSN, GST rate and stock.': 'HSN, GST દર અને સ્ટોક સાથે માલ અને સેવાઓ.', 'Your buyers, their GSTINs and what they owe.': 'તમારા ગ્રાહકો, તેમના GSTIN અને બાકી રકમ.', 'Business profile, GST rules, branding and backups.': 'વ્યવસાય પ્રોફાઇલ, GST નિયમો, બ્રાન્ડિંગ અને બેકઅપ.',
      'DEMO MODE': 'ડેમો મોડ', '— sample data, not real invoices': '— નમૂના ડેટા, સાચા બિલ નથી',
      'Just looking? Explore with sample data (Demo Mode)': 'ફક્ત જોઈ રહ્યા છો? નમૂના ડેટાથી અજમાવો (ડેમો મોડ)',
      'Open Demo Mode?': 'ડેમો મોડ ખોલશો?', 'Leave Demo Mode?': 'ડેમો મોડ બંધ કરશો?',
      'Demo Mode shows sample customers and invoices so you can try the app. Your own data is kept separately and is not changed. Demo documents are watermarked "NOT A VALID TAX INVOICE".': 'ડેમો મોડમાં નમૂના ગ્રાહકો અને બિલ દેખાય છે જેથી તમે એપ અજમાવી શકો. તમારો પોતાનો ડેટા અલગ સુરક્ષિત રહે છે અને બદલાતો નથી. ડેમો બિલ પર "NOT A VALID TAX INVOICE" વોટરમાર્ક રહે છે.',
      'The sample data will be deleted and your own data will open.': 'નમૂના ડેટા કાઢી નાખવામાં આવશે અને તમારો પોતાનો ડેટા ખુલશે.'
    }
  };
  // v8.1 account + cloud sync
  Object.assign(T.hi, {
    'Continue with Google': 'Google से जारी रखें', 'Account & cloud sync': 'खाता व क्लाउड सिंक', 'Account & sync': 'खाता व सिंक', 'Sync now': 'अभी सिंक करें',
    'Sign out': 'साइन आउट', 'Sign out?': 'साइन आउट करें?', 'Synced': 'सिंक हुआ', 'Syncing…': 'सिंक हो रहा है…', 'Last synced': 'आखिरी सिंक', 'Not synced yet': 'अभी सिंक नहीं हुआ',
    'Delete account and cloud data': 'खाता व क्लाउड डेटा हटाएँ', 'Sign in again': 'फिर से साइन इन करें', 'Privacy policy': 'गोपनीयता नीति', 'Cancel': 'रद्द करें',
    'Use cloud copy': 'क्लाउड कॉपी इस्तेमाल करें', 'Use data on this phone': 'इस फ़ोन का डेटा रखें', "Keep this phone's data": 'इस फ़ोन का डेटा रखें',
    'Sign in to open your business data. It is saved on this phone and synced automatically to your HGI cloud account, so a reinstall or a new phone brings everything back.':
      'अपना व्यापार डेटा खोलने के लिए साइन इन करें। डेटा इस फ़ोन पर सेव होता है और अपने-आप आपके HGI क्लाउड खाते में सिंक होता है — ऐप दोबारा इंस्टॉल करने या नया फ़ोन लेने पर सब वापस आ जाता है।',
    'Waiting for internet — changes are saved on this phone and will sync automatically.': 'इंटरनेट का इंतज़ार — बदलाव इस फ़ोन पर सेव हैं और अपने-आप सिंक होंगे।'
  });
  Object.assign(T.gu, {
    'Continue with Google': 'Google સાથે આગળ વધો', 'Account & cloud sync': 'એકાઉન્ટ અને ક્લાઉડ સિંક', 'Account & sync': 'એકાઉન્ટ અને સિંક', 'Sync now': 'હમણાં સિંક કરો',
    'Sign out': 'સાઇન આઉટ', 'Sign out?': 'સાઇન આઉટ કરવું છે?', 'Synced': 'સિંક થયું', 'Syncing…': 'સિંક થાય છે…', 'Last synced': 'છેલ્લું સિંક', 'Not synced yet': 'હજી સિંક થયું નથી',
    'Delete account and cloud data': 'એકાઉન્ટ અને ક્લાઉડ ડેટા કાઢી નાખો', 'Sign in again': 'ફરી સાઇન ઇન કરો', 'Privacy policy': 'ગોપનીયતા નીતિ', 'Cancel': 'રદ કરો',
    'Use cloud copy': 'ક્લાઉડ કૉપી વાપરો', 'Use data on this phone': 'આ ફોનનો ડેટા રાખો', "Keep this phone's data": 'આ ફોનનો ડેટા રાખો',
    'Sign in to open your business data. It is saved on this phone and synced automatically to your HGI cloud account, so a reinstall or a new phone brings everything back.':
      'તમારો વ્યવસાય ડેટા ખોલવા સાઇન ઇન કરો. ડેટા આ ફોનમાં સાચવાય છે અને આપમેળે તમારા HGI ક્લાઉડ એકાઉન્ટમાં સિંક થાય છે — ફરી ઇન્સ્ટોલ કરો કે નવો ફોન લો, બધું પાછું આવી જાય છે.',
    'Waiting for internet — changes are saved on this phone and will sync automatically.': 'ઇન્ટરનેટની રાહ — ફેરફાર આ ફોનમાં સાચવેલા છે અને આપમેળે સિંક થશે.'
  });
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
