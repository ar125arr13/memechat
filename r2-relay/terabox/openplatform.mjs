/* MemeChat — سازندهٔ درخواستهای **Open Platform رسمی TeraBox**.
 *
 * منبع تمام endpointها و پارامترها، سند رسمی خود TeraBox است (۱۲ بخش خوانده شد):
 *   https://www.terabox.com/integrations/docs
 * صفحهٔ معرفی (فقط «Contact us» / «customized API solution»): 
 *   https://www.terabox.com/integrations
 * شرایط استفاده (۲۰۲۶-۰۹-۱۷):
 *   https://www.terabox.com/terms/duty
 *
 * تأیید زنده و بدون هیچگونه رمز/حساب (فقط GET با مقدار نامعتبر):
 *   GET /oauth/devicecode?client_id=ARENA_INVALID_TEST_ONLY
 *     → {"errno":100001,...,"show_msg":"unknown client"}
 *   GET /oauth/tokeninfo?access_token=ARENA_INVALID_TEST_ONLY
 *     → {"errno":200002,...,"show_msg":"invalid access_token"}
 * یعنی endpointها واقعی و زندهاند، ولی بدون client_id تأییدشده کاری نمیکنند.
 *
 * این فایل **فقط درخواست میسازد**؛ هیچ شبکهای صدا نمیزند، هیچ رازی ندارد،
 * و ادعا نمیکند حسابی لاگین شده است. کلید اپ و توکنها فقط موقع اجرا از محیط
 * خوانده میشوند و هرگز داخل سورس/فرانتاند/لاگ نیستند.
 *
 * قوانین پروژه که اینجا رعایت شده:
 *   - صفر حذف/ریست: opera=delete، rtype=3 (overwrite)، DELETE/PATCH ممنوعاند.
 *   - فقط رابط «publicly supported» رسمی؛ هیچ endpoint مهندسیمعکوس/ndus/کوکی
 *     مرورگر، هیچ scraping، هیچ ساخت حساب انبوه، هیچ دور زدن سقف فضا.
 *   - دو حساب = دو توکن مستقل؛ سهمیهها با هم جمع نمیشوند (ToS صریحاً
 *     «circumvent storage space limits» را ممنوع کرده است).
 */

import { createHash } from 'node:crypto';

export const DOCS_URL = 'https://www.terabox.com/integrations/docs';
export const INTEGRATIONS_URL = 'https://www.terabox.com/integrations';
export const TOS_URL = 'https://www.terabox.com/terms/duty';
export const OAUTH_ORIGIN = 'https://www.terabox.com';
export const DEFAULT_API_DOMAIN = 'www.terabox.com';
export const DEFAULT_UPLOAD_DOMAIN = 'c-jp.terabox.com';
export const APP_ID_FIXED = 250528;                    // سند ۳.۴.۲: ثابت
export const APP_ROOT_PREFIX = '/From: Other Applications/'; // سند ۳.۱.۳
export const ACCESS_TOKEN_TTL_SECONDS = 172800;       // ۲ روز
export const REFRESH_TOKEN_TTL_SECONDS = 2592000;     // ۳۰ روز
export const PREVIOUS_TOKEN_GRACE_SECONDS = 15;       // بعد از refresh، ۱۵ ثانیه
export const MIN_SHARD_BYTES = 4 * 1024 * 1024;       // چند تکه → هر تکه > ۴MB
export const DEVICE_CODE_EXAMPLE_SECONDS = 300;
export const OAUTH_ERRORS = Object.freeze({
  2: 'پارامتر لازم کم است',
  100001: 'client_id/client_secret نامعتبر (unknown client)',
  100002: 'code نامعتبر یا منقضی',
  200001: 'grant_type پشتیبانی نمیشود',
  200002: 'access_token نامعتبر',
  200003: 'access_token منقضی شده',
  200004: 'refresh_token نامعتبر',
  200005: 'refresh_token منقضی شده',
  300001: 'تعداد درخواست تبادل code زیاد است',
  400001: 'کاربر هنوز device_code را تأیید نکرده',
  500001: 'خطای داخلی سرویس',
});

export const ENV_KEYS = Object.freeze({
  clientId: 'MC_TERABOX_CLIENT_ID',
  clientSecret: 'MC_TERABOX_CLIENT_SECRET',
  privateSecret: 'MC_TERABOX_PRIVATE_SECRET',
});

/* سند ۱.۴.۲.۱: sign = md5(client_id_timestamp_client_secret_private_secret) */
export function buildSign({ clientId, clientSecret, privateSecret, timestamp }) {
  if (!clientId || !clientSecret || !privateSecret || !timestamp) {
    throw new Error('TERABOX_SIGN_MISSING_PARAMS');
  }
  const message = `${clientId}_${timestamp}_${clientSecret}_${privateSecret}`;
  return createHash('md5').update(message, 'utf8').digest('hex');
}

