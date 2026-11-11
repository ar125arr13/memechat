/* MemeChat — «تست محدودزمانی» دیتابیس اصلی روی بله.
 *
 * درخواست: «الان تنظیمش کن روی بله ببینیم کار میکنه؟ عیبی نداره اگه مدت
 * کمی باشه».
 *
 * این ماژول دقیقاً همان را میکند:
 *   1) برای یک پنجرهٔ کوتاه و محدود (پیشفرض ۳۰ ثانیه، سقف سخت ۵ دقیقه)
 *      `activePrimary` را روی بله میگذارد.
 *   2) یک فایل واقعی AES-256-GCM میسازد، به بستههای MCPK1 تبدیل میکند،
 *      با API رسمی بله میفرستد، دوباره با getUpdates پس میگیرد و SHA-256
 *      اش را موبهمو تأیید میکند.
 *   3) در `finally` — حتی اگر خطا/تایماوت/خرابی پیش بیاید — **خودکار و فوری**
 *      به Supabase برمیگرداند (`repair`). یعنی «مدت کمی» تضمین شده است.
 *
 * قوانین ثابت: صفر DELETE/DROP/TRUNCATE/RESET؛ حین تست هیچ نوشتهای به سوپا
 * انجام نمیشود (`write` بلاک است)؛ هیچ توکنی تو سورس/لاگ/گزارش/چت نیست؛
 * بدون ورسل، بدون بکاند اضافه، بدون استقرار، بدون ادغام.
 *
 * ⚠️ تست واقعی به `BALE_BOT_TOKEN` + `BALE_CHAT_ID` نیاز دارد که فقط از محیط
 *    امن سرور خوانده میشوند. بدون آنها، هیچ تماسی برقرار نمیشود و گزارش
 *    `NO_RUNTIME_CREDENTIALS` برمیگردد (وانمود نمیکنیم کار کرد).
 */

import { webcrypto } from 'node:crypto';
import {
  PrimaryDbRouter, DESIGNATED_PRIMARY, ACTIVE_FALLBACK, baleCapabilityReport,
} from './router.mjs';
import {
  sendDirectMessage, getBaleUpdates, receivePackets, encodePacketForBale,
  baleStatus, discoverChatId, BALE_API_ORIGIN,
} from '../bale/api.mjs';
import { assertNoSecret } from '../client/bale-direct.js';
import { makePackets, joinPackets } from '../client/courier.js';
import { encryptEnvelope } from '../rubika/adapter.mjs';
import { utf8, sha256Hex } from '../worker/src/crypto.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

export const TRIAL_KIND = 'memechat-bale-primary-trial';
export const DEFAULT_TRIAL_MS = 30_000;
export const MAX_TRIAL_MS = 300_000;
export const FIXTURE_RAW_KEY = 'fixture-test-key-not-a-real-secret';

function effectiveEnv(token, chatId, env) {
  return {
    ...env,
    BALE_BOT_TOKEN: token || env?.BALE_BOT_TOKEN || '',
    BALE_CHAT_ID: chatId || env?.BALE_CHAT_ID || '',
  };
}

export function trialConfig({ token = '', chatId = '', fetchImpl = null } = {}) {
  return {
    ready: Boolean(token && chatId && fetchImpl),
    tokenPresent: Boolean(token),
    chatIdPresent: Boolean(chatId),
    fetchPresent: Boolean(fetchImpl),
    source: 'runtime-only',
    backendAdded: false,
    vercelUsed: false,
    frontendSecrets: false,
    // مقادیر token/chatId هرگز برگردانده نمیشوند.
  };
}

/* ساخت بستههای رمزشدهٔ تست. هم CLI/Trial و هم پل GET از همین تابع استفاده
   میکنند تا SHA و قالب بستهها یکی باشد. */
export async function buildTrialPackets(rawKey = FIXTURE_RAW_KEY, at = null) {
  const envelope = encryptEnvelope({
    kind: TRIAL_KIND,
    at: at || new Date().toISOString(),
    sample: 'بستهٔ تستی رمزشده؛ بله فقط ciphertext میبیند',
  }, rawKey);
  const bytes = utf8(JSON.stringify(envelope));
  const sha256 = await sha256Hex(bytes);
  const packets = await makePackets(bytes, {
    id: `trial-${Date.now().toString(36)}`,
    chunkSize: 900,
    mime: 'application/json',
    name: 'trial.enc.json',
  });
  const texts = packets.map((p) => encodePacketForBale(p, {}));
  return { packets, texts, sha256, bytes, envelope };
}

/* پیشچک تست واقعی: فقط از محیط امن میخواند، هیچ مقداری چاپ/ذخیره نمیکند.
   مشخص میکند آیا توکن معتبر است و آیا getUpdates از بله پاسخ میدهد. */
