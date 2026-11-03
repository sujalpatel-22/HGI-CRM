/* =====================================================================
   HGI Billing v9.2 — durable copy of the book in a browser without the Android shell.
   The Android app keeps a file copy of the data next to WebView storage (no size limit). The web version only had
   localStorage, which is full at about 5 MB (≈4,500 invoices): later changes were kept in memory only. This gives the
   web version the same second copy in IndexedDB (hundreds of MB), read at start-up when it is newer.
   Same key names as the Android mirror files.
   ===================================================================== */
(function () {
  'use strict';
  let dbp = null;
  function db() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      if (!window.indexedDB) return reject(new Error('IndexedDB unavailable'));
      const r = indexedDB.open('hgi-billing', 1);
      r.onupgradeneeded = () => { r.result.createObjectStore('files'); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('IndexedDB open failed'));
      r.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    dbp.catch(() => { dbp = null; });
    return dbp;
  }
  const tx = (mode, fn) => db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction('files', mode), st = t.objectStore('files');
    const req = fn(st);
    t.oncomplete = () => resolve(req && req.result);
    t.onerror = t.onabort = () => reject(t.error || new Error('IndexedDB transaction failed'));
  }));
  const timeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
  window.HGI_WEBSTORE = {
    available: () => !!window.indexedDB,
    get: key => timeout(tx('readonly', st => st.get(key)), 4000).then(v => (typeof v === 'string' && v ? v : null)).catch(() => null),
    set: (key, data) => timeout(tx('readwrite', st => (data ? st.put(String(data), key) : st.delete(key))), 8000).then(() => true).catch(() => false),
    del: key => timeout(tx('readwrite', st => st.delete(key)), 4000).then(() => true).catch(() => false)
  };
})();
