#!/usr/bin/env node
// Applies HGI customisations to the Capacitor-generated android/ project (idempotent).
//   npx cap add android && node tools/patch-android.mjs && npx cap sync android
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const cfg = JSON.parse(fs.readFileSync(path.join(root, 'capacitor.config.json'), 'utf8'));
const app = path.join(root, 'android', 'app');
const main = path.join(app, 'src', 'main');
if (!fs.existsSync(main)) throw new Error('android/ project missing — run `npx cap add android` first');

const walk = d => fs.readdirSync(d, { withFileTypes: true }).flatMap(e => e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]);
const copyTree = (from, to) => walk(from).forEach(f => { const dest = path.join(to, path.relative(from, f)); fs.mkdirSync(path.dirname(dest), { recursive: true }); fs.copyFileSync(f, dest); });

// 1. Java sources (MainActivity + HgiNative plugin + PDF writer)
const pkgPath = cfg.appId.split('.').join(path.sep);
for (const f of walk(path.join(main, 'java')).filter(f => f.endsWith('MainActivity.java') || f.endsWith('MainActivity.kt'))) fs.rmSync(f);
copyTree(path.join(root, 'native', 'java'), path.join(main, 'java'));
if (!fs.existsSync(path.join(main, 'java', pkgPath, 'MainActivity.java'))) throw new Error(`MainActivity not found for appId ${cfg.appId}`);

// 2. Icons, splash, colours
for (const f of walk(path.join(main, 'res')).filter(f => path.basename(f) === 'splash.png')) fs.rmSync(f);
copyTree(path.join(root, 'native', 'res'), path.join(main, 'res'));

// 3. FileProvider paths used for sharing PDFs / backups
fs.writeFileSync(path.join(main, 'res', 'xml', 'file_paths.xml'), `<?xml version="1.0" encoding="utf-8"?>
<paths xmlns:android="http://schemas.android.com/apk/res/android">
    <cache-path name="pdf" path="pdf/" />
    <cache-path name="export" path="export/" />
    <cache-path name="my_cache_images" path="." />
    <external-path name="my_images" path="." />
</paths>
`);

// 4. Manifest: no extra permissions; make sure the FileProvider exists and density config change is handled
const manifestPath = path.join(main, 'AndroidManifest.xml');
let manifest = fs.readFileSync(manifestPath, 'utf8');
if (!manifest.includes('androidx.core.content.FileProvider')) throw new Error('Capacitor template changed: FileProvider missing from AndroidManifest.xml');
manifest = manifest.replace(/android:configChanges="([^"]*)"/, (m, v) => `android:configChanges="${v.includes('density') ? v : v + '|density'}"`);
fs.writeFileSync(manifestPath, manifest);

// 5. Release signing + version from environment (CI secrets) — nothing secret is committed
const gradlePath = path.join(app, 'build.gradle');
let gradle = fs.readFileSync(gradlePath, 'utf8');
const MARK = '// >>> HGI release config';
if (!gradle.includes(MARK)) {
  gradle += `
${MARK}
android {
    defaultConfig {
        versionCode Integer.parseInt(System.getenv('HGI_VERSION_CODE') ?: '1')
        versionName System.getenv('HGI_VERSION_NAME') ?: '${pkg.version}'
    }
    def ksFile = System.getenv('HGI_KEYSTORE_FILE')
    if (ksFile) {
        signingConfigs {
            hgiRelease {
                storeFile file(ksFile)
                storePassword System.getenv('HGI_KEYSTORE_PASSWORD')
                keyAlias System.getenv('HGI_KEY_ALIAS')
                keyPassword System.getenv('HGI_KEY_PASSWORD')
            }
        }
        buildTypes.release.signingConfig signingConfigs.hgiRelease
    }
    lint { abortOnError false; checkReleaseBuilds false }
}
// <<< HGI release config
`;
  fs.writeFileSync(gradlePath, gradle);
}

// 6. App name
const strings = path.join(main, 'res', 'values', 'strings.xml');
fs.writeFileSync(strings, fs.readFileSync(strings, 'utf8')
  .replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${cfg.appName}</string>`)
  .replace(/<string name="title_activity_main">[^<]*<\/string>/, `<string name="title_activity_main">${cfg.appName}</string>`));

console.log(`android/ patched: ${cfg.appId} v${pkg.version} — plugin, icons, file provider, signing hook`);
