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

// 4. Manifest: no extra permissions (INTERNET from the template is used for sign-in + sync); make sure the FileProvider exists and density config change is handled
const manifestPath = path.join(main, 'AndroidManifest.xml');
let manifest = fs.readFileSync(manifestPath, 'utf8');
if (!manifest.includes('android.permission.INTERNET')) throw new Error('Capacitor template changed: INTERNET permission missing (needed for cloud sync)');
if (!manifest.includes('androidx.core.content.FileProvider')) throw new Error('Capacitor template changed: FileProvider missing from AndroidManifest.xml');
manifest = manifest.replace(/android:configChanges="([^"]*)"/, (m, v) => `android:configChanges="${v.includes('density') ? v : v + '|density'}"`);
// Backups: invoices are financial records. No silent Google cloud backup of the app's data; phone-to-phone
// transfer (Android 12+ device transfer) is still allowed. Users back up explicitly with "Share Backup".
fs.writeFileSync(path.join(main, 'res', 'xml', 'data_extraction_rules.xml'), `<?xml version="1.0" encoding="utf-8"?>
<data-extraction-rules>
    <cloud-backup>
        <exclude domain="root" path="." />
        <exclude domain="file" path="." />
        <exclude domain="database" path="." />
        <exclude domain="sharedpref" path="." />
    </cloud-backup>
    <device-transfer>
        <include domain="root" path="." />
        <include domain="file" path="." />
        <include domain="database" path="." />
        <include domain="sharedpref" path="." />
    </device-transfer>
</data-extraction-rules>
`);
fs.writeFileSync(path.join(main, 'res', 'xml', 'backup_rules.xml'), `<?xml version="1.0" encoding="utf-8"?>
<full-backup-content>
    <exclude domain="root" path="." />
    <exclude domain="file" path="." />
    <exclude domain="database" path="." />
    <exclude domain="sharedpref" path="." />
</full-backup-content>
`);
manifest = manifest.replace(/<application\b([^>]*)>/, (m, attrs) => {
  let a = attrs.replace(/\s+android:(fullBackupContent|dataExtractionRules)="[^"]*"/g, '');
  a += ' android:fullBackupContent="@xml/backup_rules" android:dataExtractionRules="@xml/data_extraction_rules"';
  if (!/android:usesCleartextTraffic=/.test(a)) a += ' android:usesCleartextTraffic="false"';
  return `<application${a}>`;
});
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

// 6. Cloud sync + Sign in with Google (v8.1)
//    Only PUBLIC values go into the app: the sync service URL and the OAuth "Web application" client ID.
//    Release:  HGI_SYNC_URL + HGI_GOOGLE_WEB_CLIENT_ID (GitHub repository variables). HGI_REQUIRE_SIGNIN=1 makes a
//              missing value a build error (CI sets it for builds signed with the owner's release key).
//    Debug:    test sign-in against a local test service on the emulator's 127.0.0.1:8787 (adb reverse) — debug APK only.
const syncUrl = (process.env.HGI_SYNC_URL || '').replace(/\/$/, '');
const webClientId = process.env.HGI_GOOGLE_WEB_CLIENT_ID || '';
if (syncUrl && !/^https:\/\//.test(syncUrl)) throw new Error('HGI_SYNC_URL must start with https://');
if (webClientId && !/\.apps\.googleusercontent\.com$/.test(webClientId)) throw new Error('HGI_GOOGLE_WEB_CLIENT_ID must be an OAuth client ID (…apps.googleusercontent.com)');
const releaseAuth = syncUrl && webClientId ? 'google' : 'off';
if (process.env.HGI_REQUIRE_SIGNIN === '1' && releaseAuth !== 'google') throw new Error('Release build needs HGI_SYNC_URL and HGI_GOOGLE_WEB_CLIENT_ID (sign-in is required in the store version)');
const xmlEsc = v => String(v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;').replace(/'/g, "\\'");
const cfgXml = (auth, url, cid) => `<?xml version="1.0" encoding="utf-8"?>
<!-- generated by tools/patch-android.mjs — public values only -->
<resources>
    <string name="hgi_auth" translatable="false">${auth}</string>
    <string name="hgi_sync_url" translatable="false">${xmlEsc(url)}</string>
    <string name="hgi_web_client_id" translatable="false">${xmlEsc(cid)}</string>
</resources>
`;
fs.writeFileSync(path.join(main, 'res', 'values', 'hgi_config.xml'), cfgXml(releaseAuth, syncUrl, webClientId));
const dbg = path.join(app, 'src', 'debug');
fs.mkdirSync(path.join(dbg, 'res', 'values'), { recursive: true }); fs.mkdirSync(path.join(dbg, 'res', 'xml'), { recursive: true });
fs.writeFileSync(path.join(dbg, 'res', 'values', 'hgi_config.xml'), cfgXml(process.env.HGI_DEBUG_AUTH || 'test', process.env.HGI_DEBUG_SYNC_URL || 'http://127.0.0.1:8787', ''));
// debug APK only: plain HTTP to the local test service on the emulator
fs.writeFileSync(path.join(dbg, 'res', 'xml', 'hgi_debug_network.xml'), `<?xml version="1.0" encoding="utf-8"?>
<network-security-config>
    <base-config cleartextTrafficPermitted="false" />
    <domain-config cleartextTrafficPermitted="true">
        <domain includeSubdomains="false">127.0.0.1</domain>
        <domain includeSubdomains="false">10.0.2.2</domain>
    </domain-config>
</network-security-config>
`);
fs.writeFileSync(path.join(dbg, 'AndroidManifest.xml'), `<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android" xmlns:tools="http://schemas.android.com/tools">
    <application android:networkSecurityConfig="@xml/hgi_debug_network" android:usesCleartextTraffic="true" tools:replace="android:usesCleartextTraffic" />
</manifest>
`);
const DEPS = '// >>> HGI sign-in dependencies';
if (!gradle.includes(DEPS)) {
  gradle += `
${DEPS}
dependencies {
    implementation "androidx.credentials:credentials:1.3.0"
    implementation "androidx.credentials:credentials-play-services-auth:1.3.0"
    implementation "com.google.android.libraries.identity.googleid:googleid:1.1.1"
}
// <<< HGI sign-in dependencies
`;
  fs.writeFileSync(gradlePath, gradle);
}

// 7. App name
const strings = path.join(main, 'res', 'values', 'strings.xml');
fs.writeFileSync(strings, fs.readFileSync(strings, 'utf8')
  .replace(/<string name="app_name">[^<]*<\/string>/, `<string name="app_name">${cfg.appName}</string>`)
  .replace(/<string name="title_activity_main">[^<]*<\/string>/, `<string name="title_activity_main">${cfg.appName}</string>`));

console.log(`android/ patched: ${cfg.appId} v${pkg.version} — plugin, icons, file provider, signing hook; release sign-in: ${releaseAuth}${releaseAuth === 'google' ? ' (' + syncUrl + ')' : ' — local-only build'}`);
