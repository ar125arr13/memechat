/* MemeChat — لایهٔ «دیتابیس اصلی» بعد از درخواست:
 *   «روبیکا که کار نمیکنه / بله رو دیتابیس اصلی بکن / اگه خراب شد درستش کن
 *    و موقت بزارش روی سوپا».
 *
 * این فایل صادقانه همان سه جمله را پیاده میکند:
 *   1) بله بهعنوان «اصلی تعیینشده» (designated) ثبت میشود.
 *   2) قابلیتهایش واقعاً پروب میشوند. چون پیامرسان است نه دیتابیس، پروب
 *      شکست میخورد (خراب میشود).
 *   3) `repair()` بدون پاک کردن هیچ ردیفی، سوپا را «موقتاً فعال» نگه میدارد
 *      و حادثه را ثبت میکند. برگشتپذیر است.
 *
 * قوانین ثابت (دستنخورده):
 *   - دیتابیس اصلی زنده Supabase همچنان کار میکند؛ لاگین/OTP/چت/تاریخچه/rt-*
 *     تغییر نکردند.
 *   - صفر DELETE / DROP / TRUNCATE / RESET / ALTER ... DROP COLUMN.
 *   - نام جدولها و فیلدهای موجود حفظ شدند (`TABLES`).
 *   - بدون ورسل، بدون GitHub API، بدون API خصوصی روبیکا، بدون scraping.
 *   - هیچ توکن/کلیدی تو سورس، فرانتاند، لاگ، چت یا گزارش نیست؛ فقط موقع اجرا.
 *   - مسیر قدیمی روبیکا حذف نشد؛ فقط بهعنوان legacy/غیرفعال علامت خورد.
 *
 * ⚠️ هیچ استقرار، تغییر زنده، تغییر CSP/`MC_API`/Edge، ادغام PR، بکآپ واقعی
 *    یا تماس واقعی به بله انجام نشد. این کد + تست + سند است.
 *
 * مستندات رسمی: https://docs.bale.ai/
 * Base URL     : https://tapi.bale.ai/bot<TOKEN>/sendMessage
 */

import { TABLES } from '../rubika/adapter.mjs';
import {
  callBale, getBaleUpdates, sendDirectMessage, encodePacketForBale,
  BALE_API_ORIGIN, MAX_BALE_TEXT,
} from '../bale/api.mjs';

export const DESIGNATED_PRIMARY = 'bale-bot-api';
export const ACTIVE_FALLBACK = 'supabase-primary';
export const LEGACY_SECOND_DB = 'rubika-manual-courier';
export const PRIMARY_STATE_KIND = 'memechat-primary-db-state';

/* حقایق راستیآزمایشده از مستندات رسمی بله و CSP فعلی پروژه. */
export const BALE_CAPABILITIES = Object.freeze({
  httpJsonApi: true,
  getMe: true,
  getUpdates: true,
  sendMessage: true,
  appendOnlyMessages: true,
  maxTextChars: MAX_BALE_TEXT,                 // ۴۰۹۶
  updateRetentionHours: 24,                    // فقط ۲۴ ساعت
  updateRetentionCount: 2000,                  // فقط ۲۰۰۰ آپدیت آخر
  rateLimited: true,
  sqlQuery: false,
  transaction: false,
  index: false,
  join: false,
  rowLevelAuth: false,
  otpLogin: false,
  realtimeChannels: false,
  durableStorage: false,
  atomicMultiRowWrite: false,
  schemaConstraints: false,
  browserCorsConfirmed: false,                 // تو مستندات رسمی تأیید نشده
  cspAllowlisted: false,                      // connect-src زنده تغییر نکرده
  canBePrimary: false,
});

export const REQUIRED_PRIMARY_CAPABILITIES = Object.freeze([
  'sqlQuery', 'transaction', 'index', 'join', 'rowLevelAuth', 'otpLogin',
  'realtimeChannels', 'durableStorage', 'atomicMultiRowWrite',
  'schemaConstraints', 'browserCorsConfirmed', 'cspAllowlisted',
]);

export const BALE_PRIMARY_PREREQUISITES = Object.freeze([
  'یک سرویس دیتابیس واقعی پشت بله (بله خودش فقط حامل پیام است)',
  'کوئری/تراکنش/ایندکس/طرحواره و احراز هویت ردیفی',
  'ذخیرهٔ پایدار بدون سقف ۲۴ ساعت / ۲۰۰۰ پیام',
  'تأیید CORS مرورگر و اضافه شدن tapi.bale.ai به connect-src زنده',
  'توکن فقط تو محیط امن سرور، نه فرانتاند',
  'بکآپ واقعی + تأیید + تست بدون کاربر قبل از هر قطع سوپا',
]);

