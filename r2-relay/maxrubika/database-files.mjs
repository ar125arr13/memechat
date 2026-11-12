/* MemeChat — «فایلهای دیتابیس» → رمزگذاری → پیامهای ذخیرهشدهٔ روبیکا.
 *
 * تفاوت با نسخهٔ قبلی `maxrubika/`: آنجا ورودی `randomBytes` بود؛ اینجا
 * ورودی **فایلهای خروجی دیتابیس** است (همان جدولها/فیلدهای `rubika/adapter.mjs`
 * که از Supabase فقط SELECT میشوند). هر فایل جداگانه AES-256-GCM میشود،
 * به بستههای `MCPK1` و سپس متنهای `MCR1` تبدیل میشود و تحویل ترانسپورت
 * (Saved Messages) داده میشود. متنی که روبیکا میبیند **فقط ciphertext** است.
 *
 * قوانین ثابت پروژه:
 *   - صفر حذف/ریست؛ `delete_messages` / `DELETE` / `rtype=3` صدا زده نمیشود.
 *   - فقط SELECT از دیتابیس اصلی؛ ساختار، نام جدولها، فیلدها و ردیفها حفظ
 *     میشوند (هیچ فیلد اضافهای به دادهها تزریق نمیشود).
 *   - کلید رمزگذاری فقط runtime/محیط امن؛ هیچ شماره، OTP، سشن، توکن یا
 *     private_keyـای داخل سورس، چت، لاگ، فرانتاند یا مخزن نیست.
 *   - MAXRubika غیررسمی/self-bot است؛ برای ارسال **واقعی** یک سشن محلی
 *     (MC_MAXRUBIKA_SESSION) لازم است که یکبار روی دستگاه صاحب پروژه ساخته
 *     میشود. این ماژول لاگین نمیکند و شمارهای نمیگیرد.
 *   - بدون API رسمی روبیکا، بدون توکن بات، بدون ورسل، بدون دیپلوی، بدون مرج.
 */

import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { utf8, sha256Hex } from '../worker/src/crypto.js';
import { joinPackets } from '../client/courier.js';
import { readEncrypted } from '../client/storage-adapter.js';
import { TABLES, fixtureTables } from '../rubika/adapter.mjs';
import {
  SavedMessagesDriver, publishForSavedMessages, verifySavedMessagesDelivery,
  decodePacketFromSavedMessages, packetId,
  MAXRUBIKA_DESTINATION, SAVED_MESSAGES_CHAT, DEFAULT_PACKET_LIMIT,
} from './adapter.mjs';

export const DATABASE_FILE_KIND = 'memechat-db-files-saved-messages';
export const DATABASE_FILE_VERSION = 1;
export const SESSION_ENV = 'MC_MAXRUBIKA_SESSION';
export const ENCRYPTION_ALGORITHM = 'AES-256-GCM';

/* تبدیل جدولها به «فایلهای دیتابیس»: یک فایل JSON بهازای هر جدول.
 * `columns` همان فهرست فیلدهای زنده است؛ فقط متادیتاست، به ردیفها دست نمیزند. */
export function serializeDatabaseFiles(tables) {
  if (!tables || typeof tables !== 'object') throw new Error('TABLES_REQUIRED');
  return Object.entries(tables).map(([table, rows]) => {
    const list = Array.isArray(rows) ? rows : [];
    const body = JSON.stringify({
      kind: DATABASE_FILE_KIND,
      version: DATABASE_FILE_VERSION,
      table,
      columns: TABLES[table] ? [...TABLES[table]] : null,
      rows: list,
    }, null, 2);
    return {
      name: `${table}.json`,
      table,
      rowCount: list.length,
      columnsPreserved: TABLES[table] ? [...TABLES[table]] : null,
      bytes: utf8(body),
    };
  });
}

export function fixtureDatabaseFiles() {
  return serializeDatabaseFiles(fixtureTables());
}

/* ترانسپورتی که متنها را از یک outbox/فایل برگشتی replay میکند؛
 * همان رابط send/receive، ولی بدون شبکه و بدون لاگین. */
export function replayTransport(texts) {
  const messages = (texts || []).map((t) => ({ text: t }));
  return {
    mode: 'replay',
    async send(list) {
      for (const t of list) messages.push({ text: t });
      return { ok: true, sent: list.length, chat: SAVED_MESSAGES_CHAT };
    },
    async receive(limit = 1000) { return messages.slice(-limit); },
    describe() {
      return { mode: 'replay', officialApi: false, botTokenUsed: false, vercelUsed: false };
    },
  };
}

export function collectPacketGroups(texts) {
  const groups = new Map();
  for (const t of texts || []) {
    const p = decodePacketFromSavedMessages(t);
    if (!p) continue;
    const id = packetId(p);
    if (!id) continue;
    if (!groups.has(id)) groups.set(id, []);
    groups.get(id).push(p);
  }
  return groups;
}

/* ارسال فایلهای دیتابیس به Saved Messages، بهصورت کاملاً رمزشده.
 * خروجی «outbox» هم منیفست است و هم لیست متنهایی که باید بروند؛ خودش
 * هیچ plaintextـای ندارد و میتواند تحویل `saved_messages.py` شود. */
