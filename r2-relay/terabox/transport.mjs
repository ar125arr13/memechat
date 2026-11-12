/* MemeChat — ترانسپورت **رسمی** TeraBox Open Platform + یک fixture آفلاین.
 *
 * `TeraboxTransport` فقط زمانی شبکه صدا میزند که سه مقدار اپ تأییدشده
 * (MC_TERABOX_CLIENT_ID / MC_TERABOX_CLIENT_SECRET / MC_TERABOX_PRIVATE_SECRET)
 * در محیط runtime وجود داشته باشد. بدون آنها → خطای صریح و صفر تماس شبکهای.
 * هیچ توکن حساب، رمز عبور، OTP، کوکی ndus یا رازی داخل سورس نیست.
 *
 * `FixtureTerabox` همان API را بهصورت کاملاً آفلاین شبیهسازی میکند تا منطق
 * دو حساب، تبادل توکن، refresh یکبارمصرف و آپلود سهمرحلهای تست شود، بیآنکه
 * ادعای لاگین/آپلود واقعی شود.
 */

import { createHash } from 'node:crypto';
import {
  OAUTH_ORIGIN, ENV_KEYS, DEFAULT_API_DOMAIN, DEFAULT_UPLOAD_DOMAIN,
  buildAuthorizationUrl, buildDeviceCodeUrl, buildTokenForm, buildRefreshForm,
  buildTokenInfoForm, buildUinfoUrl, buildQuotaUrl, buildPrecreateUrl,
  buildCreateUrl, buildListUrl, buildSearchUrl, buildDownloadUrl,
  buildPrecreateForm, buildSuperfile2Url, buildCreateForm,
  assertNoDestructive, assertSafePath, redact, parseErrno, describeOpenPlatform,
} from './openplatform.mjs';

export class TeraboxTransport {
  static fromEnv(env = process.env) {
    return new TeraboxTransport({
      clientId: env[ENV_KEYS.clientId],
      clientSecret: env[ENV_KEYS.clientSecret],
      privateSecret: env[ENV_KEYS.privateSecret],
    });
  }

  constructor({ clientId, clientSecret, privateSecret, fetchImpl, oauthOrigin = OAUTH_ORIGIN } = {}) {
    this.clientId = clientId || '';
    this.clientSecret = clientSecret || '';
    this.privateSecret = privateSecret || '';
    this.fetchImpl = fetchImpl || globalThis.fetch;
    this.oauthOrigin = oauthOrigin;
    this.networkCalls = 0;
    this.deleteCalled = false;
    this.destructiveOperations = [];
    this.mode = 'official-open-platform';
  }

  hasCredentials() {
    return Boolean(this.clientId && this.clientSecret && this.privateSecret);
  }

  describe() {
    return {
      mode: this.mode,
      officialApi: true,
      selfService: false,
      docs: describeOpenPlatform().officialDocs,
      credentialsSupplied: this.hasCredentials(),
      credentialsInSource: false,
      networkCalls: this.networkCalls,
      deleteCalled: this.deleteCalled,
      destructiveOperations: [...this.destructiveOperations],
      realLoginPerformed: false,
      realUploadPerformed: false,
    };
  }

  authorizationUrl(opts = {}) {
    return buildAuthorizationUrl({ clientId: this.clientId, ...opts });
  }

