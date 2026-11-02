'use strict';
/**
 * Configuration from environment variables (Cloud Run: set with --set-env-vars / --set-secrets).
 * Nothing secret is ever sent to the Android app: the app only knows the public backend URL and the
 * public OAuth "web client ID".
 */

const list = v => String(v || '').split(',').map(s => s.trim()).filter(Boolean);

// NIC API paths (v1.03 / auth v1.04). A GSP's NIC-identical pass-through usually keeps them; override with IRP_PATH_* / EWB_PATH_*.
const DEFAULT_IRP_PATHS = {
  auth: '/eivital/v1.04/auth', gstin: '/eivital/v1.03/Master/gstin/{gstin}', generate: '/eicore/v1.03/Invoice', cancel: '/eicore/v1.03/Invoice/Cancel',
  getByIrn: '/eicore/v1.03/Invoice/irn/{irn}', getByDoc: '/eicore/v1.03/Invoice/irnbydocdetails?doctype={doctype}&docnum={docnum}&docdate={docdate}',
  ewbGenerate: '/eiewb/v1.03/ewaybill', ewbGetByIrn: '/eiewb/v1.03/ewaybill/irn/{irn}', ewbCancel: '/ewaybillapi/v1.03/ewayapi'
};
const DEFAULT_EWB_PATHS = { auth: '/ewaybillapi/v1.03/auth', action: '/ewaybillapi/v1.03/ewayapi', get: '/ewaybillapi/v1.03/ewayapi/GetEwayBill?ewbNo={ewbNo}' };
const LOCAL = /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?(\/|$)/;

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
    edoc: null,
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
  /* ---------------------------------------------- e-invoice / e-way bill (government APIs through HGI's GSP) */
  const paths = (prefix, defaults) => Object.fromEntries(Object.entries(defaults).map(([k, v]) => [k, env[`${prefix}_PATH_${k.replace(/[A-Z]/g, m => '_' + m).toUpperCase()}`] || v]));
  const pem = v => String(v || '').replace(/\\n/g, '\n').trim();
  const credKey = env.EDOC_CRED_KEY ? Buffer.from(env.EDOC_CRED_KEY, 'base64') : null;
  cfg.edoc = {
    env: env.EDOC_ENV || 'sandbox',
    credKey,
    irp: { baseUrl: (env.IRP_BASE_URL || '').replace(/\/+$/, ''), clientId: env.IRP_CLIENT_ID || '', clientSecret: env.IRP_CLIENT_SECRET || '', publicKey: pem(env.IRP_PUBLIC_KEY),
      extraHeaders: json('IRP_EXTRA_HEADERS', env.IRP_EXTRA_HEADERS) || {}, authPayload: env.IRP_AUTH_PAYLOAD || 'base64json', paths: paths('IRP', DEFAULT_IRP_PATHS) },
    ewb: { baseUrl: (env.EWB_BASE_URL || '').replace(/\/+$/, ''), clientId: env.EWB_CLIENT_ID || '', clientSecret: env.EWB_CLIENT_SECRET || '', publicKey: pem(env.EWB_PUBLIC_KEY),
      extraHeaders: json('EWB_EXTRA_HEADERS', env.EWB_EXTRA_HEADERS) || {}, appKeyRsaInput: env.EWB_APPKEY_RSA_INPUT || 'raw', dataEncoding: env.EWB_DATA_ENCODING || 'json', paths: paths('EWB', DEFAULT_EWB_PATHS) }
  };
  const ed = cfg.edoc;
  if (!['sandbox', 'production', 'test'].includes(ed.env)) problems.push('EDOC_ENV must be sandbox or production');
  if (credKey && credKey.length !== 32) problems.push('EDOC_CRED_KEY must be 32 random bytes, base64 (keep it in Secret Manager)');
  for (const [name, c] of [['IRP', ed.irp], ['EWB', ed.ewb]]) {
    if (!c.baseUrl) continue;
    if (ed.env === 'test') { if (!cfg.allowTestLogin || !LOCAL.test(c.baseUrl)) problems.push(`EDOC_ENV=test is only for the local protocol simulator in automated tests (${name}_BASE_URL on localhost + HGI_ALLOW_TEST_LOGIN=1)`); }
    else { if (!/^https:\/\//.test(c.baseUrl)) problems.push(`${name}_BASE_URL must use https`); if (LOCAL.test(c.baseUrl.replace(/^https/, 'http'))) problems.push(`${name}_BASE_URL points to this computer but EDOC_ENV=${ed.env}`); }
    if (!c.clientId || !c.clientSecret || !c.publicKey) problems.push(`${name}_BASE_URL is set, so ${name}_CLIENT_ID, ${name}_CLIENT_SECRET and ${name}_PUBLIC_KEY are required too`);
  }
  if (ed.env === 'production' && env.EDOC_CONFIRM_PRODUCTION !== 'I-UNDERSTAND')
    problems.push('EDOC_ENV=production reports legally valid documents to the GST system. Set EDOC_CONFIRM_PRODUCTION=I-UNDERSTAND only after the sandbox tests passed and production access was approved.');
  if ((ed.irp.baseUrl || ed.ewb.baseUrl) && !credKey) problems.push('EDOC_CRED_KEY is required when IRP_BASE_URL / EWB_BASE_URL is set (it encrypts each business\'s API login)');
  if (onCloudRun && ed.env === 'test') problems.push('EDOC_ENV=test is not allowed on Cloud Run');

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

module.exports = { load, DEFAULT_IRP_PATHS, DEFAULT_EWB_PATHS };
