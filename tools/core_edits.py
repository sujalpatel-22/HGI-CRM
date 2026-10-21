# One-time transformation of the v6.0.0 web app into the shared app core (v7).
import sys
p = sys.argv[1]; s = open(p).read()
def rep(a, b, cnt=1):
    global s
    n = s.count(a); assert n == cnt, (n, a[:100]); s = s.replace(a, b)

# ---------- offline assets (no CDN), viewport for edge-to-edge, theme colour ----------
rep('<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    '<meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover">\n  <meta name="theme-color" content="#0b3a6f">\n  <meta name="color-scheme" content="light dark">')
rep('''  <script src="https://cdn.tailwindcss.com"></script>
  <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
  <script src="https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js"></script>
  <script src="https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.min.js"></script>''',
'''  <link rel="stylesheet" href="vendor/tailwind.css">
  <link rel="stylesheet" href="vendor/fontawesome/css/all.min.css">
  <link rel="stylesheet" href="vendor/inter/inter.css">
  <script src="vendor/qrcode.js"></script>
  <script src="vendor/chart.umd.js"></script>
  <link rel="stylesheet" href="mobile.css">''')
rep("    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');\n", "")
rep("    window.onload = initApp;\n  </script>", "    window.onload = initApp;\n  </script>\n  <script src=\"i18n.js\"></script>\n  <script src=\"mobile.js\"></script>")

# ---------- QUOTATIONS ----------
rep("      DBN: { title: 'DEBIT NOTE', short: 'Debit Note', badge: 'bg-purple-100 text-purple-800' }\n    };",
    "      DBN: { title: 'DEBIT NOTE', short: 'Debit Note', badge: 'bg-purple-100 text-purple-800' },\n      QUO: { title: 'QUOTATION', short: 'Quotation', badge: 'bg-teal-100 text-teal-800' }\n    };")
rep('prefixes: { INV: "", CRN: "CN/", DBN: "DN/" }', 'prefixes: { INV: "", CRN: "CN/", DBN: "DN/", QUO: "QT/" }')
rep('                  <option value="DBN">Debit Note</option>', '                  <option value="DBN">Debit Note</option>\n                  <option value="QUO">Quotation / Estimate</option>')
rep('<option value="DBN">Debit Notes</option>', '<option value="DBN">Debit Notes</option><option value="QUO">Quotations</option>')
rep('<option>Paid</option><option>Overdue</option><option>Cancelled</option>', '<option>Paid</option><option>Overdue</option><option>Cancelled</option><option>Open</option><option>Converted</option><option>Expired</option>')
rep('''                <div><label class="field-label">Debit Note</label><input type="text" id="set-prefix-dbn" maxlength="6" class="inp" placeholder="DN/"></div>''',
'''                <div><label class="field-label">Debit Note</label><input type="text" id="set-prefix-dbn" maxlength="6" class="inp" placeholder="DN/"></div>
                <div><label class="field-label">Quotation</label><input type="text" id="set-prefix-quo" maxlength="6" class="inp" placeholder="QT/"></div>''')
rep("      s('set-prefix-inv', c.prefixes.INV); s('set-prefix-crn', c.prefixes.CRN); s('set-prefix-dbn', c.prefixes.DBN);",
    "      s('set-prefix-inv', c.prefixes.INV); s('set-prefix-crn', c.prefixes.CRN); s('set-prefix-dbn', c.prefixes.DBN); s('set-prefix-quo', c.prefixes.QUO);")
rep("      const prefixes = { INV: v('set-prefix-inv'), CRN: v('set-prefix-crn') || 'CN/', DBN: v('set-prefix-dbn') || 'DN/' };",
    "      const prefixes = { INV: v('set-prefix-inv'), CRN: v('set-prefix-crn') || 'CN/', DBN: v('set-prefix-dbn') || 'DN/', QUO: v('set-prefix-quo') || 'QT/' };")
rep("      if (prefixes.CRN === prefixes.INV || prefixes.DBN === prefixes.INV) return",
    "      if (prefixes.CRN === prefixes.INV || prefixes.DBN === prefixes.INV || prefixes.QUO === prefixes.INV) return")
# quotations are not supplies: excluded from sales, tax, returns
rep("    const liveDocs = () => state.invoices.filter(d => !d.cancelled);", "    const liveDocs = () => state.invoices.filter(d => !d.cancelled && d.docType !== 'QUO');")
rep("    const signed = d => d.docType === 'CRN' ? -1 : 1;", "    const signed = d => d.docType === 'QUO' ? 0 : d.docType === 'CRN' ? -1 : 1;")
rep("    function docsForMonth(mk) { return state.invoices.filter(d => monthKey(d.date) === mk); }",
    "    function docsForMonth(mk) { return state.invoices.filter(d => monthKey(d.date) === mk && d.docType !== 'QUO'); }")
rep("      if (d.cancelled) return 'Cancelled';\n      if (d.docType !== 'INV') return 'Issued';",
    "      if (d.cancelled) return 'Cancelled';\n      if (d.docType === 'QUO') return d.convertedTo ? 'Converted' : (getDueDate(d) < todayISO() ? 'Expired' : 'Open');\n      if (d.docType !== 'INV') return 'Issued';")
rep("Cancelled: 'bg-slate-200 text-slate-500 line-through', Issued: 'bg-slate-100 text-slate-700' }[s];",
    "Cancelled: 'bg-slate-200 text-slate-500 line-through', Issued: 'bg-slate-100 text-slate-700',\n        Open: 'bg-teal-100 text-teal-800', Converted: 'bg-emerald-100 text-emerald-800', Expired: 'bg-slate-200 text-slate-600' }[s];")
rep('                <label class="field-label">Credit Period (Days)</label>', '                <label class="field-label" id="credit-days-label">Credit Period (Days)</label>')
rep("""      $('note-ref-block').classList.toggle('hidden', t === 'INV');
      $('note-ref-block').classList.toggle('grid', t !== 'INV');""",
"""      const isNote = t === 'CRN' || t === 'DBN';
      $('note-ref-block').classList.toggle('hidden', !isNote);
      $('note-ref-block').classList.toggle('grid', isNote);
      $('credit-days-label').innerText = t === 'QUO' ? 'Valid For (Days)' : 'Credit Period (Days)';""")
rep("      if (t !== 'INV') populateRefInvoices();", "      if (isNote) populateRefInvoices();")
rep("""                ${d.docType === 'INV' ? `<div><strong>Due Date:</strong> ${fmtDate(getDueDate(d))}</div><div></div>` : ''}""",
    """                ${d.docType === 'INV' ? `<div><strong>Due Date:</strong> ${fmtDate(getDueDate(d))}</div><div></div>` : d.docType === 'QUO' ? `<div><strong>Valid Till:</strong> ${fmtDate(getDueDate(d))}</div><div></div>` : ''}""")
rep("""            ${d.docType === 'INV' ? `<div class="text-blue-100"><strong>Due:</strong> ${fmtDate(getDueDate(d))}</div>` : ''}""",
    """            ${d.docType === 'INV' ? `<div class="text-blue-100"><strong>Due:</strong> ${fmtDate(getDueDate(d))}</div>` : d.docType === 'QUO' ? `<div class="text-blue-100"><strong>Valid till:</strong> ${fmtDate(getDueDate(d))}</div>` : ''}""")
rep("    function selectedCopies() { return [...document.querySelectorAll('.copy-chk:checked')].map(x => x.value); }",
    "    function selectedCopies() {\n      if (previewDoc && previewDoc.docType === 'QUO') return ['THIS IS A QUOTATION — NOT A TAX INVOICE'];\n      return [...document.querySelectorAll('.copy-chk:checked')].map(x => x.value);\n    }")
rep("      const einvApplies = co.aato !== 'upto5' && (isRegisteredSupply(st) || st === 'EXPWP' || st === 'EXPWOP');",
    "      const einvApplies = d.docType !== 'QUO' && co.aato !== 'upto5' && (isRegisteredSupply(st) || st === 'EXPWP' || st === 'EXPWOP');")
rep("""      if (d.docType === 'INV' && st === 'B2C' && c.isInter && c.grandTotal > B2CL_LIMIT) I(""",
"""      // stock availability (warning only — you may sell against incoming stock)
      if (d.docType === 'INV' && typeof stockOf === 'function') {
        const need = {};
        c.items.forEach(it => { const pr = productByName(it.desc); if (pr && pr.trackStock) need[pr.id] = (need[pr.id] || 0) + it.qty; });
        Object.entries(need).forEach(([pid, q]) => {
          const pr = state.products.find(x => x.id === pid); const avail = stockOf(pr, d.id);
          if (q > avail) W(`Stock: "${pr.name}" needs ${q} ${pr.unit} but only ${avail} available.`, 'Inventory');
        });
      }
      if (d.docType === 'INV' && st === 'B2C' && c.isInter && c.grandTotal > B2CL_LIMIT) I(""")
rep("""      if (d.docType === 'INV' && st === 'B2C' && c.isInter && c.grandTotal > B2CL_LIMIT) I(`Inter-state B2C above ₹1 lakh — reported invoice-wise in GSTR-1 (B2CL).`, 'Rule 59(4)');
      return out;""",
"""      if (d.docType === 'INV' && st === 'B2C' && c.isInter && c.grandTotal > B2CL_LIMIT) I(`Inter-state B2C above ₹1 lakh — reported invoice-wise in GSTR-1 (B2CL).`, 'Rule 59(4)');
      if (d.docType === 'QUO') {          // a quotation is not a tax document: GST rules are advice, not blockers
        out.forEach(o => { if (o.lvl === 'error' && !/required|at least one item/i.test(o.msg)) o.lvl = 'warn'; });
        I('Quotation: not reported in GST returns. Convert it to an invoice when the order is confirmed.');
      }
      return out;""")
# save: return value + quotation conversion
rep("""      renderAll();
      toast(`${DOC_TYPES[doc.docType].short} ${doc.num} saved${errs.length ? ` with ${errs.length} open issue(s)` : ''}`, errs.length ? 'warn' : 'success');
    }""",
"""      if (window.__convertFrom && doc.docType === 'INV') {
        const q = state.invoices.find(x => x.id === window.__convertFrom);
        if (q) { q.convertedTo = doc.num; q.convertedId = doc.id; q.convertedAt = new Date().toISOString(); saveState(); }
        window.__convertFrom = null;
      }
      renderAll();
      toast(`${DOC_TYPES[doc.docType].short} ${doc.num} saved${errs.length ? ` with ${errs.length} open issue(s)` : ''}`, errs.length ? 'warn' : 'success');
      return true;
    }

    function convertQuote(id) {
      const q = state.invoices.find(x => x.id === id);
      if (!q || q.docType !== 'QUO') return;
      if (q.convertedTo && !confirm(`${q.num} was already converted to ${q.convertedTo}. Create another invoice from it?`)) return;
      setEditMode(null);
      loadDocIntoForm({ ...q, docType: 'INV', ewbNo: '', ewbDate: '', irn: '', ackNo: '', ackDate: '', signedQr: '', creditDays: state.company.defaultCreditDays, terms: state.company.terms });
      $('inv-doc-type').value = 'INV';
      const today = todayISO();
      $('inv-date').value = today;
      $('inv-num').value = generateNextNumber('INV', today);
      onDocTypeChange(true);
      window.__convertFrom = q.id;
      switchTab('create-invoice');
      window.scrollTo({ top: 0, behavior: 'smooth' });
      toast(`Quotation ${q.num} loaded as invoice ${$('inv-num').value} — review and save`, 'info');
    }""")
rep("""            <button onclick="duplicateInvoice('${id}')" class="text-slate-500 hover:text-slate-800 p-1" title="Duplicate"><i class="fa-solid fa-copy"></i></button>""",
"""            ${d.docType === 'QUO' && !d.cancelled ? `<button onclick="convertQuote('${id}')" class="text-teal-600 hover:text-teal-800 p-1 text-[11px] font-bold" title="Convert to Invoice"><i class="fa-solid fa-file-export mr-0.5"></i>Invoice</button>` : ''}
            <button onclick="duplicateInvoice('${id}')" class="text-slate-500 hover:text-slate-800 p-1" title="Duplicate"><i class="fa-solid fa-copy"></i></button>""")
rep("      if (window.__convertFrom === undefined) {}", "", 0) if False else None
# newDocument clears a pending conversion
rep("    function newDocument(docType, silent) {\n      setEditMode(null);", "    function newDocument(docType, silent) {\n      window.__convertFrom = null;\n      setEditMode(null);")

# ---------- INVENTORY ----------
rep('<th class="p-3 border-b">GST %</th><th class="p-3 border-b">UQC</th><th class="p-3 border-b">Default Rate</th>',
    '<th class="p-3 border-b">GST %</th><th class="p-3 border-b">UQC</th><th class="p-3 border-b">Default Rate</th><th class="p-3 border-b">Stock</th>')
rep("""          <td class="p-3 font-bold">${money(p.rate)}</td><td class="p-3 text-slate-500">${usage[(p.name || '').toLowerCase()] || 0}</td>""",
"""          <td class="p-3 font-bold">${money(p.rate)}</td>
          <td class="p-3 whitespace-nowrap">${p.trackStock ? (() => { const st = stockOf(p); const low = st <= (Number(p.minStock) || 0);
            return `<span class="font-bold ${st < 0 ? 'text-rose-700' : low ? 'text-amber-600' : 'text-emerald-700'}">${st} ${esc(p.unit)}</span>${low ? ' <i class="fa-solid fa-triangle-exclamation text-amber-500" title="Low stock"></i>' : ''}
              <button onclick="stockIn('${esc(p.id)}')" class="ml-1 text-[11px] font-bold text-blue-600 hover:underline">+ Stock In</button>`; })() : '<span class="text-slate-400 text-xs">not tracked</span>'}</td>
          <td class="p-3 text-slate-500">${usage[(p.name || '').toLowerCase()] || 0}</td>""")
rep("""      }).join('') || '<tr><td colspan="8" class="p-6 text-center text-slate-400">No products found</td></tr>';""",
    """      }).join('') || '<tr><td colspan="9" class="p-6 text-center text-slate-400">No products found</td></tr>';""")
rep("""      <div><label class="field-label">Default Rate (₹, excl. GST)</label><input type="number" step="0.01" id="modal-item-rate" class="inp"></div>""",
"""      <div><label class="field-label">Default Rate (₹, excl. GST)</label><input type="number" step="0.01" id="modal-item-rate" class="inp"></div>
      <div class="border rounded p-3 bg-slate-50 space-y-2">
        <label class="flex items-center text-xs font-bold text-slate-700 cursor-pointer"><input type="checkbox" id="modal-item-track" class="mr-2"> Track stock for this item</label>
        <div class="grid grid-cols-2 gap-2">
          <div><label class="field-label">Opening Stock</label><input type="number" step="0.001" id="modal-item-opening" class="inp" value="0"></div>
          <div><label class="field-label">Low-stock Alert At</label><input type="number" step="0.001" id="modal-item-min" class="inp" value="0"></div>
        </div>
      </div>""")
rep("""      $('modal-item-rate').value = p ? p.rate : '';""",
"""      $('modal-item-rate').value = p ? p.rate : '';
      $('modal-item-track').checked = !!(p && p.trackStock);
      $('modal-item-opening').value = p ? (p.openingStock || 0) : 0;
      $('modal-item-min').value = p ? (p.minStock || 0) : 0;""")
rep("""      const data = { name, hsn, gst: Number($('modal-item-gst').value), unit, rate: parseFloat($('modal-item-rate').value) || 0 };""",
"""      const data = { name, hsn, gst: Number($('modal-item-gst').value), unit, rate: parseFloat($('modal-item-rate').value) || 0,
        trackStock: $('modal-item-track').checked, openingStock: parseFloat($('modal-item-opening').value) || 0, minStock: parseFloat($('modal-item-min').value) || 0 };""")
rep("""    /* =====================================================================
       CUSTOMER MASTER""",
"""    /* ---------- stock ---------- */
    const productByName = name => state.products.find(p => p.name.trim().toLowerCase() === String(name || '').trim().toLowerCase());
    // stock = opening + stock-in − invoiced + credit-note returns (cancelled documents and quotations ignored)
    function stockOf(p, excludeDocId) {
      if (!p) return 0;
      const key = p.name.trim().toLowerCase();
      let qty = (Number(p.openingStock) || 0) + (p.stockIns || []).reduce((a, x) => a + (Number(x.qty) || 0), 0);
      state.invoices.forEach(d => {
        if (d.cancelled || d.id === excludeDocId || !['INV', 'CRN'].includes(d.docType)) return;
        d.items.forEach(it => { if ((it.desc || '').trim().toLowerCase() === key) qty += (d.docType === 'INV' ? -1 : 1) * (Number(it.qty) || 0); });
      });
      return Math.round(qty * 1000) / 1000;
    }
    function stockIn(id) {
      const p = state.products.find(x => x.id === id); if (!p) return;
      const q = prompt(`Stock received for "${p.name}" (${p.unit}). Current stock: ${stockOf(p)}`, '');
      if (q === null) return;
      const qty = parseFloat(q);
      if (!qty) return toast('Enter a quantity (negative to correct a mistake)', 'error');
      const note = prompt('Note (supplier / bill no.) — optional', '') || '';
      p.stockIns = [...(p.stockIns || []), { id: uid('STK'), date: todayISO(), qty, note }];
      saveState(); renderItemList(); renderDashboard();
      toast(`${qty > 0 ? '+' : ''}${qty} ${p.unit} added — stock now ${stockOf(p)}`);
    }

    /* =====================================================================
       CUSTOMER MASTER""")
rep("      const issues = liveDocs().filter(d => d.issues > 0);",
"""      const low = state.products.filter(p => p.trackStock && stockOf(p) <= (Number(p.minStock) || 0));
      if (low.length) add('warn', `<strong>${low.length}</strong> item(s) at or below the stock alert level: ${low.slice(0, 4).map(p => esc(p.name) + ' (' + stockOf(p) + ')').join(', ')}${low.length > 4 ? '…' : ''}`, "switchTab('items')");
      const openQ = state.invoices.filter(d => d.docType === 'QUO' && displayStatus(d) === 'Open');
      if (openQ.length) add('info', `${openQ.length} open quotation(s) worth ${money(openQ.reduce((a, d) => a + d.grandTotal, 0))} — follow up to convert them.`, "document.getElementById('inv-filter-type').value='QUO'; switchTab('invoices')");
      const issues = liveDocs().filter(d => d.issues > 0);""")
open(p, 'w').write(s); print('core edits applied')