  async request({ method = 'GET', url, form, headers = {}, requireAppCredentials = true } = {}) {
    assertNoDestructive({ method, url });
    if (requireAppCredentials && !this.hasCredentials()) {
      throw new Error('TERABOX_NO_APP_CREDENTIALS');
    }
    if (typeof this.fetchImpl !== 'function') throw new Error('TERABOX_NO_FETCH');
    const init = { method, headers: { ...headers } };
    if (form) init.body = form;
    this.networkCalls++;
    const res = await this.fetchImpl(url, init);
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); }
    catch { data = { errno: 0, raw: text }; }
    return data;
  }

  deviceCode({ clientId = this.clientId } = {}) {
    return this.request({ method: 'GET', url: buildDeviceCodeUrl({ clientId, origin: this.oauthOrigin }),
      requireAppCredentials: false });
  }

  getToken({ code, grantType = 'authorization_code', timestamp } = {}) {
    const form = buildTokenForm({ clientId: this.clientId, clientSecret: this.clientSecret,
      privateSecret: this.privateSecret, code, grantType, timestamp });
    return this.request({ method: 'POST', url: `${this.oauthOrigin}/oauth/gettoken`, form });
  }

  refreshToken({ refreshToken, timestamp } = {}) {
    const form = buildRefreshForm({ clientId: this.clientId, clientSecret: this.clientSecret,
      privateSecret: this.privateSecret, refreshToken, timestamp });
    return this.request({ method: 'POST', url: `${this.oauthOrigin}/oauth/refreshtoken`, form });
  }

  tokenInfo({ accessToken } = {}) {
    const form = buildTokenInfoForm({ accessToken });
    return this.request({ method: 'POST', url: `${this.oauthOrigin}/oauth/tokeninfo`, form,
      requireAppCredentials: false });
  }

  uinfo({ accessToken, apiDomain = DEFAULT_API_DOMAIN } = {}) {
    return this.request({ method: 'GET', url: buildUinfoUrl({ accessToken, apiDomain }) });
  }

  quota({ accessToken, apiDomain = DEFAULT_API_DOMAIN } = {}) {
    return this.request({ method: 'GET', url: buildQuotaUrl({ accessToken, apiDomain }) });
  }

  precreate({ accessToken, apiDomain = DEFAULT_API_DOMAIN, path, blockList } = {}) {
    const form = buildPrecreateForm({ path, blockList });
    return this.request({ method: 'POST', url: buildPrecreateUrl({ accessToken, apiDomain }), form });
  }

  uploadShard({ accessToken, uploadDomain = DEFAULT_UPLOAD_DOMAIN, path, uploadid, partseq = 0, bytes } = {}) {
    const url = buildSuperfile2Url({ accessToken, uploadDomain, path, uploadid, partseq });
    const form = new FormData();
    form.set('file', new Blob([bytes]), 'blob');
    return this.request({ method: 'POST', url, form });
  }

  createFile({ accessToken, apiDomain = DEFAULT_API_DOMAIN, path, size, uploadid, blockList, rtype = 1 } = {}) {
    const form = buildCreateForm({ path, size, uploadid, blockList, rtype });
    return this.request({ method: 'POST', url: buildCreateUrl({ accessToken, apiDomain }), form });
  }

  list({ accessToken, apiDomain = DEFAULT_API_DOMAIN, dir, page = 1, num = 100 } = {}) {
    return this.request({ method: 'GET', url: buildListUrl({ accessToken, apiDomain, dir, page, num }) });
  }

  search({ accessToken, apiDomain = DEFAULT_API_DOMAIN, key } = {}) {
    return this.request({ method: 'GET', url: buildSearchUrl({ accessToken, apiDomain, key }) });
  }

  downloadLink({ accessToken, apiDomain = DEFAULT_API_DOMAIN, fidlist } = {}) {
    return this.request({ method: 'GET', url: buildDownloadUrl({ accessToken, apiDomain, fidlist }) });
  }

  /* عمداً وجود ندارد: حذف فایل، بازنویسی و ریست ممنوع است. */
  deleteFile() {
    throw new Error('TERABOX_DESTRUCTIVE_BLOCKED');
  }

  safeText(value) { return redact(String(value)); }
  parse(payload) { return parseErrno(payload); }
}

/* ---------------------------------------------------------------------------
 * Fixture کاملاً آفلاین. هیچ fetch، هیچ حساب، هیچ توکن واقعی.
 * پاسخهای خطا عیناً همان JSONهاییاند که با GET نامعتبر از سرور واقعی گرفتیم.
 * ------------------------------------------------------------------------- */
export class FixtureTerabox extends TeraboxTransport {
  constructor({ clientId = 'FIXTURE_CLIENT_ID' } = {}) {
    super({
      clientId,
      clientSecret: 'FIXTURE_CLIENT_SECRET',
      privateSecret: 'FIXTURE_PRIVATE_SECRET',
      fetchImpl: null,
    });
    this.mode = 'offline-fixture';
    this.files = new Map();       // `${uploadid}:${partseq}` → Buffer
    this.uploads = new Map();     // uploadid → { path, blockList, shards[] }
    this.completed = new Map();   // fs_id → Buffer
    this.nextFsId = 934526256472800;
  }

  hasCredentials() { return true; }   // فقط برای ساختن فرمها؛ مقدارها ساختگیاند

  describe() {
    return {
      mode: this.mode,
      officialApi: true,
      selfService: false,
      credentialsSupplied: false,   // هیچ کلید اپ واقعیای فراهم نشده
      credentialsInSource: false,
      networkCalls: 0,
      deleteCalled: false,
      destructiveOperations: [],
      realLoginPerformed: false,
      realUploadPerformed: false,
    };
  }