export async function publishDatabaseFiles({
  driver, files, key, outboxId = `mc-db-${Date.now().toString(36)}`,
  chunkSize = 1024, keyMode = 'fixture',
} = {}) {
  if (!driver || !(driver instanceof SavedMessagesDriver)) throw new Error('SAVED_MESSAGES_DRIVER_REQUIRED');
  if (!key) throw new Error('BACKUP_KEY_REQUIRED');
  if (!Array.isArray(files) || files.length === 0) throw new Error('DATABASE_FILES_REQUIRED');

  const published = [];
  for (const f of files) {
    if (!f?.name || !f?.bytes) throw new Error('DATABASE_FILE_INVALID');
    const plainSha256 = await sha256Hex(f.bytes);
    const before = driver.sentTexts.length;
    const manifest = await publishForSavedMessages({
      driver,
      plain: f.bytes,
      key,
      batchId: `${outboxId}/${f.name}`,
      chunkSize,
      aad: `${DATABASE_FILE_KIND}:${outboxId}:${f.name}`,
    });
    const texts = driver.sentTexts.slice(before);
    published.push({
      name: f.name,
      table: f.table ?? null,
      rowCount: f.rowCount ?? null,
      columnsPreserved: f.columnsPreserved ?? null,
      plainSha256,
      plainBytes: f.bytes.length,
      manifest,
      texts,
    });
  }

  const texts = published.flatMap((p) => p.texts);
  return {
    v: DATABASE_FILE_VERSION,
    kind: DATABASE_FILE_KIND,
    outboxId,
    destination: MAXRUBIKA_DESTINATION,
    carrier: SAVED_MESSAGES_CHAT,
    algorithm: ENCRYPTION_ALGORITHM,
    keyMode,                     // 'fixture' | 'env'؛ فقط نحوهٔ تأمین کلید، نه خود کلید
    packetMagic: 'MCPK1',
    textPrefix: 'MCR1.',
    status: 'sent-pending-verification',
    deliveryVerified: false,
    verificationRequired: true,
    createdAt: new Date().toISOString(),
    fileCount: published.length,
    files: published,
    texts,
    packetCount: texts.length,
    /* فقط متادیتا: هیچ ردیف/مقدار جدولی اینجا نیست */
    officialApiUsed: false,
    botTokenUsed: false,
    vercelUsed: false,
    frontendSecrets: false,
    primaryRowsUntouched: true,
    noDelete: true,
    deleted: false,
    destructiveOperations: [],
    realLoginRequired: true,
    sessionEnvOnly: SESSION_ENV,
    note: 'روبیکا فقط ciphertext میبیند. تأیید نهایی با verifyDatabaseFiles انجام میشود؛ هیچ ردیفی پاک نشد.',
  };
}

/* تأیید/بازگردانی از روی همان متنهای برگشتی Saved Messages (یا outbox).
 * درایور تازهای ساخته میشود، بنابراین نیاز به سشن واقعی یا لاگین نیست. */
export async function verifyDatabaseFiles({ outbox, messages = null, key } = {}) {
  if (!outbox || outbox.kind !== DATABASE_FILE_KIND) throw new Error('BAD_OUTBOX');
  if (!key) throw new Error('BACKUP_KEY_REQUIRED');
  const texts = Array.isArray(messages) ? messages : outbox.texts;
  if (!Array.isArray(texts) || texts.length === 0) throw new Error('NO_RETURNED_MESSAGES');

  const transport = replayTransport(texts);
  const driver = new SavedMessagesDriver({ transport });
  const groups = collectPacketGroups(texts);

  /* منیفستها را به درایور تازه بسپار و ciphertext هر تکه را از بستههای
   * برگشتی بساز؛ این همان چیزی است که publish موقع ارسال نگه داشته بود. */
  for (const f of outbox.files) {
    for (const c of f.manifest.chunks) {
      const group = groups.get(c.stageKey) || [];
      driver.sentBatches.set(c.stageKey, { sha: c.sha, packets: group.length });
      if (group.length) {
        try {
          const { bytes } = await joinPackets(group);
          driver.store.set(c.stageKey, bytes);
          driver.store.set(`blob/${c.sha}`, bytes);
        } catch {
          /* بستهٔ ناقص/دستکاریشده: عمداً store پر نمیشود تا roundTrip و
           * readEncrypted هر دو شکست را اعلام کنند؛ هیچ چیزی پاک نمیشود. */
        }
      }
    }
  }

  const delivery = await verifySavedMessagesDelivery({
    driver, limit: Math.max(DEFAULT_PACKET_LIMIT, texts.length + 10),
  });

  const restored = [];
  for (const f of outbox.files) {
    try {
      const back = await readEncrypted({ driver, manifest: f.manifest, key, prefix: 'blob' });
      const sha = await sha256Hex(back);
      restored.push({
        name: f.name,
        table: f.table,
        rows: f.rowCount,
        bytes: back.length,
        sha256: sha,
        expectedSha256: f.plainSha256,
        columnsPreserved: f.columnsPreserved,
        verified: sha === f.plainSha256 && back.length === f.plainBytes,
      });
    } catch (err) {
      restored.push({ name: f.name, verified: false, reason: err?.message || 'DECRYPT_FAILED' });
    }
  }

  return {
    ok: delivery.ok && restored.length === outbox.fileCount
      && restored.every((r) => r.verified),
    kind: DATABASE_FILE_KIND,
    outboxId: outbox.outboxId,
    verifiedAt: new Date().toISOString(),
    returnedMessages: texts.length,
    delivery,
    files: restored,
    algorithm: ENCRYPTION_ALGORITHM,
    officialApiUsed: false,
    botTokenUsed: false,
    vercelUsed: false,
    realLoginUsed: false,
    deleted: false,
    destructiveOperations: [],
    retainedInPrimary: true,
    primaryRowsUntouched: true,
  };
}

export default { publishDatabaseFiles, verifyDatabaseFiles, fixtureDatabaseFiles };