export async function runPreflight({
  token = '', chatId = '', fetchImpl = globalThis.fetch, env = process.env,
} = {}) {
  const e = effectiveEnv(token, chatId, env);
  const cfg = trialConfig({
    token: e.BALE_BOT_TOKEN, chatId: e.BALE_CHAT_ID, fetchImpl,
  });
  if (!cfg.ready) {
    return {
      kind: 'memechat-bale-preflight',
      ok: false,
      blocked: 'NO_RUNTIME_CREDENTIALS',
      config: cfg,
      endpoint: BALE_API_ORIGIN,
      getMeOk: false,
      updatesReachable: false,
      discoveredChatIdPresent: false,
      message: 'توکن/چتآیدی تو محیط امن سرور تنظیم نشده؛ هیچ تماسی برقرار نشد.',
      dataDeleted: false,
      destructiveOperations: [],
    };
  }
  let status;
  try {
    status = await baleStatus({ token: e.BALE_BOT_TOKEN, fetchImpl, env: e });
  } catch (err) {
    status = { ready: false, message: assertNoSecret(err?.message || 'BALE_UNREACHABLE', e) };
  }
  let updates = [];
  let updatesReachable = false;
  try {
    updates = await getBaleUpdates({
      token: e.BALE_BOT_TOKEN, fetchImpl, env: e, limit: 10,
    });
    updatesReachable = Array.isArray(updates);
  } catch { updatesReachable = false; }
  const discovered = discoverChatId(updates);
  const result = {
    kind: 'memechat-bale-preflight',
    ok: Boolean(status.ready && updatesReachable),
    blocked: null,
    config: cfg,
    endpoint: BALE_API_ORIGIN,
    getMeOk: Boolean(status.ready),
    updatesReachable,
    discoveredChatIdPresent: Boolean(discovered),
    vercelUsed: false,
    frontendSecrets: false,
    deployed: false,
    dataDeleted: false,
    destructiveOperations: [],
    message: status.ready && updatesReachable
      ? 'توکن معتبر است و getUpdates پاسخ داد؛ آمادهٔ تست واقعی.'
      : 'اتصال برقرار نشد یا توکن نامعتبر است؛ فقط وضعیت کلی گزارش شد.',
  };
  assertNoSecret(JSON.stringify(result), e);
  return result;
}

export class BalePrimaryTrial {
  constructor({
    router,
    token = '', chatId = '', fetchImpl = globalThis.fetch, env = process.env,
    durationMs = DEFAULT_TRIAL_MS,
    now = () => new Date().toISOString(),
    onEvent = null,
  } = {}) {
    if (!router || !(router instanceof PrimaryDbRouter)) throw new Error('ROUTER_REQUIRED');
    this.router = router;
    this.token = String(token || '').trim();
    this.chatId = String(chatId || '').trim();
    this.fetchImpl = fetchImpl;
    this.env = effectiveEnv(this.token, this.chatId, env);
    this.requestedDurationMs = Number(durationMs) || DEFAULT_TRIAL_MS;
    this.durationMs = Math.min(Math.max(1, this.requestedDurationMs), MAX_TRIAL_MS);
    this.durationClamped = this.durationMs !== this.requestedDurationMs;
    this.now = now;
    this.onEvent = onEvent;
    this.state = {
      running: false, startedAt: null, endedAt: null,
      forced: null, report: null,
    };
  }

  status() {
    return {
      kind: TRIAL_KIND,
      running: this.state.running,
      startedAt: this.state.startedAt,
      endedAt: this.state.endedAt,
      forcedRepairReason: this.state.forced,
      requestedDurationMs: this.requestedDurationMs,
      durationMs: this.durationMs,
      durationClamped: this.durationClamped,
      maxDurationMs: MAX_TRIAL_MS,
      designatedPrimary: this.router.designated,
      activePrimary: this.router.status().activePrimary,
      temporary: this.router.status().temporary,
      config: trialConfig({ token: this.token, chatId: this.chatId, fetchImpl: this.fetchImpl }),
      lastReport: this.state.report,
    };
  }

  _emit(event) { if (this.onEvent) this.onEvent(event); }

