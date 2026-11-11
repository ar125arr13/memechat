#!/usr/bin/env node
/* خطفرمان مسیر تازه: «دیتابیس دوم → پیامهای ذخیرهشدهٔ روبیکا» با MAXRubika.
 *
 *   node maxrubika/cli.mjs status
 *   node maxrubika/cli.mjs trial --fixture        # آفلاین، بدون لاگین/شبکه
 *   node maxrubika/cli.mjs help
 *
 * حالت --fixture از یک ترانسپورت درونحافظهای استفاده میکند (همان رابط
 * send/receive واقعی). حالت واقعی تو saved_messages.py با MC_MAXRUBIKA_SESSION
 * است. هیچ راز، شماره یا کد تأییدی تو سورس/چت/لاگ نیست.
 */

import { webcrypto } from 'node:crypto';
import {
  SavedMessagesDriver, publishForSavedMessages, verifySavedMessagesDelivery,
  MAXRUBIKA_DESTINATION, SAVED_MESSAGES_CHAT,
} from './adapter.mjs';
import { utf8, randomBytes, deriveAesKey } from '../worker/src/crypto.js';
import { readEncrypted } from '../client/storage-adapter.js';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function fixtureTransport() {
  const messages = [];
  return {
    mode: 'fixture',
    async send(texts) {
      for (const t of texts) messages.push({ text: t });
      return { ok: true, sent: texts.length, chat: SAVED_MESSAGES_CHAT };
    },
    async receive(limit = 100) { return messages.slice(-limit); },
    describe() {
      return { mode: 'fixture', officialApi: false, botTokenUsed: false, vercelUsed: false };
    },
  };
}

async function trial() {
  const transport = fixtureTransport();
  const driver = new SavedMessagesDriver({ transport });
  const key = await deriveAesKey('fixture-passphrase-not-a-secret', utf8('fixed-salt-for-tests'));
  const plain = randomBytes(4096);
  const manifest = await publishForSavedMessages({
    driver, plain, key, batchId: `mc-saved-${Date.now().toString(36)}`, chunkSize: 1024,
  });
  const delivery = await verifySavedMessagesDelivery({ driver });
  const back = await readEncrypted({ driver, manifest, key, prefix: 'blob' });
  console.log('');
  console.log(`مقصد: ${MAXRUBIKA_DESTINATION} | چت: ${SAVED_MESSAGES_CHAT} | حالت: ${transport.mode}`);
  console.log(`تکهها: ${manifest.chunks.length} | پیام فرستادهشده: ${driver.sentTexts.length}`);
  console.log(`برگشت و تأیید SHA: ${delivery.ok} | بچهای تأییدشده: ${delivery.matchedBatches}`);
  console.log(`فایل رمزشده موبرهمو: ${Buffer.compare(Buffer.from(back), Buffer.from(plain)) === 0}`);
  console.log(`حذف/ریست: ${manifest.deleted} | عملیات مخرب: ${manifest.destructiveOperations.length}`);
  console.log('نسخهٔ محلی (primary) دستنخورده ماند؛ هیچ ردیفی پاک نشد.');
  if (!delivery.ok || Buffer.compare(Buffer.from(back), Buffer.from(plain)) !== 0) process.exitCode = 1;
}

function status() {
  console.log(`مقصد: ${MAXRUBIKA_DESTINATION}`);
  console.log(`چت: ${SAVED_MESSAGES_CHAT} (پیامهای ذخیرهشدهٔ روبیکا)`);
  console.log('کتابخانه: maxrubika (غیررسمی / یوزربات) | API رسمی روبیکا: خیر | توکن بات: خیر');
  console.log('ورسل: خیر | کلید تو فرانتاند: خیر | فقط نام سشن از env');
  console.log('دیتابیس اصلی: Supabase، بدون تغییر | حذف ردیف: صفر');
}

function help() {
  console.log(`میمچت — دیتابیس دوم روی «سیو مسیج روبیکا» با MAXRubika

  status                 وضعیت مسیر
  trial --fixture        تست کامل آفلاین: رمز → بسته → ارسال → برگشت → تأیید SHA
  help                   همین متن

واقعی (سمت پایتون، روی دستگاه خودتان):
  r2-relay/maxrubika/saved_messages.py
  فقط MC_MAXRUBIKA_SESSION (نام سشن) از env خوانده میشود.

صداقت: maxrubika غیررسمی/self-bot است، پروتکل خصوصی دارد، ممکن است بشکند،
و نیاز به لاگین یکبارهٔ شماره + کد تأیید روی دستگاه خودتان دارد. توکن باتی
لازم نیست. این مسیر تو مرورگر اجرا نمیشود و دیپلوی/ورسل ندارد.`);
}

const cmd = process.argv[2] || 'help';
if (cmd === 'trial') await trial();
else if (cmd === 'status') await status();
else help();
