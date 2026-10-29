'use strict';
/**
 * Configuration from environment variables (Cloud Run: set with --set-env-vars / --set-secrets).
 * Nothing secret is ever sent to the Android app: the app only knows the public backend URL and the
 * public OAuth "web client ID".
 */

const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

function load(env = process.env) {
  const onCloudRun = !!env.K_SERVICE;
  const problems = [];
  const cfg = {
    port: Number(env.PORT) || 8080,
    onCloudRun,
    // OAuth client IDs whose Google ID tokens are accepted (the "Web application" client used as serverClientId by the app,
    // plus the same one for the browser account-deletion page). Public values, not secrets.
    googleClientIds: list(env.GOOGLE_CLIENT_IDS),
    sessionSecret: env.SESSION_SECRET || '',
    sessionDays: Number(env.SESSION_DAYS) || 180,
    driveFolderId: env.DRIVE_FOLDER_ID || '',
    // how the backend gets Google API access to the company Drive:
    //   metadata      — Cloud Run's own service account (no key file). Needs a Shared Drive (Google Workspace).
    //   sa-key        — a service-account JSON key in SA_KEY_JSON (Secret Manager). Also needs a Shared Drive.
    //   owner-oauth   — the HGI Google account's refresh token (OWNER_CLIENT_ID / OWNER_CLIENT_SECRET / OWNER_REFRESH_TOKEN),
    //                   for a normal Gmail account where files must be owned by a person.
    driveAuth: env.DRIVE_AUTH || 'metadata',
    saKeyJson: env.SA_KEY_JSON || '',
    owner: { clientId: env.OWNER_CLIENT_ID || '', clientSecret: env.OWNER_CLIENT_SECRET || '', refreshToken: env.OWNER_REFRESH_TOKEN || '' },
    shareWith: list(env.SHARE_WITH),               // optional: extra Google accounts given edit access to every new sheet
    allowedOrigins: list(env.ALLOWED_ORIGINS || 'https://localhost,capacitor://localhost,http://localhost'),
    publicUrl: (env.PUBLIC_URL || '').replace(/\/$/, ''),
    supportEmail: env.SUPPORT_EMAIL || '',
    maxBodyBytes: Number(env.MAX_BODY_MB || 25) * 1024 * 1024,
    trustProxy: onCloudRun || env.TRUST_PROXY === '1',
    // test hooks — refused on Cloud Run, so a production deployment can never accept fake identities or fake Google
    allowTestLogin: env.HGI_ALLOW_TEST_LOGIN === '1',
    endpoints: {
      certs: env.GOOGLE_CERTS_URL || 'https://www.googleapis.com/oauth2/v3/certs',
      token: env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token',
      drive: env.GOOGLE_DRIVE_API || 'https://www.googleapis.com/drive/v3',
      sheets: env.GOOGLE_SHEETS_API || 'https://sheets.googleapis.com/v4',
      metadata: env.GOOGLE_METADATA_URL || 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token'
    }
  };
  const overridden = ['GOOGLE_CERTS_URL', 'GOOGLE_TOKEN_URL', 'GOOGLE_DRIVE_API', 'GOOGLE_SHEETS_API', 'GOOGLE_METADATA_URL'].filter(k => env[k]);
  if (onCloudRun && (cfg.allowTestLogin || overridden.length)) problems.push(`Test settings are not allowed on Cloud Run: ${['HGI_ALLOW_TEST_LOGIN', ...overridden].filter(k => env[k]).join(', ')}`);
  if (!cfg.googleClientIds.length && !cfg.allowTestLogin) problems.push('GOOGLE_CLIENT_IDS is required (the OAuth "Web application" client ID)');
  if (Buffer.byteLength(cfg.sessionSecret) < 32) problems.push('SESSION_SECRET must be at least 32 characters (keep it in Secret Manager)');
  if (!cfg.driveFolderId) problems.push('DRIVE_FOLDER_ID is required (the company Drive folder that holds the customer spreadsheets)');
  if (!['metadata', 'sa-key', 'owner-oauth'].includes(cfg.driveAuth)) problems.push('DRIVE_AUTH must be metadata, sa-key or owner-oauth');
  if (cfg.driveAuth === 'sa-key' && !cfg.saKeyJson) problems.push('DRIVE_AUTH=sa-key needs SA_KEY_JSON');
  if (cfg.driveAuth === 'owner-oauth' && !(cfg.owner.clientId && cfg.owner.clientSecret && cfg.owner.refreshToken)) problems.push('DRIVE_AUTH=owner-oauth needs OWNER_CLIENT_ID, OWNER_CLIENT_SECRET and OWNER_REFRESH_TOKEN');
  if (problems.length) throw new Error('Configuration problems:\n  - ' + problems.join('\n  - '));
  return cfg;
}

module.exports = { load };
