/* HGI 8.1: workspace presentation. Uses the existing records and actions. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const icon = name => window.HGI_STUDIO.ic(name);
  const strings = {
    hi: {
      'YOUR WORKSPACE': 'आपका कार्यक्षेत्र', 'Everything you need to keep business moving.': 'बिलिंग, पेमेंट और स्टॉक — सब एक जगह।',
      'View outstanding': 'बकाया देखें', 'Outstanding': 'बकाया', 'Overdue breakdown': 'देरी से भुगतान का विवरण',
      'Search documents': 'दस्तावेज़ खोजें', 'More options': 'और विकल्प', 'Your documents, organised.': 'आपके दस्तावेज़, व्यवस्थित।',
      'Your product catalogue.': 'आपके उत्पादों की सूची।', 'Your buyer directory.': 'आपके खरीदारों की सूची।',
      'Make this workspace yours.': 'अपना कार्यक्षेत्र सेट करें।', 'Create your first invoice': 'अपना पहला इनवॉइस बनाएं',
      'Start with a buyer and an item. Your totals are calculated for you.': 'खरीदार और आइटम जोड़ें। कुल राशि अपने आप निकलेगी।',
      'Build your catalogue': 'उत्पाद सूची बनाएं', 'Save products once. Add them to invoices in seconds.': 'उत्पाद सेव करें और इनवॉइस में तुरंत जोड़ें।',
      'Meet your buyers': 'खरीदार जोड़ें', 'Keep buyer details ready for your next invoice.': 'अगले इनवॉइस के लिए खरीदार की जानकारी तैयार रखें।',
      'No matching results': 'कोई परिणाम नहीं', 'Try a different search, or clear your filters.': 'दूसरा शब्द खोजें या फ़िल्टर हटाएं।',
      'Clear filters': 'फ़िल्टर हटाएं', 'Add item': 'आइटम जोड़ें', 'Add buyer': 'खरीदार जोड़ें', 'New invoice': 'नया इनवॉइस',
      'Ready when you are': 'शुरू करने के लिए तैयार', 'Offline workspace': 'ऑफ़लाइन कार्यक्षेत्र'
    },
    gu: {
      'YOUR WORKSPACE': 'તમારું કાર્યક્ષેત્ર', 'Everything you need to keep business moving.': 'બિલિંગ, પેમેન્ટ અને સ્ટોક — એક જ જગ્યાએ.',
      'View outstanding': 'બાકી રકમ જુઓ', 'Outstanding': 'બાકી રકમ', 'Overdue breakdown': 'મોડી ચુકવણીની વિગતો',
      'Search documents': 'દસ્તાવેજો શોધો', 'More options': 'વધુ વિકલ્પો', 'Your documents, organised.': 'તમારા દસ્તાવેજો, વ્યવસ્થિત.',
      'Your product catalogue.': 'તમારા ઉત્પાદનોની સૂચિ.', 'Your buyer directory.': 'તમારા ખરીદદારોની સૂચિ.',
      'Make this workspace yours.': 'તમારું કાર્યક્ષેત્ર ગોઠવો.', 'Create your first invoice': 'તમારું પ્રથમ ઇન્વૉઇસ બનાવો',
      'Start with a buyer and an item. Your totals are calculated for you.': 'ખરીદદાર અને વસ્તુ ઉમેરો. કુલ રકમ આપમેળે ગણાશે.',
      'Build your catalogue': 'ઉત્પાદન સૂચિ બનાવો', 'Save products once. Add them to invoices in seconds.': 'ઉત્પાદનો સાચવો અને ઇન્વૉઇસમાં તરત ઉમેરો.',
      'Meet your buyers': 'ખરીદદારો ઉમેરો', 'Keep buyer details ready for your next invoice.': 'આગામી ઇન્વૉઇસ માટે ખરીદદારની વિગતો તૈયાર રાખો.',
      'No matching results': 'કોઈ પરિણામ નથી', 'Try a different search, or clear your filters.': 'બીજું શોધો અથવા ફિલ્ટર દૂર કરો.',
      'Clear filters': 'ફિલ્ટર દૂર કરો', 'Add item': 'વસ્તુ ઉમેરો', 'Add buyer': 'ખરીદદાર ઉમેરો', 'New invoice': 'નવું ઇન્વૉઇસ',
      'Ready when you are': 'શરૂ કરવા તૈયાર', 'Offline workspace': 'ઑફલાઇન કાર્યક્ષેત્ર'
    }
  };
  const t = key => (strings[document.documentElement.lang] || {})[key] || key;
  const label = (el, key) => { el.dataset.nxText = key; el.textContent = t(key); };
  const wrap = (name, after) => {
    const original = window[name];
    if (typeof original !== 'function') return;
    window[name] = function (...args) { const value = original.apply(this, args); after(); return value; };
  };

  function outstanding() {
    ['inv-search', 'inv-filter-from', 'inv-filter-to'].forEach(id => { $(id).value = ''; });
    $('inv-filter-type').value = 'INV';
    $('inv-filter-status').value = 'Outstanding';
    switchTab('invoices');
  }
  function dashboard() {
    const head = document.querySelector('#tab-dashboard > .dash-head');
    if (head && !head.querySelector('.nx-kicker')) {
      const kicker = document.createElement('div'); kicker.className = 'nx-kicker'; label(kicker, 'YOUR WORKSPACE');
      head.querySelector('.dh-titles').prepend(kicker);
      const status = document.createElement('span'); status.className = 'nx-status';
      status.innerHTML = icon('lock') + '<span data-nx-text="Offline workspace"></span>';
      head.append(status);
    }
    if ($('dash-greet')) label($('dash-greet'), 'Everything you need to keep business moving.');
    const hero = $('hero');
    if (hero && !hero.querySelector('.nx-collect')) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'nx-collect';
      const text = document.createElement('span'); label(text, 'View outstanding');
      button.append(text); button.insertAdjacentHTML('beforeend', icon('arrowr'));
      button.addEventListener('click', outstanding);
      hero.querySelector('.hero-sub').after(button);
      const ageing = hero.querySelector('.hero-aging');
      if (ageing) {
        const details = document.createElement('details'); details.className = 'nx-aging'; details.open = window.innerWidth >= 768;
        const summary = document.createElement('summary'); label(summary, 'Overdue breakdown');
        ageing.before(details); details.append(summary, ageing);
      }
    }
    const currentTab = document.querySelector('.tab-content:not(.hidden)')?.id.replace('tab-', '') || 'dashboard';
    const nav = $('bottom-nav');
    if (nav) nav.querySelectorAll('button[data-tab]').forEach(b => {
      if (b.dataset.tab === currentTab) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current');
    });
    translate();
  }

  const specs = {
    invoices: ['invoices-list-tbody', 'invoices', 'docs', 'Create your first invoice', 'Start with a buyer and an item. Your totals are calculated for you.', 'New invoice'],
    items: ['items-list-tbody', 'products', 'items', 'Build your catalogue', 'Save products once. Add them to invoices in seconds.', 'Add item'],
    customers: ['customers-list-tbody', 'customers', 'buyers', 'Meet your buyers', 'Keep buyer details ready for your next invoice.', 'Add buyer']
  };
  function clearFilters(kind) {
    if (kind === 'invoices') {
      ['inv-search', 'inv-filter-type', 'inv-filter-status', 'inv-filter-from', 'inv-filter-to'].forEach(id => { $(id).value = ''; });
      renderInvoiceList();
    } else if (kind === 'items') { $('item-search').value = ''; renderItemList(); }
    else { $('cust-search').value = ''; renderCustomerList(); }
  }
  function create(kind) {
    if (kind === 'invoices') newDocument('INV');
    else if (kind === 'items') openItemModal();
    else openCustomerModal();
  }
  function emptyStates() {
    Object.entries(specs).forEach(([kind, [id, key, glyph, title, subtitle, action]]) => {
      const cell = $(id)?.querySelector('tr:not(.show-more-row):not(.month-row) > td[colspan].text-center');
      if (!cell || cell.querySelector('.nx-empty')) return;
      const filtered = state[key].length > 0;
      cell.parentElement.classList.add('nx-empty-row');
      cell.textContent = '';
      const box = document.createElement('div'); box.className = 'nx-empty';
      box.innerHTML = '<div class="nx-empty-icon">' + icon(filtered ? 'search' : glyph) + '</div>';
      const h = document.createElement('h3'); label(h, filtered ? 'No matching results' : title);
      const p = document.createElement('p'); label(p, filtered ? 'Try a different search, or clear your filters.' : subtitle);
      const b = document.createElement('button'); b.type = 'button'; b.className = 'btn-primary';
      label(b, filtered ? 'Clear filters' : action);
      b.addEventListener('click', () => filtered ? clearFilters(kind) : create(kind));
      box.append(h, p, b); cell.append(box);
    });
  }
  function shell() {
    const header = document.querySelector('#app-container > header > div');
    if (header && !$('nx-search')) {
      const button = document.createElement('button'); button.id = 'nx-search'; button.type = 'button';
      button.className = 'nx-search'; button.innerHTML = icon('search') + '<span data-nx-text="Search documents"></span><kbd>Ctrl K</kbd>';
      button.setAttribute('aria-label', t('Search documents'));
      button.addEventListener('click', () => { switchTab('invoices'); $('inv-search').focus(); });
      header.insertBefore(button, $('app-avatar'));
    }
    if ($('app-avatar')) $('app-avatar').setAttribute('aria-label', t('More options'));
    const captions = { invoices: 'Your documents, organised.', items: 'Your product catalogue.', customers: 'Your buyer directory.', settings: 'Make this workspace yours.' };
    Object.entries(captions).forEach(([tab, text]) => {
      const section = $('tab-' + tab); if (!section || section.querySelector('.nx-page-subtitle')) return;
      const h = section.querySelector('h2'); if (!h) return;
      const sub = document.createElement('p'); sub.className = 'nx-page-subtitle'; label(sub, text); h.after(sub);
    });
    document.documentElement.classList.add('hgi-next');
  }
  function translate() {
    document.querySelectorAll('[data-nx-text]').forEach(el => { const value = t(el.dataset.nxText); if (el.textContent !== value) el.textContent = value; });
  }
  window.HGI_NEXT = { init() {
    shell(); dashboard(); emptyStates();
    wrap('renderDashboard', dashboard);
    ['renderInvoiceList', 'renderItemList', 'renderCustomerList'].forEach(name => wrap(name, emptyStates));
    wrap('switchTab', () => { dashboard(); emptyStates(); });
    new MutationObserver(() => { translate(); emptyStates(); }).observe(document.documentElement, { attributes: true, attributeFilter: ['lang'] });
  }, outstanding };
})();
