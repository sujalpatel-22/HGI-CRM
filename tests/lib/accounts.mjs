// Test helpers for username + password accounts (v9.4): a cloud-service config on the Google Sheets stand-in, and filling
// the app's sign-in screen (first time for a name → "Create account", afterwards → "Log in").
import crypto from 'node:crypto';

export const TEST_PASSWORD = 'Test-Pass-2026';
const created = new Set();
export const usernameOf = email => String(email).split('@')[0].toLowerCase().replace(/[^a-z0-9._-]/g, '').padEnd(3, '0');

/** cloud-service configuration for tests: a fresh spreadsheet in the stand-in, fast password hashing */
export function serviceConfig(config, g, env = {}) {
  const cfg = config.load({ SHEETS_SPREADSHEET_ID: g.sheets.create('HGI test'), SESSION_SECRET: crypto.randomBytes(32).toString('hex'), PASSWORD_PEPPER: crypto.randomBytes(32).toString('hex'),
    HGI_ALLOW_TEST_LOGIN: '1', SHEETS_MISS_RELOAD_MS: '0', SIGNUP_PER_MINUTE: '10000', LOGIN_PER_MINUTE: '10000', ...env });
  cfg.endpoints = g.endpoints();
  cfg.scryptParams = { N: 1024, r: 8, p: 1, maxmem: 64 * 1024 * 1024 };
  return cfg;
}

/** fills the sign-in screen for this account (does not press the button) */
export async function fillSignIn(page, email, { password = TEST_PASSWORD, mode } = {}) {
  const user = usernameOf(email);
  const m = mode || (created.has(user) ? 'login' : 'signup');
  await page.waitForSelector('#signin-screen #si-go', { timeout: 30000 });
  await page.click(m === 'signup' ? '#si-tab-signup' : '#si-tab-login');
  await page.waitForSelector(m === 'signup' ? '#si-pass2' : '#si-form:not(:has(#si-pass2))', { timeout: 10000 });
  if (!(await page.getAttribute('#si-user', 'readonly'))) await page.fill('#si-user', user);
  await page.fill('#si-pass', password);
  if (m === 'signup') await page.fill('#si-pass2', password);
  created.add(user);
  return user;
}