  async request({ method = 'GET', url, form } = {}) {
    assertNoDestructive({ method, url });
    const u = new URL(url);
    const q = u.searchParams;
    const p = u.pathname;

    if (p === '/oauth/devicecode') {
      if (q.get('client_id') === 'ARENA_INVALID_TEST_ONLY') {
        return { errno: 100001, newno: '', request_id: 384136693279060322,
          server_time: 1794397624, show_msg: 'unknown client' };
      }
      return { errno: 0, data: { device_code: 'FIXTURE_DEVICE_CODE',
        qrcode_url: 'data:image/png;base64,FIXTURE', expires_in: 300, interval: 2,
        user_code: '', verification_url: '' } };
    }

    if (p === '/oauth/gettoken') {
      const code = String(form?.get('code') || '');
      const grant = String(form?.get('grant_type') || '');
      if (!code) return { errno: 2, show_msg: 'missing code' };
      const letter = code.toLowerCase().includes('acct-b') || code.toLowerCase().endsWith('-b') ? 'B' : 'A';
      return { errno: 0, data: {
        access_token: `FIXTURE_ACCESS_${letter}`,
        refresh_token: `FIXTURE_REFRESH_${letter}_1`,
        expires_in: 172800,
        grant_type_used: grant,
      } };
    }

    if (p === '/oauth/tokeninfo') {
      const token = String(form?.get('access_token') || '');
      if (token === 'ARENA_INVALID_TEST_ONLY') {
        return { errno: 200002, newno: '', request_id: 384136779638609863,
          server_time: 1794397624, show_msg: 'invalid access_token' };
      }
      const letter = token.includes('_B') ? 'B' : 'A';
      return { errno: 0, data: {
        client_id: this.clientId,
        api_domain: letter === 'B' ? 'www.terabox.app' : 'www.terabox.com',
        upload_domain: letter === 'B' ? 'c-all.terabox.com' : 'c-jp.terabox.com',
        expires_in: 172800, create_time: 1700445778,
        user_id: letter === 'B' ? 127813131 : 127813130,
      } };
    }

    if (p === '/oauth/refreshtoken') {
      const used = String(form?.get('refresh_token') || '');
      const letter = used.includes('_B') ? 'B' : 'A';
      const n = Number(used.split('_').pop()) || 1;
      return { errno: 0, data: {
        access_token: `FIXTURE_ACCESS_${letter}_R${n}`,
        refresh_token: `FIXTURE_REFRESH_${letter}_${n + 1}`,
        expires_in: 172800,
      } };
    }

    if (p === '/openapi/uinfo') {
      const letter = String(q.get('access_tokens') || '').includes('_B') ? 'B' : 'A';
      return { errno: 0, uk: letter === 'B' ? 127813131 : 127813130,
        uname: `fixture-account-${letter.toLowerCase()}`, vip_type: 0, use_type: 1, user_type: 1 };
    }

    if (p === '/openapi/api/quota') {
      return { errno: 0, total: 1024 * 1024 * 1024 * 1024, used: 2 * 1024 * 1024 * 1024 };
    }

    if (p === '/openapi/api/precreate') {
      const path = String(form?.get('path') || '');
      assertSafePath(path);
      const blockList = JSON.parse(String(form?.get('block_list') || '[]'));
      const uploadid = `FIXTURE_UPLOAD_${this.uploads.size + 1}`;
      this.uploads.set(uploadid, { path, blockList, shards: [] });
      return { errno: 0, path, uploadid, return_type: 1,
        block_list: blockList.map((_, i) => i) };
    }

    if (p === '/rest/2.0/pcs/superfile2') {
      const blob = form?.get('file');
      if (!blob) return { errno: 2, show_msg: 'missing file' };
      const bytes = Buffer.from(await blob.arrayBuffer());
      const uploadid = String(q.get('uploadid') || '');
      const partseq = Number(q.get('partseq') || 0);
      if (!this.uploads.has(uploadid)) return { errno: -9, show_msg: 'unknown uploadid' };
      this.files.set(`${uploadid}:${partseq}`, bytes);
      const md5 = createHash('md5').update(bytes).digest('hex');
      return { md5, partseq, uploadid, request_id: 6949704713248675000 };
    }

    if (p === '/openapi/api/create') {
      const uploadid = String(form?.get('uploadid') || '');
      const blockList = JSON.parse(String(form?.get('block_list') || '[]'));
      const up = this.uploads.get(uploadid);
      if (!up) return { errno: -9, show_msg: 'unknown uploadid' };
      const shards = blockList.map((_, i) => this.files.get(`${uploadid}:${i}`));
      if (shards.some((b) => !b)) return { errno: -9, show_msg: 'missing shard' };
      const joined = Buffer.concat(shards);
      const fs_id = ++this.nextFsId;
      this.completed.set(fs_id, joined);
      return { errno: 0, fs_id, path: String(form?.get('path') || ''),
        size: joined.length, md5: createHash('md5').update(joined).digest('hex'),
        category: 6, isdir: 0, ctime: 1702633080, mtime: 1702633080 };
    }

    if (p === '/openapi/api/list') {
      return { errno: 0, list: [...this.completed.entries()].map(([fs_id, b]) => ({
        fs_id, size: b.length, path: String(q.get('dir') || ''), isdir: 0, category: 6,
        server_filename: `fixture-${fs_id}.bin`,
      })) };
    }

    if (p === '/openapi/api/download') {
      return { errno: 0, dlink: [...this.completed.entries()].map(([fs_id]) => ({
        fs_id: String(fs_id),
        dlink: `https://d.terabox.com/file/fixture-${fs_id}?access_tokens=${q.get('access_tokens') || ''}`,
      })) };
    }

    return { errno: 500001, show_msg: `fixture: مسیر پشتیبانینشده ${p}` };
  }

  readFile(fsId) { return this.completed.get(Number(fsId)); }
}

export default TeraboxTransport;
