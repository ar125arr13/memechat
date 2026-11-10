/* MemeChat — API رسمی «بله» مستقیم از سورس کلاینت، بدون بکاند.
 *
 * این فایل **همان چیزی است که خواسته شد**: آدرس API، متدها و کد ارسال
 * بستههای رمزشده همینجا تو سورساند؛ نه CLI جدا، نه سرور، نه ورسل، نه Worker.
 *
 *   POST https://tapi.bale.ai/bot<TOKEN>/sendMessage
 *   { "chat_id": <بازوی بیکار>, "text": "MCB1.MCPK1...." }
 *
 * قانون ثابت پروژه همچنان پابرجاست: **هیچ توکن/چتآیدی تو سورس نیست**.
 * TOKEN و chatIds فقط «موقع اجرا» به سازنده داده میشوند (مثلاً از ورودی
 * مالک یا sessionStorage مرورگر خودش). مقدارشان هرگز تو لاگ، پیام خطا،
 * گزارش یا چت ظاهر نمیشود. این فایل فقط *کد* API را نگه میدارد.
 *
 * بستهها همان MCPK1 رمزشدهٔ AES-256-GCMاند؛ بازو فقط ciphertext میبیند.
 * متن بله Markdown است، پس `_` داخل base64url به `%5F` تبدیل و هنگام
 * برگشت برگردانده میشود تا پاکت دستکاری نشود.
 *
 * ⚠️ دو محدودیت واقعی که وانمود نشده (پایینتر تو سند هم نوشته شد):
 *   1) CSP فعلی فقط self + supabase.co را اجازه میدهد. برای اجرای واقعی
 *      باید `https://tapi.bale.ai` به connect-src اضافه شود:
 *        connect-src 'self' https://teylquevemmkrgswnwtx.supabase.co https://tapi.bale.ai
 *      چون `index.html` زنده مال این مخزن نیست، بدون اجازه اعمال نشد.
 *   2) CORS بله برای مرورگر تو مستندات رسمی تأیید نشده. اگر پاسخ خواندنی
 *      نبود، با `mode:'no-cors'` ارسال انجام میشود ولی `verified:false`
 *      گزارش میشود؛ یعنی ادعای «رسید» نمیکنیم. هیچ حذفی انجام نمیشود.
 *
 * منبع رسمی: https://docs.bale.ai/  |  https://dev.bale.ai
 */

export const BALE_API_ORIGIN = 'https://tapi.bale.ai';
export const PACKET_PREFIX = 'MCPK1.';
export const BALE_PACKET_PREFIX = 'MCB1.';
export const MAX_BALE_TEXT = 4096;
export const DEFAULT_MIN_INTERVAL_MS = 600;
export const BALE_DIRECT_DESTINATION = 'bale-direct-frontend';

export const REQUIRED_CSP_CONNECT_SRC =
  "connect-src 'self' https://teylquevemmkrgswnwtx.supabase.co https://tapi.bale.ai";

function toArray(v) {
  return Array.isArray(v) ? v : (v == null || v === '' ? [] : [v]);
}

function secretValues(cfg = {}) {
  return [cfg.token, ...toArray(cfg.chatIds)]
    .filter((v) => typeof v === 'string' && v.trim().length >= 4)
    .map((v) => v.trim());
}

export function assertNoSecret(text, cfg = {}) {
  const s = String(text ?? '');
  for (const value of secretValues(cfg)) {
    if (s.includes(value)) throw new Error('SECRET_VALUE_IN_OUTPUT');
  }
  return s;
}

export function redact(text, cfg = {}) {
  let s = String(text ?? '');
  for (const value of secretValues(cfg)) s = s.split(value).join('[REDACTED]');
  return s;
}

