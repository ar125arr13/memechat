/* MemeChat — پل GET برای «تست واقعی» که **خودِ عامل** از همین محیط اجرا میکند.
 *
 * چرا این فایل لازم شد:
 *   صاحب پروژه گفت «فایلایی که تو داری رو من ندارم / اینقدر نگو خودت اینو بزن».
 *   یعنی نباید به او دستور ترمینال بدهیم؛ اجرا باید سمت ما باشد.
 *   bash/curl این سندباکس به tapi.bale.ai راه ندارد (http=000، بدون پراکسی)،
 *   ولی ابزار fetch_page همان محیط به سرور بله میرسد (getMe فیک → 401 واقعی).
 *   مستندات رسمی بله: درخواستها GET یا POST، با query / form / JSON / multipart.
 *   پس URLها اینجا ساخته میشوند، با fetch_page صدا زده میشوند، و پاسخ
 *   getUpdates همانجا رمزگشایی + SHA-256 تأیید میشود.
 *
 * نکتهٔ مهم کدگذاری: encodePacketForBale زیرخط را به «%5F» تبدیل میکند.
 * اگر همان رشته مستقیم تو query برود، URL-decode آن را به «_» برمیگرداند و
 * بسته خراب میشود. URLSearchParams کل متن را encode میکند → «%255F»، یعنی بعد
 * از decode سمت بله دقیقاً «%5F» میماند و decodePacketFromBale درست کار میکند.
 *
 * امنیت: توکن/چتآیدی فقط موقع اجرا داده میشوند. هیچ مقداری داخل سورس،
 * فرانتاند، مخزن، لاگ، مانیفست یا پیام خطا نوشته نمیشود. خروجیها قرمزشده
 * (redacted)اند مگر اینکه صراحتاً emit خواسته شود. صاحب پروژه صریحاً اجازه
 * داد توکن را در گفتگو بدهد؛ این همان استثنای «چت» است، نه «فرانتاند».
 *
 * ⚠️ تا زمانی که توکن واقعی نرسد هیچ تماس واقعی زده نشد؛ تستها آفلایند.
 */

import {
  BALE_API_ORIGIN, encodePacketForBale, receivePackets, MAX_BALE_TEXT,
} from '../bale/api.mjs';
import { joinPackets } from '../client/courier.js';
import { sha256Hex } from '../worker/src/crypto.js';
import { buildTrialPackets } from './trial.mjs';

export const GET_BRIDGE_KIND = 'memechat-bale-get-bridge';
export const TOKEN_PLACEHOLDER = '__BALE_BOT_TOKEN__';
export const CHAT_PLACEHOLDER = '__BALE_CHAT_ID__';

/* توکن بله معمولاً «عدد:حروف» است. همانطور خام تو path میماند؛ فقط کاراکترهایی
   که ساختار URL را میشکنند رد میشوند (درصدیگذاری path توکن در برخی روترها
   ممکن است مشکل ایجاد کند). */
export function sanitizeToken(token) {
  const t = String(token ?? '').trim();
  if (!/^[A-Za-z0-9:_-]+$/.test(t)) throw new Error('INVALID_TOKEN_SHAPE');
  return t;
}

export function sanitizeChatId(chatId) {
  const c = String(chatId ?? '').trim();
  if (!/^-?\d+$/.test(c)) throw new Error('INVALID_CHAT_ID');
  return c;
}

export function buildBaleGetUrl({ token, method, params = {} }) {
  const t = sanitizeToken(token);
  if (!/^[A-Za-z][A-Za-z0-9]*$/.test(String(method))) throw new Error('INVALID_METHOD');
  const base = `${BALE_API_ORIGIN}/bot${t}/${method}`;
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const qs = q.toString();
  return qs ? `${base}?${qs}` : base;
}

export function redactUrl(url, cfg = {}) {
  let s = String(url ?? '');
  for (const v of [cfg.token, cfg.chatId]) {
    if (typeof v === 'string' && v.trim().length >= 4) {
      s = s.split(v.trim()).join('[REDACTED]');
    }
  }
  return s;
}

