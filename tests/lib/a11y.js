// Browser-side accessibility checks (axe-core is not available offline): runs on the visible part of the current screen.
// window.__a11y({minTarget}) → { unnamed:[…], unlabeled:[…], smallTargets:[…], lowContrast:[…] }
window.__a11y = function ({ minTarget = 32, root = document } = {}) {
  const vis = el => { if (!el.isConnected) return false; const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return false; const cs = getComputedStyle(el); if (cs.visibility === 'hidden' || cs.display === 'none' || Number(cs.opacity) === 0) return false; return !el.closest('[aria-hidden="true"], .hidden, .no-a11y-scan') && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  // is the element really on top at its centre (not covered by a sheet / dialog)?
  const onTop = el => { const r = el.getBoundingClientRect(); const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2)), y = Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2)); const t = document.elementFromPoint(x, y); return !!t && (t === el || el.contains(t) || t.contains(el)); };
  const desc = el => (el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '')) + ' "' + (el.innerText || el.value || el.getAttribute('placeholder') || '').trim().slice(0, 30) + '"';
  const nameOf = el => (el.getAttribute('aria-label') || '').trim() || (el.getAttribute('aria-labelledby') && (document.getElementById(el.getAttribute('aria-labelledby')) || {}).textContent || '').trim()
    || (el.innerText || '').trim() || (el.getAttribute('title') || '').trim() || (el.querySelector('img[alt]') || {}).alt || '';
  const out = { unnamed: [], unlabeled: [], smallTargets: [], lowContrast: [] };
  root.querySelectorAll('button, a[href], [role="button"], [role="tab"]').forEach(el => {
    if (!vis(el) || !onTop(el)) return;
    if (!nameOf(el)) out.unnamed.push(desc(el));
    const r = el.getBoundingClientRect();
    if ((r.width < minTarget || r.height < minTarget) && !el.closest('p, li, td') ) out.smallTargets.push(`${desc(el)} ${Math.round(r.width)}×${Math.round(r.height)}`);
  });
  root.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea').forEach(el => {
    if (!vis(el)) return;
    const lab = el.labels && el.labels.length && Array.from(el.labels).some(l => l.textContent.trim());
    // a field label placed directly above the control (the app's pattern) counts as its label only when programmatic
    if (!lab && !(el.getAttribute('aria-label') || '').trim() && !el.getAttribute('aria-labelledby') && !(el.getAttribute('title') || '').trim()) out.unlabeled.push(desc(el));
  });
  const parse = c => { const m = c.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 }; };
  const lum = ({ r, g, b }) => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
  const bgOf = el => { let layers = []; for (let n = el; n && n.nodeType === 1; n = n.parentElement) { const cs = getComputedStyle(n); if (cs.backgroundImage && cs.backgroundImage !== 'none') return null; const c = parse(cs.backgroundColor); if (c && c.a > 0) { layers.push(c); if (c.a >= 0.99) break; } }
    let base = { r: 255, g: 255, b: 255 }; if (document.documentElement.classList.contains('dark')) { const b = parse(getComputedStyle(document.body).backgroundColor); if (b) base = b; }
    return layers.reverse().reduce((acc, c) => ({ r: c.r * c.a + acc.r * (1 - c.a), g: c.g * c.a + acc.g * (1 - c.a), b: c.b * c.a + acc.b * (1 - c.a) }), base); };
  const seen = new Set();
  const walker = document.createTreeWalker(root.body || root, NodeFilter.SHOW_TEXT);
  let n; while ((n = walker.nextNode())) {
    const el = n.parentElement; if (!el || seen.has(el) || !n.nodeValue.trim() || !vis(el) || el.closest('svg, .a4-page, #invoice-preview-container, .paper, .demo-watermark, option')) continue;
    seen.add(el);
    const cs = getComputedStyle(el); const fg = parse(cs.color); const bg = bgOf(el); if (!fg || !bg) continue;
    const a = fg.a; const f2 = { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a) };
    const L1 = lum(f2), L2 = lum(bg), ratio = (Math.max(L1, L2) + 0.05) / (Math.min(L1, L2) + 0.05);
    const size = parseFloat(cs.fontSize), bold = Number(cs.fontWeight) >= 700, large = size >= 24 || (bold && size >= 18.66);
    if (el.closest('input, select, textarea, [disabled], :disabled')) continue;
    if (ratio < (large ? 3 : 4.5) - 0.05) out.lowContrast.push(`${desc(el)} ${ratio.toFixed(2)}:1 (${cs.color} on rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}))`);
  }
  return out;
};
