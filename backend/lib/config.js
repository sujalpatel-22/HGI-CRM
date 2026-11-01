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
  const json = (name, v) => { if (!v) return undefined; try { return JSON.parse(v); } catch (e) { problems.push(`${name} must be JSON`); return undefined; } };
  const cfg = {
    port: Number(env.PORT) || 8080,
    onCloudRun,
    // OAuth client IDs whose Google ID tokens are accepted (the "Web application" client used as serverClientId by the app,
    // plus the same one for the browser account-deletion page). Public values, not secrets.
    googleClientIds: list(env.GOOGLE_CLIENT_IDS),
    sessionSecret: env.SESSION_SECRET || '',
    sessionDays: Number(env.SESSION_DAYS) || 180,
    projectId: env.PROJECT_ID || env.GOOGLE_CLOUD_PROJECT || '',
    firestoreEmulator: env.FIRESTORE_EMULATOR_HOST || '',
    // Google API access for Firestore + Cloud Storage: 'metadata' = Cloud Run's own service account (no key file, recommended),
    // 'sa-key' = a service-account JSON key in SA_KEY_JSON (Secret Manager) for running elsewhere
    gcpAuth: env.GCP_AUTH || 'metadata',
    saKeyJson: env.SA_KEY_JSON || '',
    filesBucket: env.FILES_BUCKET || '',
    gst: { url: env.GST_API_URL || '', headers: json('GST_API_HEADERS', env.GST_API_HEADERS) || {}, authUrl: env.GST_API_AUTH_URL || '',
      authHeaders: json('GST_API_AUTH_HEADERS', env.GST_API_AUTH_HEADERS) || {}, authBody: json('GST_API_AUTH_BODY', env.GST_API_AUTH_BODY) || {},
      tokenPath: env.GST_API_TOKEN_PATH || '', tokenHeader: env.GST_API_TOKEN_HEADER || '', name: env.GST_API_NAME || '' },
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
      metadata: env.GOOGLE_METADATA_URL || 'http://metadata.google.internal/computeMetadata/v1/instance/service-accounts/default/token',
      firestore: env.FIRESTORE_API || 'https://firestore.googleapis.com',
      storage: env.STORAGE_API || 'https://storage.googleapis.com'
    }
  };
  const overridden = ['GOOGLE_CERTS_URL', 'GOOGLE_TOKEN_URL', 'GOOGLE_METADATA_URL', 'FIRESTORE_API', 'STORAGE_API', 'FIRESTORE_EMULATOR_HOST'].filter(k => env[k]);
  if (onCloudRun && (cfg.allowTestLogin || overridden.length)) problems.push(`Test settings are not allowed on Cloud Run: ${['HGI_ALLOW_TEST_LOGIN', ...overridden].filter(k => env[k]).join(', ')}`);
  if (!cfg.googleClientIds.length && !cfg.allowTestLogin) problems.push('GOOGLE_CLIENT_IDS is required (the OAuth "Web application" client ID)');
  if (Buffer.byteLength(cfg.sessionSecret) < 32) problems.push('SESSION_SECRET must be at least 32 characters (keep it in Secret Manager)');
  if (!cfg.projectId) problems.push('PROJECT_ID is required (the Google Cloud project that holds the Firestore database)');
  if (!['metadata', 'sa-key'].includes(cfg.gcpAuth)) problems.push('GCP_AUTH must be metadata or sa-key');
  if (cfg.gcpAuth === 'sa-key' && !cfg.saKeyJson) problems.push('GCP_AUTH=sa-key needs SA_KEY_JSON');
  if (cfg.gst.url && !/^https:\/\//.test(cfg.gst.url) && !cfg.allowTestLogin) problems.push('GST_API_URL must be https');
  if (problems.length) throw new Error('Configuration problems:\n  - ' + problems.join('\n  - '));
  return cfg;
}

module.exports = { load };
