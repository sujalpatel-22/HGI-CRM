#!/usr/bin/env node
// Builds www/ (the app shipped inside the APK): inlines logos, bundles all libraries locally (no CDN),
// compiles Tailwind CSS. Run after `npm install`.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const src = p => path.join(root, 'src', p);
const www = p => path.join(root, 'www', p);
const mod = p => { const d = path.join(root, 'node_modules', p); if (!fs.existsSync(d)) throw new Error(`missing dependency ${p} — run npm install`); return d; };
const rmrf = p => fs.rmSync(p, { recursive: true, force: true });
const mkdir = p => fs.mkdirSync(p, { recursive: true });
const copy = (a, b) => { mkdir(path.dirname(b)); fs.cpSync(a, b, { recursive: true }); };

rmrf(www('')); mkdir(www('vendor'));

// 1. index.html with inlined logos
let html = fs.readFileSync(src('app.template.html'), 'utf8');
for (const k of ['FAVICON', 'LOGO_ICON', 'LOGO_FULL']) html = html.split(`{{${k}}}`).join(fs.readFileSync(src(`assets/${k}.txt`), 'utf8').trim());
if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error('unresolved template placeholder');
if (/https:\/\/(cdn\.tailwindcss|cdnjs\.cloudflare|fonts\.googleapis)/.test(html)) throw new Error('CDN reference left in app — the APK must work offline');
fs.writeFileSync(www('index.html'), html);
for (const f of ['mobile.css', 'mobile.js', 'i18n.js', 'demo-data.js']) copy(src(f), www(f));

// 2. vendor libraries (versions pinned in package.json)
copy(path.join(mod('chart.js'), 'dist/chart.umd.js'), www('vendor/chart.umd.js'));
fs.writeFileSync(www('vendor/qrcode.js'),
  fs.readFileSync(path.join(mod('qrcode-generator'), 'qrcode.js'), 'utf8') + '\n' + fs.readFileSync(src('qrcode-adapter.js'), 'utf8'));
const fa = mod('@fortawesome/fontawesome-free');
copy(path.join(fa, 'css/all.min.css'), www('vendor/fontawesome/css/all.min.css'));
copy(path.join(fa, 'webfonts'), www('vendor/fontawesome/webfonts'));
const inter = mod('@fontsource/inter');
mkdir(www('vendor/inter'));
let interCss = '';
for (const w of ['400', '500', '600', '700']) interCss += fs.readFileSync(path.join(inter, `${w}.css`), 'utf8') + '\n';
fs.writeFileSync(www('vendor/inter/inter.css'), interCss);
copy(path.join(inter, 'files'), www('vendor/inter/files'));

// 3. Tailwind (v3, same engine as the original CDN build) — scans the app sources for class names
execFileSync(process.execPath, [path.join(mod('tailwindcss'), 'lib/cli.js'), '-c', path.join(root, 'tailwind.config.cjs'),
  '-i', src('tailwind.in.css'), '-o', www('vendor/tailwind.css'), '--minify'], { stdio: 'inherit', cwd: root });

const kb = f => (fs.statSync(www(f)).size / 1024).toFixed(0) + ' KB';
console.log(`www built: index.html ${kb('index.html')}, tailwind.css ${kb('vendor/tailwind.css')}, chart ${kb('vendor/chart.umd.js')}`);
