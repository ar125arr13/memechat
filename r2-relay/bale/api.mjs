/* MemeChat — API رسمی «بله» برای ارسال پیام مستقیم (Direct Message).
 *
 * فقط سمتسرور / ترمینال امن اجرا میشود:
 *   BALE_BOT_TOKEN و BALE_CHAT_ID فقط از process.env خوانده میشوند.
 *   مقدار هیچکدام هرگز به چت، فرانتاند، لاگ، مانیفست، سورس یا پیام خطا نمیرود.
 *   فقط دامنهٔ رسمی tapi.bale.ai صدا زده میشود؛ ورسل / GitHub / Supabase-write /
 *   API خصوصی روبیکا / scraping در کار نیست.
 *
 * مستندات رسمی: https://docs.bale.ai/  و  https://dev.bale.ai
 *   Base URL : https://tapi.bale.ai/bot<token>/METHOD_NAME
 *   getMe, getUpdates, sendMessage  |  sendMessage: chat_id + text (۱..۴۰۹۶)
 *
 * بستههای دیتابیس دوم همان MCPK1 رمزشدهاند. چون متن بله Markdown میشود،
 * زیرخط (_) داخل base64url را به %5F تبدیل میکنیم تا نمایش پیام بسته را
 * دستکاری نکند؛ هنگام برگشت دوباره به _ برگردانده میشود. متن خام ذخیرهشده
 * همچنان قابل تأیید با SHA-256 است.
 *
 * محدودیت صادقانه: بله «دیتابیس» نیست؛ آپدیتها فقط ۲۴ ساعت / ۲۰۰۰ پیام آخر
 * نگه داشته میشوند. منیفست محلی و دیتابیس اصلی همچنان مرجعاند و هیچ ردیفی
 * پاک یا ریست نمیشود.
 */

import { BALE_DESTINATION, SECOND_DB_KIND } from '../rubika/adapter.mjs';

export const BALE_API_ORIGIN = 'https://tapi.bale.ai';
export const MAX_BALE_TEXT = 4096;
export const DEFAULT_MIN_INTERVAL_MS = 600;
export const BALE_PACKET_PREFIX = 'MCB1.';
export const PACKET_PREFIX = 'MCPK1.';

function withCredentials(env, token, chatId) {
  return {
    ...env,
    BALE_BOT_TOKEN: token == null ? env.BALE_BOT_TOKEN : token,
    BALE_CHAT_ID: chatId == null ? env.BALE_CHAT_ID : chatId,
  };
}

function secretValues(env = process.env) {
  return [env.BALE_BOT_TOKEN, env.BALE_CHAT_ID]
    .filter((v) => typeof v === 'string' && v.trim().length >= 5)
    .map((v) => v.trim());
}

function assertNoSecret(text, env = process.env) {
  const s = String(text ?? '');
  for (const value of secretValues(env)) {
    if (s.includes(value)) throw new Error('SECRET_VALUE_IN_OUTPUT');
  }
  return s;
}

export function baleConfig(env = process.env) {
  const token = String(env.BALE_BOT_TOKEN || '').trim();
  const chatId = String(env.BALE_CHAT_ID || '').trim();
  return {
    configured: Boolean(token && chatId),
    tokenPresent: Boolean(token),
    chatIdPresent: Boolean(chatId),
    endpoint: BALE_API_ORIGIN,
    officialApi: true,
    vercelUsed: false,
    frontendSecrets: false,
    serverSideOnly: true,
    source: 'environment-only',
    // مقادیر token / chatId عمداً برگردانده نمیشوند.
  };
}

function assertToken(token) {
  const t = String(token || '').trim();
  if (!t) throw new Error('BALE_TOKEN_MISSING');
  // توکن بله مثل 123456789:abcd... است؛ فقط کاراکترهای امن مسیر مجازند.
  if (!/^[A-Za-z0-9:_-]+$/.test(t)) throw new Error('BALE_TOKEN_BAD_FORMAT');
  return t;
}