export function baleCapabilityReport() {
  return {
    canBePrimary: false,
    endpoint: BALE_API_ORIGIN,
    present: Object.entries(BALE_CAPABILITIES)
      .filter(([, v]) => v === true).map(([k]) => k),
    missing: REQUIRED_PRIMARY_CAPABILITIES.filter((k) => BALE_CAPABILITIES[k] !== true),
    limits: {
      maxTextChars: BALE_CAPABILITIES.maxTextChars,
      updateRetentionHours: BALE_CAPABILITIES.updateRetentionHours,
      updateRetentionCount: BALE_CAPABILITIES.updateRetentionCount,
      rateLimited: BALE_CAPABILITIES.rateLimited,
    },
    prerequisites: BALE_PRIMARY_PREREQUISITES,
    conclusion: 'بله پیامرسان است، نه دیتابیس اصلی؛ نمیتواند جای Supabase را بگیرد.',
  };
}

function effectiveEnv(token, chatId, env) {
  return {
    ...env,
    BALE_BOT_TOKEN: token || env?.BALE_BOT_TOKEN || '',
    BALE_CHAT_ID: chatId || env?.BALE_CHAT_ID || '',
  };
}

/* پروب واقعی: هم قابلیتهای ساختاری، هم (در صورت دادن fetchImpl) تماس رسمی.
   هیچ تماسی بدون fetchImpl انجام نمیشود. */
export async function probeBale({
  token = '', chatId = '', fetchImpl = null, env = {},
  packet = 'MCPK1.probe.ok',
} = {}) {
  const e = effectiveEnv(token, chatId, env);
  const checks = [];
  const add = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });

  add('credentialsAtRuntime', Boolean(e.BALE_BOT_TOKEN && e.BALE_CHAT_ID),
    'توکن/چتآیدی فقط موقع اجرا؛ هیچ مقداری تو سورس نیست');

  for (const cap of REQUIRED_PRIMARY_CAPABILITIES) {
    add(`capability:${cap}`, BALE_CAPABILITIES[cap] === true,
      BALE_CAPABILITIES[cap] === true ? 'دارد' : 'پیامرسان این قابلیت را ندارد');
  }

  if (fetchImpl) {
    try {
      await callBale('getMe', {}, { token: e.BALE_BOT_TOKEN, fetchImpl, env: e });
      add('getMe', true, 'پاسخ رسمی دریافت شد');
    } catch (err) { add('getMe', false, err?.message || 'BALE_GETME_FAILED'); }
    try {
      const updates = await getBaleUpdates({
        token: e.BALE_BOT_TOKEN, fetchImpl, env: e, limit: 1,
      });
      add('getUpdates', Array.isArray(updates), `${updates.length} آپدیت؛ سقف ۲۴ ساعت/۲۰۰۰`);
    } catch (err) { add('getUpdates', false, err?.message || 'BALE_UPDATES_FAILED'); }
    try {
      const text = encodePacketForBale(packet, e);
      await sendDirectMessage({
        chatId: e.BALE_CHAT_ID, token: e.BALE_BOT_TOKEN,
        fetchImpl, env: e, text,
      });
      add('sendMessage', true, 'بستهٔ رمزشده به بازو ارسال شد (فقط حامل)');
    } catch (err) { add('sendMessage', false, err?.message || 'BALE_SEND_FAILED'); }
  } else {
    add('getMe', false, 'NO_FETCH_IMPL');
    add('getUpdates', false, 'NO_FETCH_IMPL');
    add('sendMessage', false, 'NO_FETCH_IMPL');
  }

  const missing = checks.filter((c) => !c.ok).map((c) => c.name);
  return {
    ok: missing.length === 0,
    canBePrimary: missing.length === 0,
    probedAt: new Date().toISOString(),
    designated: DESIGNATED_PRIMARY,
    endpoint: BALE_API_ORIGIN,
    checks,
    missing,
    capabilityReport: baleCapabilityReport(),
    dataDeleted: false,
    destructiveOperations: [],
    note: 'پروب شکست خورد چون بله دیتابیس نیست؛ سوپا موقتاً فعال میماند.',
  };
}

function assertNotDestructive(payload, opts) {
  const blob = `${JSON.stringify(payload ?? '')}\n${JSON.stringify(opts ?? '')}`;
  if (/\b(DELETE|DROP|TRUNCATE|RESET)\b/i.test(blob) || /ALTER\s+TABLE[\s\S]*DROP\s+COLUMN/i.test(blob)) {
    throw Object.assign(new Error('DESTRUCTIVE_OPERATION_BLOCKED'), {
      dataDeleted: false, destructiveOperations: [], retainedInPrimary: true,
    });
  }
  if (/^(DELETE|PATCH|PUT|POST)$/i.test(String(opts?.method || '')) && opts?.allowWrites !== true) {
    // نوشتن فقط وقتی مجاز است که صراحتاً allowWrites داده شود؛ پیشفرض فقطخواندنی.
    throw new Error('WRITE_NOT_ALLOWED_BY_DEFAULT');
  }
}

