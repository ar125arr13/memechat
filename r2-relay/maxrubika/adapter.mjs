/* MemeChat — «دیتابیس دوم» روی پیامهای ذخیرهشدهٔ روبیکا (Saved Messages)
 * با کتابخانهٔ MAXRubika.
 *
 * چرا: صاحب پروژه گفت «فایلای بله رو پاک کن / بریم یه پیامرسان دیگه /
 * مثلا با maxrubika و سیو مسیج روبیکا اوکیش کن».
 *
 * صداقت فنی (مهم):
 *   - MAXRubika یک کتابخانهٔ **غیررسمی / یوزربات (self-bot)** است، نه API رسمی
 *     رباتهای روبیکا. هیچ توکن باتی لازم نیست؛ ولی «سشن حساب شخصی» لازم است
 *     که یکبار روی دستگاه خودتان با شماره + کد تأیید ساخته میشود.
 *   - پروتکلش خصوصی/مهندسی-معکوس است؛ ممکن است با تغییر روبیکا بشکند و
 *     self-bot میتواند خلاف شرایط سرویس باشد. ادعای پایداری نمیکنیم.
 *   - پایتون است، پس **تو مرورگر اجرا نمیشود**. برخلاف مسیر قبلیِ «API داخل
 *     سورس کلاینت»، اینجا یک فرآیند محلی/سرور خودتان لازم است. بدون ورسل،
 *     بدون دیپلوی، بدون بکاند عمومی.
 *   - هیچ کلید/سشن/OTPـای داخل سورس، فرانتاند، لاگ، چت یا مخزن نیست. فقط
 *     «نام سشن» موقع اجرا از env خوانده میشود.
 *   - صفر DELETE / DROP / TRUNCATE / RESET. متد delete_messages عمداً صدا
 *     زده نمیشود؛ پیامهای قدیمی Saved Messages دستنخورده میمانند.
 *
 * متدها فقط از مستندات و سورس رسمی پکیج تأیید شدهاند:
 *   Messenger(session), send_message(chat='me', text=...),
 *   send_file(chat='me', file=...), get_last_messages(chat, limit=...),
 *   get_chat_messages(...), app.guid  (GUID حساب خودتان)
 * نکته: در این نسخه get_guid('me') پشتیبانی نمیشود؛ send_message مقدار 'me'
 * را داخل خودش به self.guid تبدیل میکند، ولی متدهای خواندن از get_guid رد
 * میشوند. پس برای برگشت، GUID واقعی حساب (app.guid) داده میشود.
 *
 * منابع:
 *   https://github.com/MEH2RAB/maxrubika
 *   https://pypi.org/project/maxrubika/
 *   https://meh2rab.github.io/maxrubika/client-messages-send/
 *   https://meh2rab.github.io/maxrubika/client-messages-fetch/
 *   https://meh2rab.github.io/maxrubika/ai/
 */

import { makePackets, joinPackets } from '../client/courier.js';
import {
  sha256Hex, unb64url, fromUtf8, b64url, utf8, hex, randomBytes,
} from '../worker/src/crypto.js';
import { StorageDriver, publishEncrypted } from '../client/storage-adapter.js';

export const MAXRUBIKA_DESTINATION = 'rubika-saved-messages';
export const SAVED_MESSAGES_CHAT = 'me';
export const SAVED_MESSAGES_PREFIX = 'MCR1.';   // MemeChat Rubika 1
export const DEFAULT_PACKET_LIMIT = 100;
export const PACKET_MAGIC = 'MCPK1';

/* متن روبیکا قالببندی دارد؛ زیرخط base64url را به %5F تبدیل میکنیم تا
   نمایش پیام بسته را خراب نکند. برگشت معکوس است. */
export function encodePacketForSavedMessages(packet) {
  const p = String(packet ?? '').trim();
  if (!p.startsWith(`${PACKET_MAGIC}.`)) throw new Error('NOT_MCPK1_PACKET');
  if (/[\x00-\x1f\x7f]/.test(p)) throw new Error('CONTROL_CHAR_IN_PACKET');
  return SAVED_MESSAGES_PREFIX + p.replace(/_/g, '%5F');
}

export function decodePacketFromSavedMessages(text) {
  const s = String(text ?? '').trim();
  if (!s.startsWith(SAVED_MESSAGES_PREFIX)) return null;
  return s.slice(SAVED_MESSAGES_PREFIX.length).replace(/%5F/g, '_');
}

export function packetId(packet) {
  try {
    const parts = String(packet).split('.');
    if (parts[0] !== PACKET_MAGIC) return null;
    return JSON.parse(fromUtf8(unb64url(parts[1]))).id ?? null;
  } catch { return null; }
}

export function collectSavedMessagesTexts(messages) {
  const packets = [];
  const seen = new Set();
  for (const m of messages || []) {
    // نام فیلدها در پاسخ Data ممکن است متفاوت باشد؛ فقط متن خام را میگیریم.
    const raw = typeof m === 'string' ? m
      : (m?.text ?? m?.message?.text ?? m?.caption ?? m?.file_inline?.text ?? null);
    const decoded = decodePacketFromSavedMessages(raw);
    if (decoded && !seen.has(decoded)) { seen.add(decoded); packets.push(decoded); }
  }
  return packets;
}