/* فقط موقع اجرا؛ هیچ مقداری تو سورس ذخیره نشده. */
export function readRuntimeConfig(storage = globalThis.sessionStorage) {
  if (!storage) return { token: '', chatIds: [] };
  let token = '';
  let chatIds = [];
  try { token = String(storage.getItem('mc.bale.token') || '').trim(); } catch { /* no storage */ }
  try { chatIds = JSON.parse(storage.getItem('mc.bale.chatIds') || '[]'); } catch { chatIds = []; }
  return { token, chatIds: toArray(chatIds).map((v) => String(v).trim()).filter(Boolean) };
}

function assertToken(token) {
  const t = String(token || '').trim();
  if (!t) throw new Error('BALE_TOKEN_MISSING');
  if (!/^[A-Za-z0-9:_-]+$/.test(t)) throw new Error('BALE_TOKEN_BAD_FORMAT');
  return t;
}

export function assertPlainText(text, cfg = {}) {
  const s = assertNoSecret(String(text ?? ''), cfg);
  if (!s.length || s.length > MAX_BALE_TEXT) throw new Error('TEXT_LENGTH_OUT_OF_RANGE');
  if (/[\x00-\x1f\x7f]/.test(s)) throw new Error('CONTROL_CHAR_IN_TEXT');
  return s;
}

export function encodePacketForBale(packet, cfg = {}) {
  const p = assertNoSecret(String(packet ?? '').trim(), cfg);
  if (!p.startsWith(PACKET_PREFIX)) throw new Error('NOT_MCPK1_PACKET');
  if (/[\x00-\x1f\x7f]/.test(p)) throw new Error('CONTROL_CHAR_IN_PACKET');
  const encoded = BALE_PACKET_PREFIX + p.replace(/_/g, '%5F');
  if (encoded.length > MAX_BALE_TEXT) throw new Error('PACKET_TOO_LARGE_FOR_BALE');
  return encoded;
}

export function decodePacketFromBale(text, cfg = {}) {
  const s = assertNoSecret(String(text ?? '').trim(), cfg);
  if (!s.startsWith(BALE_PACKET_PREFIX)) return null;
  return s.slice(BALE_PACKET_PREFIX.length).replace(/%5F/g, '_');
}

