/* MemeChat — نگهداری **دو حساب مستقل** TeraBox.
 *
 * نکتهٔ مهمی که تو درخواست پرسیدی: «لاگین با دو اکنت → گرفتن API شون».
 * لاگین، «API کی» نمیدهد. API کی مال **اپ تأییدشده** است
 * (client_id / client_secret / private_secret)، و هر حساب فقط یک جفت
 * access_token + refresh_token مستقل میگیرد. این فایل همان دو جفت توکن را
 * جدا نگه میدارد: توکن مشترک نیست، api_domain/upload_domain جدا است،
 * و سهمیهها **جمع نمیشوند** (ToS: «circumvent storage space limits» ممنوع).
 *
 * هیچ توکن واقعی، رمز عبور، OTP، کوکی ndus یا client_secretـای اینجا نیست.
 * توکنها فقط حین اجرا از پاسخ OAuth یا محیط امن وارد میشوند و در `describe()`
 * فقط اثرانگشت ۸رقمی SHA-256 دیده میشود.
 */

import { createHash } from 'node:crypto';
import {
  ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS,
  PREVIOUS_TOKEN_GRACE_SECONDS, APP_ROOT_PREFIX,
} from './openplatform.mjs';

export const MAX_ACCOUNTS = 2;

const fingerprint = (s) => createHash('sha256').update(String(s), 'utf8').digest('hex').slice(0, 8);

export class TeraboxAccounts {
  constructor({ maxAccounts = MAX_ACCOUNTS, now = () => Date.now(), appRoot } = {}) {
    this.maxAccounts = maxAccounts;
    this.now = now;
    this.appRoot = appRoot || `${APP_ROOT_PREFIX}MemeChat-/`;
    this.accounts = new Map();
    this.usedRefreshTokens = new Set();
    this.quotaPooling = false;
  }

  register({ label, accessToken, refreshToken, expiresIn = ACCESS_TOKEN_TTL_SECONDS,
    apiDomain, uploadDomain, userId, createdAt } = {}) {
    if (!label) throw new Error('TERABOX_MISSING_LABEL');
    if (!accessToken || !refreshToken) throw new Error('TERABOX_MISSING_TOKENS');
    if (this.accounts.has(label)) throw new Error('TERABOX_DUPLICATE_LABEL');
    if (this.accounts.size >= this.maxAccounts) throw new Error('TERABOX_TOO_MANY_ACCOUNTS');
    for (const a of this.accounts.values()) {
      if (a.accessToken === accessToken) throw new Error('TERABOX_SHARED_ACCESS_TOKEN');
      if (a.refreshToken === refreshToken) throw new Error('TERABOX_SHARED_REFRESH_TOKEN');
      if (userId && a.userId === userId) throw new Error('TERABOX_DUPLICATE_ACCOUNT');
    }
    const t = Number(createdAt ?? this.now());
    const expiresAt = t + Number(expiresIn || ACCESS_TOKEN_TTL_SECONDS) * 1000;
    const account = {
      label, accessToken, refreshToken, apiDomain, uploadDomain,
      userId: userId ?? null, createdAt: t, expiresAt,
      refreshedAt: null, previousAccessTokenValidUntil: null,
      appRoot: this.appRoot,
    };
    this.accounts.set(label, account);
    return this.publicView(account);
  }

  publicView(a) {
    return {
      label: a.label,
      userId: a.userId,
      apiDomain: a.apiDomain || null,
      uploadDomain: a.uploadDomain || null,
      accessTokenFingerprint: fingerprint(a.accessToken),
      refreshTokenFingerprint: fingerprint(a.refreshToken),
      expiresAt: a.expiresAt,
      needsRefresh: this.needsRefresh(a.label),
      appRoot: a.appRoot,
      /* هیچوقت مقدار توکن برگردانده نمیشود */
    };
  }

  get(label) {
    const a = this.accounts.get(label);
    if (!a) throw new Error('TERABOX_UNKNOWN_ACCOUNT');
    return a;
  }

  tokenFor(label) {
    const a = this.get(label);
    if (this.needsRefresh(label)) throw new Error('TERABOX_ACCESS_TOKEN_EXPIRED');
    return a.accessToken;
  }

  needsRefresh(label, at = this.now()) {
    const a = this.get(label);
    /* ۶۰ ثانیه زودتر، چون refresh توکن یکبارمصرف است */
    return at + 60_000 >= a.expiresAt;
  }

  /* سند ۱.۴.۲.۳: refresh_token یکبارمصرف است؛ توکن قدیمی ۱۵ ثانیه بعد میمیرد. */
  applyRefresh(label, { usedRefreshToken, accessToken, refreshToken,
    expiresIn = ACCESS_TOKEN_TTL_SECONDS } = {}) {
    const a = this.get(label);
    if (usedRefreshToken && this.usedRefreshTokens.has(usedRefreshToken)) {
      throw new Error('TERABOX_REFRESH_TOKEN_ALREADY_USED');
    }
    if (!usedRefreshToken || usedRefreshToken !== a.refreshToken) {
      throw new Error('TERABOX_REFRESH_TOKEN_MISMATCH');
    }
    if (!accessToken || !refreshToken) throw new Error('TERABOX_MISSING_TOKENS');
    for (const other of this.accounts.values()) {
      if (other.label !== label && (other.accessToken === accessToken || other.refreshToken === refreshToken)) {
        throw new Error('TERABOX_SHARED_ACCESS_TOKEN');
      }
    }
    this.usedRefreshTokens.add(usedRefreshToken);
    const t = this.now();
    a.accessToken = accessToken;
    a.refreshToken = refreshToken;
    a.expiresAt = t + Number(expiresIn) * 1000;
    a.refreshedAt = t;
    a.previousAccessTokenValidUntil = t + PREVIOUS_TOKEN_GRACE_SECONDS * 1000;
    return this.publicView(a);
  }

  assertIsolated() {
    const list = [...this.accounts.values()];
    const access = new Set(list.map((a) => a.accessToken));
    const refresh = new Set(list.map((a) => a.refreshToken));
    if (access.size !== list.length || refresh.size !== list.length) {
      throw new Error('TERABOX_ACCOUNTS_NOT_ISOLATED');
    }
    if (this.quotaPooling) throw new Error('TERABOX_QUOTA_POOLING_FORBIDDEN');
    return true;
  }

  describe() {
    return {
      registered: this.accounts.size,
      maxAccounts: this.maxAccounts,
      accounts: [...this.accounts.values()].map((a) => this.publicView(a)),
      quotaPooling: this.quotaPooling,
      isolated: this.accounts.size > 0 ? this.assertIsolated() : false,
      credentialsInSource: false,
      realLoginPerformed: false,
      accessTokenTtlSeconds: ACCESS_TOKEN_TTL_SECONDS,
      refreshTokenTtlSeconds: REFRESH_TOKEN_TTL_SECONDS,
      refreshTokenOneTimeUse: true,
    };
  }
}

export default TeraboxAccounts;
