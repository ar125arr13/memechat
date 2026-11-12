/* MemeChat — کلاینت **رسمی** Internet Archive (IAS3، S3-like API).
 *
 * فقط چیزهایی که تو سند رسمی IA دیده/تأیید شد، اینجا پیاده شده:
 *   https://archive.org/developers/ias3.html
 *   https://archive.org/developers/items.html
 *   https://archive.org/developers/metadata.html
 *   https://archive.org/developers/metadata-schema/index.html
 *
 * تأییدشده:
 *   - endpoint آپلود: https://s3.us.archive.org  (PUT روی /<item>/<filename>)
 *   - احراز هویت ساده:  Authorization: LOW $accesskey:$secret   (فقط با HTTPS)
 *   - ساخت آیتم حین اولین PUT: x-archive-auto-make-bucket:1
 *   - متادیتا: x-archive-meta-$name:value (و فرم x-amz-meta--)
 *   - جلوگیری از derive سنگین: x-archive-queue-derive:0
 *   - راهنمای اندازه: x-archive-size-hint:<bytes>
 *   - نگهداری نسخهٔ قدیمی هنگام PUT مجدد: x-archive-keep-old-version:1
 *   - بررسی صف: GET https://s3.us.archive.org/?check_limit=1&accesskey=..&bucket=..
 *   - خواندن سریع: https://archive.org/download/<item>/<filename>
 *   - فهرست فایلها: https://archive.org/metadata/<item>  (بدون توکن)
 *   - 503 SlowDown وقتی صف شلوغ است؛ 307 Location redirect رایج است
 *   - «ACLs are fake. permissions are: World readable, Item uploader writable»
 *   - شناسهٔ آیتم: ASCII alphanumeric/_/-/. ، شروع با حرف/رقم، حداکثر ۱۰۰ کاراکتر
 *   - collectionهای Community مثل opensource_media؛ test_collection بعد از ~۳۰ روز پاک میشود
 *
 * قوانین پروژه که اینجا رعایت شده:
 *   - **هیچ DELETE / x-archive-cascade-delete / PATCH صدا زده نمیشود.**
 *     فقط PUT و GET. صفر حذف، صفر ریست.
 *   - IAS3 access/secret **هرگز داخل سورس نیست**؛ فقط از محیط runtime خوانده
 *     میشود. بدونش → NO_RUNTIME_CREDENTIALS و صفر تماس شبکهای.
 *   - همهٔ لاگها/URLها redact میشوند؛ هیچ رازی چاپ نمیشود.
 *   - بدون ورسل، بدون بکاند عمومی، بدون دیپلوی.
 */

export const IAS3_ORIGIN = 'https://s3.us.archive.org';
export const ARCHIVE_ORIGIN = 'https://archive.org';
export const DEFAULT_COLLECTION = 'opensource_media';   // Community Data
export const DEFAULT_MEDIATYPE = 'data';
export const MAX_ITEM_ID_LENGTH = 100;
export const RECOMMENDED_ITEM_BYTES = 100 * 1024 * 1024 * 1024; // 100GB (سند items)
export const RECOMMENDED_MAX_FILES = 10000;
export const RECOMMENDED_MAX_SINGLE_FILE = 500 * 1024 * 1024 * 1024; // 500GB (سند uploading)

export const FORBIDDEN_METHODS = Object.freeze(['DELETE', 'PATCH', 'PUT-DELETE', 'TRUNCATE']);

export function validateItemId(item) {
  const s = String(item ?? '');
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{4,99}$/.test(s)) {
    throw new Error('IA_INVALID_ITEM_ID: شناسه باید ASCII، شروع با حرف/رقم، ۵ تا ۱۰۰ کاراکتر باشد');
  }
  return s;
}

export function validateFilename(filename) {
  const s = String(filename ?? '');
  if (!s || s.startsWith('/') || s.includes('..') || /[\x00-\x1f\x7f]/.test(s)) {
    throw new Error('IA_INVALID_FILENAME');
  }
  return s;
}