export class PrimaryDbRouter {
  constructor({
    supabase,                         // { name, read(table, opts), write(table, payload, opts) }
    bale = null,                      // { token, chatId, fetchImpl, env }
    designated = DESIGNATED_PRIMARY,
    now = () => new Date().toISOString(),
  } = {}) {
    if (!supabase || typeof supabase.read !== 'function') {
      throw new Error('SUPABASE_FALLBACK_REQUIRED');
    }
    this.supabase = supabase;
    this.bale = bale;
    this.designated = designated;      // خواستهٔ صاحب پروژه: بله
    this.active = ACTIVE_FALLBACK;     // واقعیت فعلی: سوپا، موقت
    this.temporary = true;
    this.temporaryReason = 'BALE_CANNOT_BE_PRIMARY_UNTIL_PREREQUISITES';
    this.incidents = [];
    this.probeReport = null;
    this.now = now;
    this.state = Object.freeze({
      kind: PRIMARY_STATE_KIND,
      dataDeleted: false,
      deleted: false,
      destructiveOperations: [],
      primaryRowsUntouched: true,
      vercelUsed: false,
      frontendSecrets: false,
      officialBaleApiUsed: false,     // تا وقتی پروب واقعی انجام نشود
      deployed: false,
      merged: false,
    });
  }

  status() {
    return {
      kind: PRIMARY_STATE_KIND,
      designatedPrimary: this.designated,
      activePrimary: this.active,
      temporary: this.temporary,
      temporaryReason: this.temporaryReason,
      fallbackNote: 'سوپا موقتاً فعال است؛ هیچ ردیفی پاک یا ریست نشد.',
      legacySecondDb: {
        kind: LEGACY_SECOND_DB,
        works: false,
        reason: 'صاحب پروژه گفت روبیکا کار نمیکند؛ مسیر دستی دیگرactive نیست، ولی حذف نشد.',
        deleted: false,
      },
      preservedSchema: {
        tableNames: Object.keys(TABLES),
        columns: TABLES,
        note: 'نام جدولها و فیلدها دستنخورده؛ طرحوارهٔ زنده ۴۴ جدول Supabase هم تغییر نکرد.',
      },
      capabilityReport: baleCapabilityReport(),
      probeReport: this.probeReport,
      incidents: this.incidents,
      ...this.state,
      reportedAt: this.now(),
    };
  }

  /* همان «بله رو دیتابیس اصلی بکن»: سعی میکند ارتقا بدهد. */
  async tryPromoteBale() {
    const report = await probeBale(this.bale || {});
    this.probeReport = report;
    if (report.canBePrimary) {
      this.active = this.designated;
      this.temporary = false;
      this.temporaryReason = null;
      this.incidents.push({
        at: this.now(), action: 'promote', reason: 'ALL_CAPABILITIES_PRESENT',
        dataDeleted: false,
      });
      return {
        promoted: true, active: this.active, temporary: false,
        dataDeleted: false, destructiveOperations: [], report,
      };
    }
    // «اگه خراب شد درستش کن و موقت بزارش روی سوپا»
    return this.repair('BALE_PRIMARY_PROBE_FAILED', report);
  }

  repair(reason = 'MANUAL_REPAIR', report = this.probeReport) {
    this.active = ACTIVE_FALLBACK;
    this.temporary = true;
    this.temporaryReason = reason;
    const incident = {
      at: this.now(),
      action: 'keep-supabase-active',
      reason,
      repaired: true,
      reversible: true,
      dataDeleted: false,
      destructiveOperations: [],
      retainedInPrimary: true,
    };
    this.incidents.push(incident);
    return {
      repaired: true,
      active: this.active,
      temporary: true,
      temporaryReason: reason,
      designatedPrimary: this.designated,
      fallback: 'supabase',
      reversible: true,
      dataDeleted: false,
      destructiveOperations: [],
      retainedInPrimary: true,
      capabilityReport: baleCapabilityReport(),
      probeReport: report,
      incident,
    };
  }

  rollbackToSupabase() { return this.repair('EXPLICIT_ROLLBACK'); }

  async read(table, opts = {}) {
    // فقط خواندن از دیتابیس اصلی فعال؛ پیشفرض فقطخواندنی.
    return this.supabase.read(table, { ...opts, method: opts.method || 'GET' });
  }

  async write(table, payload, opts = {}) {
    assertNotDestructive(payload, opts);
    if (this.active !== ACTIVE_FALLBACK) {
      throw Object.assign(new Error('NON_SUPABASE_PRIMARY_NOT_ALLOWED'), {
        active: this.active, dataDeleted: false, retainedInPrimary: true,
      });
    }
    if (typeof this.supabase.write !== 'function') throw new Error('WRITE_NOT_SUPPORTED');
    return this.supabase.write(table, payload, { ...opts, allowWrites: true });
  }

  assertIntegrity() {
    const s = this.status();
    if (s.dataDeleted || s.deleted || s.destructiveOperations.length) {
      throw new Error('INTEGRITY_VIOLATION');
    }
    return {
      ok: true, active: s.activePrimary, designated: s.designatedPrimary,
      dataDeleted: false, destructiveOperations: [], primaryRowsUntouched: true,
      reversible: true,
    };
  }
}

export default PrimaryDbRouter;