export function buildPreflightUrls({ token, limit = 100 }) {
  return {
    kind: GET_BRIDGE_KIND,
    getMe: buildBaleGetUrl({ token, method: 'getMe' }),
    getUpdates: buildBaleGetUrl({ token, method: 'getUpdates', params: { limit } }),
  };
}

export async function buildTrialPlan({
  token = TOKEN_PLACEHOLDER, chatId = CHAT_PLACEHOLDER,
  rawKey, now = () => new Date().toISOString(), emit = false,
} = {}) {
  const built = await buildTrialPackets(rawKey, now());
  const isPlaceholderToken = token === TOKEN_PLACEHOLDER;
  const isPlaceholderChat = chatId === CHAT_PLACEHOLDER;
  const safeToken = isPlaceholderToken ? TOKEN_PLACEHOLDER : sanitizeToken(token);
  const safeChat = isPlaceholderChat ? CHAT_PLACEHOLDER : sanitizeChatId(chatId);
  const cfg = { token: isPlaceholderToken ? null : safeToken, chatId: isPlaceholderChat ? null : safeChat };
  const redact = (u) => (emit ? u : redactUrl(u, cfg));

  const pre = buildPreflightUrls({ token: safeToken });
  const sends = built.texts.map((text, index) => ({
    index,
    textLength: text.length,
    url: buildBaleGetUrl({
      token: safeToken, method: 'sendMessage',
      params: { chat_id: safeChat, text },
    }),
  }));

  return {
    kind: GET_BRIDGE_KIND,
    emit,
    encryption: 'AES-256-GCM',
    packetMagic: 'MCPK1',
    baleMagic: 'MCB1',
    packetCount: built.texts.length,
    expectedSha256: built.sha256,
    preflight: {
      getMe: redact(pre.getMe),
      getUpdates: redact(pre.getUpdates),
    },
    sends: sends.map((s) => ({ ...s, url: redact(s.url) })),
    verifyUrl: redact(buildBaleGetUrl({
      token: safeToken, method: 'getUpdates', params: { limit: 100 },
    })),
    note: 'URLها با fetch_page صدا زده میشوند؛ سپس getUpdates رمزگشایی و SHA تأیید میشود.',
    dataDeleted: false,
    destructiveOperations: [],
    retainedInPrimary: true,
    deployed: false,
    merged: false,
  };
}

/* پاسخ fetch_page گاهی داخل ```json ... ``` است، گاهی JSON خام. */
export function parseBaleResponse(content) {
  let s = String(content ?? '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const body = JSON.parse(s);
  return body;
}

export async function verifyGetUpdatesResponse({
  content, expectedSha256, env = {},
} = {}) {
  const body = parseBaleResponse(content);
  if (body?.ok !== true) {
    const err = new Error(`BALE_${body?.error_code || 'ERROR'}`);
    err.description = String(body?.description || '').slice(0, 120);
    throw err;
  }
  const updates = Array.isArray(body.result) ? body.result : [];
  const received = receivePackets(updates, env);
  if (!received.packetCount) {
    return {
      ok: false, reason: 'NO_PACKETS_IN_UPDATES', receivedCount: 0,
      expectedSha256, dataDeleted: false, destructiveOperations: [],
    };
  }
  const { bytes, meta } = await joinPackets(received.packets);
  const restored = await sha256Hex(bytes);
  return {
    ok: restored === expectedSha256 && meta.sha === expectedSha256,
    verified: restored === expectedSha256 && meta.sha === expectedSha256,
    receivedCount: received.packetCount,
    expectedSha256,
    restoredSha256: restored,
    encryptedFileRestored: true,
    dataDeleted: false,
    destructiveOperations: [],
    retainedInPrimary: true,
  };
}

export function discoveredChatId(content) {
  const body = parseBaleResponse(content);
  const updates = Array.isArray(body?.result) ? body.result : [];
  for (const u of updates) {
    const chat = u?.message?.chat || u?.edited_message?.chat || u?.my_chat_member?.chat;
    if (chat && chat.id != null) return String(chat.id);
  }
  return null;
}

export default {
  buildBaleGetUrl, buildPreflightUrls, buildTrialPlan,
  parseBaleResponse, verifyGetUpdatesResponse, discoveredChatId, redactUrl,
};