export function buildAuthorizationUrl({ clientId, isFromApp = false, origin = OAUTH_ORIGIN } = {}) {
  if (!clientId) throw new Error('TERABOX_MISSING_CLIENT_ID');
  const u = new URL('/wap/outside/login', origin);
  u.searchParams.set('clientId', clientId);
  if (isFromApp) u.searchParams.set('isFromApp', '1');
  return u.toString();
}

export function buildDeviceCodeUrl({ clientId, origin = OAUTH_ORIGIN } = {}) {
  if (!clientId) throw new Error('TERABOX_MISSING_CLIENT_ID');
  const u = new URL('/oauth/devicecode', origin);
  u.searchParams.set('client_id', clientId);
  return u.toString();
}

function tokenForm({ clientId, clientSecret, privateSecret, timestamp, fields = {} }) {
  if (!clientId || !clientSecret || !privateSecret) throw new Error('TERABOX_NO_APP_CREDENTIALS');
  const ts = String(timestamp ?? Math.floor(Date.now() / 1000));
  const form = new FormData();
  form.set('client_id', clientId);
  form.set('client_secret', clientSecret);
  form.set('timestamp', ts);
  for (const [k, v] of Object.entries(fields)) form.set(k, String(v));
  form.set('sign', buildSign({ clientId, clientSecret, privateSecret, timestamp: ts }));
  return form;
}

/* سند ۱.۴.۲.۱ — POST /oauth/gettoken (form-data در مثالهای رسمی) */
export function buildTokenForm({ clientId, clientSecret, privateSecret, code,
  grantType = 'authorization_code', timestamp } = {}) {
  if (!code) throw new Error('TERABOX_MISSING_CODE');
  if (!['authorization_code', 'device_code'].includes(grantType)) {
    throw new Error('TERABOX_UNSUPPORTED_GRANT_TYPE');
  }
  return tokenForm({
    clientId, clientSecret, privateSecret, timestamp,
    fields: { grant_type: grantType, code },
  });
}

/* سند ۱.۴.۲.۳ — POST /oauth/refreshtoken */
export function buildRefreshForm({ clientId, clientSecret, privateSecret,
  refreshToken, timestamp } = {}) {
  if (!refreshToken) throw new Error('TERABOX_MISSING_REFRESH_TOKEN');
  return tokenForm({
    clientId, clientSecret, privateSecret, timestamp,
    fields: { refresh_token: refreshToken },
  });
}

/* سند ۱.۴.۲.۲ — POST /oauth/tokeninfo */
export function buildTokenInfoForm({ accessToken } = {}) {
  if (!accessToken) throw new Error('TERABOX_MISSING_ACCESS_TOKEN');
  const form = new FormData();
  form.set('access_token', accessToken);
  return form;
}

export function normalizeOrigin(domain, fallback = DEFAULT_API_DOMAIN) {
  const d = String(domain || fallback).trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '');
  if (!/^[A-Za-z0-9.-]+$/.test(d) || d.includes('..')) {
    throw new Error('TERABOX_INVALID_API_DOMAIN');
  }
  return `https://${d}`;
}

export function assertSafePath(p) {
  const s = String(p ?? '');
  /* سند ۳.۱.۳: تمام عملیات فایل فقط داخل فضای اختصاصیافته به اپ مجاز است.
   * مثالهای ۳.۴.۵ از dir=/ استفاده کردهاند؛ محافظهکارانه پیشوند اپ اجبار میشود
   * و پیش از استفادهٔ واقعی باید با TeraBox تأیید شود. */
  if (!s.startsWith(APP_ROOT_PREFIX)) throw new Error('TERABOX_PATH_OUTSIDE_APP_ROOT');
  if (s.includes('..') || /[\x00-\x1f\x7f]/.test(s)) throw new Error('TERABOX_INVALID_PATH');
  return s;
}

export const FORBIDDEN_OPERATIONS = Object.freeze([
  'DELETE', 'PATCH', 'opera=delete', 'rtype=3', 'TRUNCATE', 'DROP',
]);

export function assertNoDestructive({ method = 'GET', url = '' } = {}) {
  const m = String(method).toUpperCase();
  if (!['GET', 'POST'].includes(m)) throw new Error('TERABOX_DESTRUCTIVE_BLOCKED');
  const lowered = String(url).toLowerCase();
  if (m !== 'GET' && m !== 'POST') throw new Error('TERABOX_DESTRUCTIVE_BLOCKED');
  if (lowered.includes('opera=delete') || lowered.includes('rtype=3') ||
      lowered.includes('truncate') || lowered.includes('cascade-delete')) {
    throw new Error('TERABOX_DESTRUCTIVE_BLOCKED');
  }
  return true;
}

function apiUrl({ apiDomain, pathname, params = {} }) {
  const u = new URL(pathname, normalizeOrigin(apiDomain));
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') u.searchParams.set(k, String(v));
  }
  return u.toString();
}