/* ترانسپورت تزریقشده: { send(texts), receive(limit), describe() }.
   نمونهٔ واقعی همان saved_messages.py است؛ نمونهٔ آفلاین mock.py / fixture. */
export class SavedMessagesDriver extends StorageDriver {
  constructor({ transport, chunkSize = 900, guid = null } = {}) {
    super(MAXRUBIKA_DESTINATION);
    if (!transport || typeof transport.send !== 'function' || typeof transport.receive !== 'function') {
      throw new Error('SAVED_MESSAGES_TRANSPORT_REQUIRED');
    }
    this.transport = transport;
    this.chunkSize = chunkSize;
    this.guid = guid;
    this.store = new Map();
    this.confirmed = new Map();
    this.sentTexts = [];
    this.sentBatches = new Map();   // id → { sha, packets }
  }

  async put(k, b) {
    const bytes = new Uint8Array(b);
    const sha = await sha256Hex(bytes);
    // هم staging و هم نسخهٔ قابلخواندن محلی میماند؛ هیچی پاک نمیشود.
    this.store.set(k, bytes);
    this.store.set(`blob/${sha}`, bytes);
    const packets = await makePackets(bytes, { id: k, chunkSize: this.chunkSize });
    const texts = packets.map(encodePacketForSavedMessages);
    const report = await this.transport.send(texts);
    this.sentTexts.push(...texts);
    this.sentBatches.set(k, { sha, packets: packets.length });
    return {
      key: k,
      sha,
      packets: packets.length,
      destination: MAXRUBIKA_DESTINATION,
      chat: SAVED_MESSAGES_CHAT,
      reported: report ?? null,
      deleted: false,
      retainedInPrimary: true,
    };
  }

  async get(k) {
    const v = this.store.get(k);
    if (!v) throw new Error(`missing ${k}`);
    return new Uint8Array(v);
  }
  async has(k) { return this.store.has(k); }

  async delete(_k) {
    throw new Error('SAVED_MESSAGES_NO_DELETE: پیامهای ذخیرهشده پاک نمیشوند');
  }

  async pull(limit = DEFAULT_PACKET_LIMIT) {
    const messages = await this.transport.receive(limit);
    return collectSavedMessagesTexts(messages);
  }

  /* برگشت واقعی: بستهها از Saved Messages خوانده میشوند، بر اساس id گروهبندی
     و هر گروه join + SHA-256 با همان چیزی که فرستادیم مقایسه میشود. */
  async roundTrip(limit = DEFAULT_PACKET_LIMIT) {
    const packets = await this.pull(limit);
    const groups = new Map();
    for (const p of packets) {
      const id = packetId(p);
      if (!id) continue;
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id).push(p);
    }
    const results = [];
    for (const [id, group] of groups) {
      const sent = this.sentBatches.get(id);
      if (!sent) continue;                       // پیام نامربوطِ کاربر، نادیده
      try {
        const { bytes, meta } = await joinPackets(group);
        const sha = await sha256Hex(bytes);
        results.push({
          id,
          expectedSha256: sent.sha,
          restoredSha256: sha,
          packets: group.length,
          expectedPackets: sent.packets,
          verified: sha === sent.sha && meta.sha === sent.sha
            && group.length === sent.packets,
        });
      } catch (err) {
        results.push({ id, verified: false, reason: err?.message || 'JOIN_FAILED' });
      }
    }
    return {
      ok: results.length > 0 && results.every((r) => r.verified),
      receivedCount: packets.length,
      matchedBatches: results.length,
      results,
      deleted: false,
      destructiveOperations: [],
      retainedInPrimary: true,
    };
  }
}

export async function publishForSavedMessages({
  driver, plain, key, chunkSize = 256 * 1024, batchId, aad = '',
} = {}) {
  const manifest = await publishEncrypted({ driver, plain, key, chunkSize, batchId, aad });
  return {
    ...manifest,
    // هر put با موفقیت به Saved Messages فرستاده شد؛ نسخهٔ محلی هم نگه داشته
    // شد تا readEncrypted همان را بخواند. صفر حذف.
    status: 'confirmed',
    destination: MAXRUBIKA_DESTINATION,
    carrier: SAVED_MESSAGES_CHAT,
    officialApiUsed: false,
    botTokenUsed: false,
    vercelUsed: false,
    frontendSecrets: false,
    primaryRowsUntouched: true,
    noDelete: true,
    deleted: false,
    destructiveOperations: [],
    confirmedAt: new Date().toISOString(),
  };
}

export async function verifySavedMessagesDelivery({ driver, limit = DEFAULT_PACKET_LIMIT } = {}) {
  return driver.roundTrip(limit);
}

export default SavedMessagesDriver;