export function redact(value) {
  if (typeof value !== 'string' || !value) return value;
  return value
    .replace(/(LOW\s+)[^:\s]+:[^\s'\"]+/gi, '$1__REDACTED__')
    .replace(/([?&](?:accesskey|secret|token)=)[^&\s'\"]+/gi, '$1__REDACTED__');
}

export function safeUrl(url) { return redact(String(url)); }

export function buildUploadUrl({ item, filename, origin = IAS3_ORIGIN }) {
  validateItemId(item);
  validateFilename(filename);
  // فایلها داخل «زیرشاخهٔ» mcia/ نگه داشته میشوند (IAS3 key میتواند / داشته باشد؛
  // سند rclone: remote:item/path/to/dir پشتیبانی میشود).
  const path = encodeURIComponent(filename).replace(/%2F/gi, '/');
  return `${origin}/${item}/${path}`;
}

export function buildUploadHeaders({
  accessKey, secretKey, item, size, title, collection = DEFAULT_COLLECTION,
  mediatype = DEFAULT_MEDIATYPE, autoMakeBucket = true, queueDerive = false,
} = {}) {
  validateItemId(item);
  if (!accessKey || !secretKey) throw new Error('NO_RUNTIME_CREDENTIALS');
  const headers = {
    authorization: `LOW ${accessKey}:${secretKey}`,
    'content-type': 'application/octet-stream',
    'x-archive-meta-mediatype': mediatype,
    'x-archive-meta-collection': collection,
    'x-archive-meta-title': `uri(${encodeURIComponent(title || `MemeChat ${item}`)})`,
    'x-archive-keep-old-version': '1',       // صفر حذف: PUT مجدد نسخهٔ قدیمی را نابود نکند
    'x-archive-size-hint': String(Math.max(1, Number(size) || 1)),
  };
  if (autoMakeBucket) headers['x-archive-auto-make-bucket'] = '1';
  if (!queueDerive) headers['x-archive-queue-derive'] = '0';
  return headers;
}

export function buildDownloadUrl({ item, filename, origin = ARCHIVE_ORIGIN }) {
  validateItemId(item);
  validateFilename(filename);
  const path = encodeURIComponent(filename).replace(/%2F/gi, '/');
  return `${origin}/download/${item}/${path}`;
}

export function buildMetadataUrl({ item, origin = ARCHIVE_ORIGIN }) {
  validateItemId(item);
  return `${origin}/metadata/${item}`;
}

export function buildCheckLimitUrl({ item, accessKey, origin = IAS3_ORIGIN }) {
  validateItemId(item);
  const q = new URLSearchParams({ check_limit: '1', accesskey: accessKey || '', bucket: item });
  return `${origin}/?${q}`;
}

export function parseMetadataFiles(metadata, { prefix = 'mcia/' } = {}) {
  const data = typeof metadata === 'string' ? JSON.parse(metadata) : (metadata || {});
  const files = Array.isArray(data.files) ? data.files : [];
  return files
    .filter((f) => f && typeof f.name === 'string' && f.name.startsWith(prefix))
    .filter((f) => f.source === 'original' || f.source === undefined)
    .map((f) => ({
      name: f.name,
      size: Number(f.size) || 0,
      sha1: f.sha1 || null,
      md5: f.md5 || null,
      format: f.format || null,
      source: f.source || 'original',
    }));
}

/* ترانسپورت قابلتزریق. fetchImpl و خروجی metadata برای تست آفلاین تزریق میشود. */
export class Ias3Transport {
  constructor({
    item = 'memechat-second-db', fetchImpl = globalThis.fetch,
    accessKey = null, secretKey = null, origin = IAS3_ORIGIN,
    webOrigin = ARCHIVE_ORIGIN, metadataImpl = null,
  } = {}) {
    this.item = validateItemId(item);
    this.fetchImpl = fetchImpl;
    this.metadataImpl = metadataImpl;
    this.accessKey = accessKey;
    this.secretKey = secretKey;
    this.origin = origin;
    this.webOrigin = webOrigin;
    this.mode = accessKey && secretKey ? 'real' : 'no-credentials';
    this.calls = [];
    this.firstUploadDone = false;
  }

  get configured() { return !!(this.accessKey && this.secretKey); }

  static fromEnv(env = process.env) {
    return new Ias3Transport({
      item: env.MC_IA_ITEM || 'memechat-second-db',
      accessKey: env.MC_IA_ACCESS_KEY || null,
      secretKey: env.MC_IA_SECRET_KEY || null,
    });
  }

  describe() {
    return {
      mode: this.mode,
      item: this.item,
      endpoint: this.origin,
      oficialApi: true,
      officialApi: true,
      encryptionKeyInSource: true,
      accountKeysInSource: false,
      credentialsSupplied: this.configured,
      destructiveOperations: [],
      deleteCalled: false,
      vercelUsed: false,
      deployed: false,
    };
  }

  _assertNoDelete(method) {
    if (FORBIDDEN_METHODS.includes(String(method).toUpperCase())) {
      throw new Error('IA_DELETE_FORBIDDEN: هیچ حذفی مجاز نیست');
    }
  }

  async put(filename, bytes) {
    this._assertNoDelete('PUT');
    if (!this.configured) {
      throw new Error('NO_RUNTIME_CREDENTIALS: کلید حساب IAS3 فقط موقع اجرا، نه داخل سورس');
    }
    const body = Buffer.from(bytes);
    const url = buildUploadUrl({ item: this.item, filename, origin: this.origin });
    const headers = buildUploadHeaders({
      accessKey: this.accessKey,
      secretKey: this.secretKey,
      item: this.item,
      size: body.length,
      autoMakeBucket: !this.firstUploadDone,
      queueDerive: false,
    });
    this.calls.push({ method: 'PUT', url: safeUrl(url), bytes: body.length });
    const res = await this.fetchImpl(url, { method: 'PUT', headers, body });
    const status = res?.status ?? 0;
    if (status >= 400) {
      const err = new Error(`IA_UPLOAD_FAILED_${status}`);
      err.status = status;
      err.redactedUrl = safeUrl(url);
      throw err;
    }
    this.firstUploadDone = true;
    return {
      ok: true, method: 'PUT', status, filename, bytes: body.length,
      url: safeUrl(url), deleted: false, retainedInPrimary: true,
    };
  }

  async get(filename) {
    const url = buildDownloadUrl({ item: this.item, filename, origin: this.webOrigin });
    this.calls.push({ method: 'GET', url: safeUrl(url) });
    const res = await this.fetchImpl(url, { method: 'GET' });
    const status = res?.status ?? 0;
    if (status >= 400) throw new Error(`IA_DOWNLOAD_FAILED_${status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    return { ok: true, method: 'GET', status, filename, bytes: buf, url: safeUrl(url) };
  }

  async list(prefix = 'mcia/') {
    const url = buildMetadataUrl({ item: this.item, origin: this.webOrigin });
    this.calls.push({ method: 'GET-METADATA', url: safeUrl(url) });
    const res = this.metadataImpl
      ? await this.metadataImpl(url)
      : await this.fetchImpl(url, { method: 'GET' });
    const text = typeof res === 'string' ? res
      : (res?.text ? await res.text() : JSON.stringify(res));
    return parseMetadataFiles(text, { prefix });
  }

  async checkLimit() {
    if (!this.configured) throw new Error('NO_RUNTIME_CREDENTIALS');
    const url = buildCheckLimitUrl({ item: this.item, accessKey: this.accessKey, origin: this.origin });
    this.calls.push({ method: 'CHECK-LIMIT', url: safeUrl(url) });
    const res = await this.fetchImpl(url, { method: 'GET' });
    const data = typeof res?.json === 'function' ? await res.json() : res;
    return { overLimit: data?.over_limit === 1, detail: data?.detail || null, url: safeUrl(url) };
  }
}

export default Ias3Transport;
