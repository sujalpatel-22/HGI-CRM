import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const run = (script, args = []) => execFileSync(process.execPath, [path.join(root, script), ...args], { cwd: root, stdio: 'inherit' });
run('tools/build-web.mjs');
if (!fs.existsSync(path.join(root, 'android'))) run('node_modules/@capacitor/cli/bin/capacitor', ['add', 'android']);
run('tools/patch-android.mjs');
run('node_modules/@capacitor/cli/bin/capacitor', ['sync', 'android']);
