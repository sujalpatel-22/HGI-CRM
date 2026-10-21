/* Drop-in replacement for the qrcodejs API used by the app — new QRCode(div, {text, width, height, correctLevel}) —
   built on the 'qrcode-generator' library (bundled before this file). Draws onto a <canvas> so the app can
   call canvas.toDataURL() exactly as before. */
(function () {
  if (typeof window.qrcode !== 'function') { console.error('qrcode-generator missing'); return; }
  const LEVEL = { 0: 'M', 1: 'L', 2: 'H', 3: 'Q' };      // qrcodejs CorrectLevel numbering
  function QRCode(el, opts) {
    const o = typeof opts === 'string' ? { text: opts } : (opts || {});
    const size = o.width || 256;
    const qr = window.qrcode(0, LEVEL[o.correctLevel] || 'M');
    qr.addData(unescape(encodeURIComponent(o.text || '')), 'Byte');   // UTF-8 bytes
    qr.make();
    const n = qr.getModuleCount(), quiet = 2, cell = size / (n + quiet * 2);
    const c = document.createElement('canvas');
    c.width = size; c.height = o.height || size;
    const g = c.getContext('2d');
    g.fillStyle = o.colorLight || '#ffffff'; g.fillRect(0, 0, c.width, c.height);
    g.fillStyle = o.colorDark || '#000000';
    for (let r = 0; r < n; r++) for (let col = 0; col < n; col++) if (qr.isDark(r, col))
      g.fillRect(Math.floor((col + quiet) * cell), Math.floor((r + quiet) * cell), Math.ceil(cell), Math.ceil(cell));
    if (el) el.appendChild(c);
    this._el = el; this._canvas = c;
  }
  QRCode.CorrectLevel = { L: 1, M: 0, Q: 3, H: 2 };
  window.QRCode = QRCode;
})();