export function discoverChatIds(updates) {
  const ids = [];
  for (const u of updates || []) {
    const chat = u?.message?.chat || u?.edited_message?.chat;
    if (chat && chat.id != null) {
      const id = String(chat.id);
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class BaleDirectClient {
  constructor({
    token = '', chatIds = [], fetchImpl = globalThis.fetch,
    minIntervalMs = DEFAULT_MIN_INTERVAL_MS, allowOpaque = true,
  } = {}) {
    this.token = String(token || '').trim();
    this.chatIds = toArray(chatIds).map((v) => String(v).trim()).filter(Boolean);
    this.fetchImpl = fetchImpl;
    this.minIntervalMs = minIntervalMs;
    this.allowOpaque = allowOpaque;
    this._cfg = { token: this.token, chatIds: this.chatIds };
  }

  get configured() { return Boolean(this.token && this.chatIds.length); }
  get endpoint() { return BALE_API_ORIGIN; }
  get backend() { return false; }

  _url(method) {
    return `${BALE_API_ORIGIN}/bot${assertToken(this.token)}/${method}`;
  }

  async _call(method, params = {}) {
    const url = this._url(method);
    const init = {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    };
    let resp;
    try {
      resp = await this.fetchImpl(url, init);
    } catch (err) {
      if (!this.allowOpaque) {
        throw new Error(redact(err?.message || 'BALE_NETWORK_ERROR', this._cfg));
      }
      // CORS/CSP: درخواست میرود ولی پاسخ قابل خواندن نیست. صادقانه علامت میزنیم.
      await this.fetchImpl(url, { ...init, mode: 'no-cors' });
      return {
        ok: true, result: null, verified: false, mode: 'no-cors',
        note: 'پاسخ بله از مرورگر خوانده نشد؛ تحویل تأیید نشد، ولی چیزی پاک نشد.',
      };
    }
    let body = null;
    try { body = await resp.json(); } catch { body = null; }
    const status = Number(resp.status) || 0;
    if (!resp.ok || (body && body.ok === false)) {
      const code = body?.error_code ?? status;
      const err = new Error(redact(`BALE_${status}_${code}`, this._cfg));
      err.status = status;
      err.retryAfter = Number(body?.parameters?.retry_after) || 0;
      err.deleted = false;
      throw err;
    }
    return { ok: true, result: body?.result ?? null, verified: true, mode: 'cors' };
  }

  async getMe() { return this._call('getMe', {}); }

  async getUpdates({ offset = 0, limit = 100, timeout = 0 } = {}) {
    const r = await this._call('getUpdates', { offset, limit, timeout });
    return { updates: Array.isArray(r.result) ? r.result : [], verified: r.verified, mode: r.mode };
  }

  async sendDirectMessage({ chatId, text }) {
    const c = String(chatId || this.chatIds[0] || '').trim();
    if (!c) throw new Error('BALE_CHAT_ID_MISSING');
    const body = assertPlainText(text, this._cfg);
    const r = await this._call('sendMessage', { chat_id: c, text: body });
    return {
      ok: true,
      verified: r.verified,
      mode: r.mode,
      textLength: body.length,
      messageId: r.result && r.result.message_id != null ? r.result.message_id : null,
    };
  }

  async sendPacket({ packet, chatId }) {
    const encoded = encodePacketForBale(packet, this._cfg);
    return this.sendDirectMessage({ chatId, text: encoded });
  }

  /* هر بستهٔ رمزشده را برای تکـتک «بازوهای بیکار» میفرستد. */
  async sendPackets({ packets, chatIds = this.chatIds, onProgress } = {}) {
    if (!Array.isArray(packets) || !packets.length) throw new Error('NO_PACKETS');
    const targets = toArray(chatIds).map((v) => String(v).trim()).filter(Boolean);
    if (!this.configured || !targets.length) throw new Error('BALE_RUNTIME_CONFIG_MISSING');
    const total = packets.length * targets.length;
    const results = [];
    let index = 0;
    for (const packet of packets) {
      encodePacketForBale(packet, this._cfg); // زود رد کند، قبل از هر ارسال
      for (const chatId of targets) {
        if (index > 0 && this.minIntervalMs > 0) await sleep(this.minIntervalMs);
        let lastErr = null;
        for (let attempt = 1; attempt <= 3; attempt++) {
          try {
            const r = await this.sendPacket({ packet, chatId });
            results.push({
              index, ok: true, verified: r.verified, mode: r.mode,
              messageId: r.messageId, textLength: r.textLength,
            });
            if (onProgress) onProgress({ sent: results.length, total });
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
            total,
            failedAtIndex: index,
            retainedInPrimary: true,
            deleted: false,
            noDelete: true,
            destructiveOperations: [],
            results,
          });
        }
        index++;
      }
    }
    const verifiedCount = results.filter((r) => r.verified).length;
    const summary = {
      ok: results.length === total,
      destination: BALE_DIRECT_DESTINATION,
      officialApi: true,
      backend: false,
      vercelUsed: false,
      frontendSecretInSource: false,
      tokenSuppliedAtRuntime: true,
      endpoint: BALE_API_ORIGIN,
      requiredCspConnectSrc: REQUIRED_CSP_CONNECT_SRC,
      idleBotCount: targets.length,
      packetCount: packets.length,
      sentCount: results.length,
      total,
      verifiedCount,
      unverifiedCount: total - verifiedCount,
      opaqueFallbackUsed: results.some((r) => r.mode === 'no-cors'),
      retainedInPrimary: true,
      deleted: false,
      destructiveOperations: [],
      results,
    };
    assertNoSecret(JSON.stringify(summary), this._cfg);
    return summary;
  }
}

export default BaleDirectClient;