function methodUrl(method, token) {
  return `${BALE_API_ORIGIN}/bot${assertToken(token)}/${method}`;
}

export async function callBale(method, params = {}, {
  token = process.env.BALE_BOT_TOKEN,
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  const url = methodUrl(method, token);
  const resp = await fetchImpl(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  let body = null;
  try { body = await resp.json(); } catch { body = null; }
  const status = Number(resp.status) || 0;
  if (!resp.ok || !body || body.ok !== true) {
    const code = body && body.error_code ? body.error_code : status;
    const message = assertNoSecret(`BALE_${status}_${code}`, env);
    const err = new Error(message);
    err.status = status;
    err.retryAfter = Number(body?.parameters?.retry_after) || 0;
    err.retainedInPrimary = true;
    err.deleted = false;
    throw err;
  }
  return body.result;
}

export async function baleStatus(opts = {}) {
  const cfg = baleConfig(opts.env || process.env);
  if (!cfg.configured) {
    return { ...cfg, ready: false, message: 'متغیرهای محیط تنظیم نشدهاند؛ نیازی به چت/رمز نیست.' };
  }
  try {
    await callBale('getMe', {}, opts);
    return { ...cfg, ready: true, message: 'اتصال رسمی بله پاسخ داد (getMe).' };
  } catch (err) {
    return {
      ...cfg,
      ready: false,
      message: assertNoSecret(err?.message || 'BALE_UNREACHABLE', opts.env || process.env),
    };
  }
}

export function assertPlainText(text, env = process.env) {
  const s = assertNoSecret(String(text ?? ''), env);
  if (!s.length || s.length > MAX_BALE_TEXT) throw new Error('TEXT_LENGTH_OUT_OF_RANGE');
  if (/[\x00-\x1f\x7f]/.test(s)) throw new Error('CONTROL_CHAR_IN_TEXT');
  return s;
}

export async function sendDirectMessage({
  chatId = process.env.BALE_CHAT_ID,
  text,
  token = process.env.BALE_BOT_TOKEN,
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  const c = String(chatId || '').trim();
  if (!c) throw new Error('BALE_CHAT_ID_MISSING');
  const effectiveEnv = withCredentials(env, token, c);
  const body = assertPlainText(text, effectiveEnv);
  assertToken(token);
  const result = await callBale('sendMessage', { chat_id: c, text: body }, { token, fetchImpl, env: effectiveEnv });
  const out = {
    ok: true,
    destination: BALE_DESTINATION,
    officialApi: true,
    vercelUsed: false,
    frontendSecrets: false,
    textLength: body.length,
    messageId: result && result.message_id != null ? result.message_id : null,
    endpoint: BALE_API_ORIGIN,
    retainedInPrimary: true,
    deleted: false,
  };
  assertNoSecret(JSON.stringify(out), effectiveEnv);
  return out;
}

export function encodePacketForBale(packet, env = process.env) {
  const p = assertNoSecret(String(packet ?? '').trim(), env);
  if (!p.startsWith(PACKET_PREFIX)) throw new Error('NOT_MCPK1_PACKET');
  if (/[\x00-\x1f\x7f]/.test(p)) throw new Error('CONTROL_CHAR_IN_PACKET');
  const encoded = BALE_PACKET_PREFIX + p.replace(/_/g, '%5F');
  if (encoded.length > MAX_BALE_TEXT) throw new Error('PACKET_TOO_LARGE_FOR_BALE');
  return encoded;
}

export function decodePacketFromBale(text, env = process.env) {
  const s = assertNoSecret(String(text ?? '').trim(), env);
  if (!s.startsWith(BALE_PACKET_PREFIX)) return null;
  return s.slice(BALE_PACKET_PREFIX.length).replace(/%5F/g, '_');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function sendBalePacket(opts = {}) {
  const { packet, ...rest } = opts;
  const env = withCredentials(rest.env || process.env, rest.token, rest.chatId);
  const text = encodePacketForBale(packet, env);
  return sendDirectMessage({ ...rest, text, env });
}

export async function deliverBatch({
  packets, manifest,
  chatId = process.env.BALE_CHAT_ID,
  token = process.env.BALE_BOT_TOKEN,
  fetchImpl = globalThis.fetch,
  minIntervalMs = DEFAULT_MIN_INTERVAL_MS,
  env = process.env,
} = {}) {
  if (!Array.isArray(packets) || !packets.length) throw new Error('NO_PACKETS');
  if (!manifest || manifest.kind !== SECOND_DB_KIND) throw new Error('BAD_MANIFEST');
  const cfg = baleConfig({ BALE_BOT_TOKEN: token, BALE_CHAT_ID: chatId });
  if (!cfg.configured) throw new Error('BALE_CREDENTIALS_MISSING');
  const effectiveEnv = withCredentials(env, token, chatId);
  const results = [];
  for (let i = 0; i < packets.length; i++) {
    if (i > 0 && minIntervalMs > 0) await sleep(minIntervalMs);
    let lastErr = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const r = await sendBalePacket({
          packet: packets[i], chatId, token, fetchImpl, env: effectiveEnv,
        });
        results.push({ index: i, ok: true, messageId: r.messageId, textLength: r.textLength });
        lastErr = null;
        break;
      } catch (err) {
        lastErr = err;
        const wait = err.retryAfter ? err.retryAfter * 1000 : 400 * attempt;
        if (attempt < 3) await sleep(wait);
      }
    }
    if (lastErr) {
      throw Object.assign(new Error('BALE_DELIVERY_INCOMPLETE'), {
        sentCount: results.length,
        total: packets.length,
        failedAtIndex: i,
        retainedInPrimary: true,
        deleted: false,
        noDelete: true,
        destructiveOperations: [],
        results,
      });
    }
  }
  const summary = {
    ok: results.length === packets.length,
    destination: BALE_DESTINATION,
    officialApi: true,
    vercelUsed: false,
    frontendSecrets: false,
    sentCount: results.length,
    total: packets.length,
    batchId: manifest.batchId,
    envelopeSha256: manifest.envelopeSha256,
    sourceManifestDestination: manifest.destination,
    retainedInPrimary: true,
    deleted: false,
    destructiveOperations: [],
    results,
  };
  assertNoSecret(JSON.stringify(summary), effectiveEnv);
  return summary;
}

export async function getBaleUpdates({
  offset = 0, limit = 100, timeout = 0,
  token = process.env.BALE_BOT_TOKEN,
  fetchImpl = globalThis.fetch,
  env = process.env,
} = {}) {
  const effectiveEnv = withCredentials(env, token, null);
  const result = await callBale('getUpdates', { offset, limit, timeout }, { token, fetchImpl, env: effectiveEnv });
  return Array.isArray(result) ? result : [];
}

export function discoverChatId(updates) {
  for (const u of updates || []) {
    const chat = u?.message?.chat || u?.edited_message?.chat;
    if (chat && chat.id != null) return String(chat.id);
  }
  return null;
}

export function receivePackets(updates, env = process.env) {
  const packets = [];
  let maxUpdateId = 0;
  for (const u of updates || []) {
    maxUpdateId = Math.max(maxUpdateId, Number(u?.update_id) || 0);
    const text = u?.message?.text ?? u?.edited_message?.text;
    const decoded = decodePacketFromBale(text, env);
    if (decoded) packets.push(decoded);
  }
  return {
    ok: true,
    destination: BALE_DESTINATION,
    officialApi: true,
    packetCount: packets.length,
    packets,
    nextOffset: maxUpdateId ? maxUpdateId + 1 : 0,
    retainedInPrimary: true,
    deleted: false,
    destructiveOperations: [],
    note: 'بله فقط ۲۴ ساعت / ۲۰۰۰ آپدیت آخر را نگه میدارد؛ منیفست محلی مرجع است.',
  };
}
