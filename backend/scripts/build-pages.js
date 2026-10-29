#!/usr/bin/env node
'use strict';
// Renders ../PRIVACY.md into public/privacy.html (served at /privacy — the privacy policy URL for Google Play).
const fs = require('fs');
const path = require('path');
const md = fs.readFileSync(path.join(__dirname, '..', '..', 'PRIVACY.md'), 'utf8');
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/_(.+?)_/g, '<em>$1</em>').replace(/([\w.+-]+@[\w-]+\.[\w.]+)/g, '<a href="mailto:$1">$1</a>');
let out = '', inList = false, prevBlank = true;
for (const line of md.split('\n')) {
  if (/^- /.test(line)) { prevBlank = true; if (!inList) { out += '<ul>'; inList = true; } out += `<li>${inline(line.slice(2))}</li>`; continue; }
  if (/^  \S/.test(line) && inList) { out = out.replace(/<\/li>$/, ' ' + inline(line.trim()) + '</li>'); continue; }
  if (inList) { out += '</ul>'; inList = false; }
  if (/^# /.test(line)) out += `<h1>${inline(line.slice(2))}</h1>`;
  else if (/^## /.test(line)) out += `<h2>${inline(line.slice(3))}</h2>`;
  else if (line.trim()) { out = (!prevBlank && out.endsWith('</p>')) ? out.slice(0, -4) + ' ' + inline(line) + '</p>' : out + `<p>${inline(line)}</p>`; }
  prevBlank = !line.trim() || /^#/.test(line);
}
if (inList) out += '</ul>';
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>HGI Billing — Privacy Policy</title><style>body{font:16px/1.6 system-ui,sans-serif;max-width:760px;margin:0 auto;padding:24px 16px;color:#1c1917;background:#fff}
h1{font-size:1.6rem}h2{font-size:1.15rem;margin-top:1.6em}a{color:#c2410c}@media(prefers-color-scheme:dark){body{background:#141210;color:#eee}a{color:#fb923c}}</style></head>
<body>${out}<p><a href="/delete-account">Delete your account and cloud data</a></p></body></html>
`;
fs.writeFileSync(path.join(__dirname, '..', 'public', 'privacy.html'), html);
console.log('public/privacy.html written');