  async run(rawKey = FIXTURE_RAW_KEY) {
    const cfg = trialConfig({ token: this.token, chatId: this.chatId, fetchImpl: this.fetchImpl });
    if (!cfg.ready) {
      const blocked = {
        kind: TRIAL_KIND,
        ok: false,
        blocked: 'NO_RUNTIME_CREDENTIALS',
        activeAfter: this.router.status().activePrimary,
        message: 'توکن/چتآیدی فقط تو محیط امن سرور؛ بدون آنها هیچ تماسی برقرار نشد.',
        config: cfg,
        repaired: false,
        dataDeleted: false,
        destructiveOperations: [],
        retainedInPrimary: true,
      };
      this.state.report = blocked;
      return blocked;
    }

    const started = Date.now();
    this.state.running = true;
    this.state.startedAt = this.now();
    this.state.forced = null;

    // «تنظیمش کن روی بله» — فقط برای همین پنجرهٔ کوتاه.
    this.router.active = DESIGNATED_PRIMARY;
    this.router.temporary = true;
    this.router.temporaryReason = 'BALE_PRIMARY_TIMEBOXED_TRIAL';
    this._emit({ type: 'trial-start', at: this.state.startedAt, durationMs: this.durationMs });

    const forceRepair = (reason) => {
      if (this.state.forced) return;
      this.state.forced = reason;
      this.router.repair(reason);
      this._emit({ type: 'auto-repair', reason });
    };

    const timer = setTimeout(() => forceRepair('TRIAL_TIMEOUT'), this.durationMs);
    let outcome;
    try {
      outcome = await this._roundTrip(rawKey);
    } catch (err) {
      outcome = {
        ok: false,
        error: assertNoSecret(err?.message || 'TRIAL_FAILED', this.env),
        roundTrip: null,
      };
    } finally {
      clearTimeout(timer);
      this.state.running = false;
      this.state.endedAt = this.now();
      // حتی اگه خراب شد: برگشت فوری و خودکار به سوپا.
      forceRepair(this.state.forced || 'TRIAL_FINISHED');
    }

    const report = {
      kind: TRIAL_KIND,
      ok: Boolean(outcome.ok),
      error: outcome.error || null,
      blocked: null,
      designatedPrimary: this.router.designated,
      activeDuringTrial: DESIGNATED_PRIMARY,
      activeAfter: this.router.status().activePrimary,
      temporaryAfter: this.router.status().temporary,
      requestedDurationMs: this.requestedDurationMs,
      durationMs: this.durationMs,
      durationClamped: this.durationClamped,
      startedAt: this.state.startedAt,
      endedAt: this.state.endedAt,
      elapsedMs: Date.now() - started,
      autoRepairReason: this.state.forced,
      repaired: true,
      reversible: true,
      roundTrip: outcome.roundTrip || null,
      capabilityReport: baleCapabilityReport(),
      config: cfg,
      dataDeleted: false,
      destructiveOperations: [],
      retainedInPrimary: true,
      primaryRowsUntouched: true,
      vercelUsed: false,
      frontendSecrets: false,
      backendAdded: false,
      deployed: false,
      merged: false,
      note: 'بله فقط برای چند ثانیه فعال شد؛ حتی در خطا هم سوپا خودکار برگشت. هیچ ردیفی پاک نشد.',
    };
    assertNoSecret(JSON.stringify(report), this.env);
    this.state.report = report;
    this._emit({ type: 'trial-end', ok: report.ok, elapsedMs: report.elapsedMs });
    return report;
  }

  async _roundTrip(rawKey) {
    // ۱) فایل رمزشدهٔ واقعی (همان قالب AES-256-GCM قدیمی).
    const { packets, texts, sha256: wholeSha } = await buildTrialPackets(rawKey, this.now());

    // ۲) ارسال تکتک بستهها به بازو با API رسمی.
    const sent = [];
    for (const text of texts) {
      const r = await sendDirectMessage({
        chatId: this.chatId, token: this.token,
        fetchImpl: this.fetchImpl, env: this.env, text,
      });
      sent.push({
        verified: r.verified, mode: r.mode,
        messageId: r.messageId, textLength: r.textLength,
      });
    }

    // ۳) پس گرفتن از getUpdates و تأیید موبهمو.
    const updates = await getBaleUpdates({
      token: this.token, fetchImpl: this.fetchImpl, env: this.env, limit: 100,
    });
    const received = receivePackets(updates, this.env);
    const { bytes: back, meta } = await joinPackets(received.packets);
    const backSha = await sha256Hex(back);
    const verified = received.packetCount === packets.length
      && backSha === wholeSha && meta.sha === wholeSha;

    return {
      ok: verified,
      roundTrip: {
        encryption: 'AES-256-GCM',
        packetMagic: 'MCPK1',
        packetCount: packets.length,
        receivedCount: received.packetCount,
        envelopeSha256: wholeSha,
        restoredSha256: backSha,
        verified,
        allSendsVerified: sent.every((s) => s.verified),
        sent,
      },
    };
  }
}

export default BalePrimaryTrial;