export function buildUinfoUrl({ accessToken, apiDomain }) {
  return apiUrl({ apiDomain, pathname: '/openapi/uinfo', params: { access_tokens: accessToken } });
}
export function buildQuotaUrl({ accessToken, apiDomain }) {
  return apiUrl({ apiDomain, pathname: '/openapi/api/quota', params: { access_tokens: accessToken } });
}
export function buildPrecreateUrl({ accessToken, apiDomain }) {
  return apiUrl({ apiDomain, pathname: '/openapi/api/precreate', params: { access_tokens: accessToken } });
}
export function buildCreateUrl({ accessToken, apiDomain }) {
  return apiUrl({ apiDomain, pathname: '/openapi/api/create', params: { access_tokens: accessToken } });
}
export function buildListUrl({ accessToken, apiDomain, dir, page = 1, num = 100, order = 'time', desc = 1 }) {
  assertSafePath(dir);
  return apiUrl({ apiDomain, pathname: '/openapi/api/list',
    params: { access_tokens: accessToken, dir, page, num, order, desc } });
}
export function buildSearchUrl({ accessToken, apiDomain, key, recursion = 1, page = 1, num = 100 }) {
  return apiUrl({ apiDomain, pathname: '/openapi/api/search',
    params: { access_tokens: accessToken, key, recursion, page, num } });
}
export function buildDownloadUrl({ accessToken, apiDomain, fidlist, type = 'dlink' }) {
  return apiUrl({ apiDomain, pathname: '/openapi/api/download',
    params: { access_tokens: accessToken, fidlist: JSON.stringify(fidlist), type } });
}

/* سند ۳.۴.۱ — precreate: autoinit=1، block_list = JSON آرایهٔ MD5 تکهها */
export function buildPrecreateForm({ path, blockList, autoinit = 1 } = {}) {
  assertSafePath(path);
  if (!Array.isArray(blockList) || blockList.length === 0) throw new Error('TERABOX_EMPTY_BLOCK_LIST');
  const form = new URLSearchParams();
  form.set('path', path);
  form.set('autoinit', String(autoinit));
  form.set('block_list', JSON.stringify(blockList));
  return form;
}

/* سند ۳.۴.۲ — superfile2 روی upload_domain، app_id ثابت ۲۵۰۵۲۸ */
export function buildSuperfile2Url({ accessToken, uploadDomain, path, uploadid, partseq = 0 }) {
  assertSafePath(path);
  if (!uploadid) throw new Error('TERABOX_MISSING_UPLOADID');
  return apiUrl({ apiDomain: uploadDomain, pathname: '/rest/2.0/pcs/superfile2',
    params: {
      method: 'upload', app_id: APP_ID_FIXED, path, uploadid,
      partseq, access_tokens: accessToken,
    } });
}

/* سند ۳.۴.۳ — create: rtype=1 (rename هنگام تداخل)، نه ۳ (overwrite) */
export function buildCreateForm({ path, size, uploadid, blockList, rtype = 1 } = {}) {
  assertSafePath(path);
  if (Number(rtype) === 3) throw new Error('TERABOX_DESTRUCTIVE_BLOCKED');
  if (!Array.isArray(blockList) || blockList.length === 0) throw new Error('TERABOX_EMPTY_BLOCK_LIST');
  const form = new URLSearchParams();
  form.set('path', path);
  form.set('size', String(size));
  form.set('uploadid', uploadid);
  form.set('block_list', JSON.stringify(blockList));
  form.set('rtype', String(rtype));
  return form;
}

export function redact(value) {
  if (typeof value !== 'string' || !value) return value;
  return value
    .replace(/([?&](?:access_tokens?|refresh_token|client_secret|private_secret|sign|code|ndus|bdstoken|jsToken)=)[^&\s"']+/gi, '$1__REDACTED__')
    .replace(/(Cookie:\s*)[^\r\n]+/gi, '$1__REDACTED__')
    .replace(/(LOW\s+)[^:\s]+:[^\s"']+/gi, '$1__REDACTED__');
}

export function parseErrno(payload) {
  const data = typeof payload === 'string' ? JSON.parse(payload) : (payload || {});
  const errno = Number(data.errno ?? 0);
  return { errno, ok: errno === 0, show_msg: data.show_msg || '', message: OAUTH_ERRORS[errno] || '', data: data.data || null, raw: data };
}

export function describeOpenPlatform() {
  return {
    kind: 'terabox-open-platform',
    officialDocs: DOCS_URL,
    officialApi: true,
    selfService: false,
    appCredentialsFrom: 'TeraBox approval (vendor application / Contact us)',
    appCredentialsInSource: false,
    perAccountCredential: 'OAuth access_token + refresh_token',
    accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
    refreshTokenTtlSeconds: REFRESH_TOKEN_TTL_SECONDS,
    refreshTokenOneTimeUse: true,
    uploadSteps: ['/openapi/api/precreate', '/rest/2.0/pcs/superfile2', '/openapi/api/create'],
    appRootPrefix: APP_ROOT_PREFIX,
    destructiveOperations: [],
    quotaPooling: false,
    realLoginPerformed: false,
    realUploadPerformed: false,
    confidentiality: 'not-claimed',
  };
}
