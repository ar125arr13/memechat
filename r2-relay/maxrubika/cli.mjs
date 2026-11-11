#!/usr/bin/env node
/* خطفرمان مسیر «فایلهای دیتابیس → رمزگذاری → پیامهای ذخیرهشدهٔ روبیکا».
 *
 *   node maxrubika/cli.mjs status
 *   node maxrubika/cli.mjs trial --fixture            # تست قدیمی (رجریشن)
 *   node maxrubika/cli.mjs export [--fixture]         # ساخت outbox از فایلهای دیتابیس
 *   node maxrubika/cli.mjs verify [--file F] [--received R]
 *   node maxrubika/cli.mjs help
 *
 * صداقت: `export` هیچ تماسی با Supabase یا روبیکا نمیزند. از جدولهای
 * ساختگی (یا فایل محلی --tables) فایل میسازد، AES-256-GCM میکند، بستههای
 * `MCPK1` / متنهای `MCR1` را میسازد و یک **outbox** مینویسد. ارسال واقعی
 * همان outbox توسط `saved_messages.py` با سشن محلی انجام میشود؛ شماره،
 * کد تأیید، OTP یا توکنی هرگز وارد چت/سورس/لاگ نمیشود.
 */

import { webcrypto } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const STATE = path.join(OUT, 'state.json');
const KEY_SALT = 'memechat-maxrubika-db-files-v1';
const FIXTURE_PASSPHRASE = 'fixture-passphrase-not-a-real-secret';

import {
  SavedMessagesDriver, publishForSavedMessages, verifySavedMessagesDelivery,
  MAXRUBIKA_DESTINATION, SAVED_MESSAGES_CHAT,
} from './adapter.mjs';
import {
  publishDatabaseFiles, verifyDatabaseFiles, fixtureDatabaseFiles,
  serializeDatabaseFiles, DATABASE_FILE_KIND,
} from './database-files.mjs';
import { utf8, randomBytes, deriveAesKey } from '../worker/src/crypto.js';
import { readEncrypted } from '../client/storage-adapter.js';

const args = process.argv.slice(3);
const cmd = process.argv[2] || 'help';
const has = (flag) => args.includes(flag);
const arg = (name, fallback = null) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

async function ensureOut() { await fs.mkdir(OUT, { recursive: true }); }

async function latest(prefix, suffix) {
  const files = (await fs.readdir(OUT)).filter((f) => f.startsWith(prefix) && f.endsWith(suffix)).sort();
  return files.length ? path.join(OUT, files[files.length - 1]) : null;
}

async function appendState(entry) {
  let state = { v: 1, kind: DATABASE_FILE_KIND, batches: [], deleted: false, destructiveOperations: [] };
  try { state = JSON.parse(await fs.readFile(STATE, 'utf8')); } catch { /* اولین اجرا */ }
  state.batches.push(entry);
  state.deleted = false;
  state.destructiveOperations = [];
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(STATE, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

/* کلید فقط runtime/محیط امن؛ در حالت تست یک عبارت صریحاً ساختگی. */
async function keyFor(keyMode = 'fixture') {
  if (keyMode === 'fixture') return deriveAesKey(FIXTURE_PASSPHRASE, utf8(KEY_SALT));
  const raw = (process.env.BACKUP_ENCRYPTION_KEY || '').trim();
  if (raw.length < 16) throw new Error('BACKUP_KEY_NOT_CONFIGURED');
  return deriveAesKey(raw, utf8(KEY_SALT));
}

function fixtureTransport() {
  const messages = [];
  return {
    mode: 'fixture',
    async send(texts) {
      for (const t of texts) messages.push({ text: t });
      return { ok: true, sent: texts.length, chat: SAVED_MESSAGES_CHAT };
    },
    async receive(limit = 1000) { return messages.slice(-limit); },
    describe() { return { mode: 'fixture', officialApi: false, botTokenUsed: false, vercelUsed: false }; },
  };
}

/* متنی که به Saved Messages میرود فقط ciphertext است: هیچ نویسهٔ JSONـای
 * (کولن، آکولاد، گیومه، فاصله) نباید داخلش باشد. */
function assertCiphertextOnly(texts) {
  const joined = texts.join('\n');
  if (/[:{}"\s]/.test(joined.replace(/\n/g, ''))) {
    throw new Error('PLAINTEXT_LEAKED_INTO_SAVED_MESSAGES');
  }
  return true;
}

async function loadTables() {
  const file = arg('--tables');
  if (file) {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    const tables = raw.tables || raw;
    return serializeDatabaseFiles(tables);
  }
  return fixtureDatabaseFiles();
}

async function doExport() {
  await ensureOut();
  const keyMode = has('--env-key') ? 'env' : 'fixture';
  const key = await keyFor(keyMode);
  const files = await loadTables();
  const transport = fixtureTransport();
  const driver = new SavedMessagesDriver({ transport, chunkSize: 700 });
  const outbox = await publishDatabaseFiles({ driver, files, key, keyMode, chunkSize: 1024 });
  assertCiphertextOnly(outbox.texts);

  const outboxFile = path.join(OUT, `saved-${outbox.outboxId}.json`);
  const textsFile = path.join(OUT, `saved-${outbox.outboxId}.txt`);
  await fs.writeFile(outboxFile, JSON.stringify(outbox, null, 2) + '\n', 'utf8');
  await fs.writeFile(textsFile, outbox.texts.join('\n') + '\n', 'utf8');
  await appendState({
    outboxId: outbox.outboxId,
    createdAt: outbox.createdAt,
    fileCount: outbox.fileCount,
    packetCount: outbox.packetCount,
    rowCounts: outbox.files.map((f) => ({ name: f.name, rows: f.rowCount })),
    keyMode,
    status: outbox.status,
    deleted: false,
  });

  console.log('');
  console.log(`فایلهای دیتابیس آماده و رمزشده شدند | منبع: ${has('--tables') ? 'فایل محلی' : 'جدولهای ساختگی (آفلاین)'}`);
  console.log(`تعداد فایلها: ${outbox.fileCount} | ردیفها: ${outbox.files.map((f) => `${f.name}=${f.rowCount}`).join(', ')}`);
  console.log(`الگوریتم: ${outbox.algorithm} | بستهها: ${outbox.packetCount} | پیشوند: ${outbox.textPrefix}`);
  console.log(`بررسی نشت plaintext در متنها: ${assertCiphertextOnly(outbox.texts)}`);
  console.log(`outbox: ${outboxFile}`);
  console.log(`متنها: ${textsFile}`);
  console.log(`وضعیت: ${outbox.status} | تأیید نهایی هنوز انجام نشده | حذف/ریست: ${outbox.deleted}`);
  console.log('⚠️ هیچ لاگین، شماره، کد تأیید، سشن یا تماس شبکهای انجام نشد؛ Supabase فقط بهصورت ساختگی خوانده شد.');
  console.log('⚠️ ارسال واقعی همان outbox توسط saved_messages.py با سشن محلی انجام میشود، نه با شماره توی چت.');
}

async function doVerify() {
  await ensureOut();
  const file = arg('--file') || await latest('saved-', '.json');
  if (!file) throw new Error('OUTBOX_NOT_FOUND');
  const outbox = JSON.parse(await fs.readFile(file, 'utf8'));
  const key = await keyFor(outbox.keyMode || 'fixture');
  let messages = null;
  const received = arg('--received');
  if (received) {
    const data = JSON.parse(await fs.readFile(received, 'utf8'));
    const list = Array.isArray(data) ? data : (data.messages || []);
    messages = list.map((m) => (typeof m === 'string' ? m : m?.text)).filter(Boolean);
  }
  const report = await verifyDatabaseFiles({ outbox, messages, key });
  const reportFile = path.join(OUT, `verification-${outbox.outboxId}.json`);
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log('');
  console.log(`تأیید outbox ${outbox.outboxId} | منبع پیامها: ${received ? 'فایل برگشتی' : 'همان outbox'}`);
  console.log(`برگشت بستهها و SHA: ${report.delivery.ok} | پیامهای برگشتی: ${report.returnedMessages}`);
  for (const f of report.files) {
    console.log(`  ${f.name}: ${f.verified ? '✅' : '❌'} ردیفها=${f.rows ?? '-'} | بایت=${f.bytes ?? '-'} | SHA=${(f.sha256 || '').slice(0, 12)}…`);
  }
  console.log(`نتیجهٔ کل: ${report.ok} | رمزگشایی: ${report.algorithm} | حذف/ریست: ${report.deleted}`);
  console.log(`گزارش: ${reportFile}`);
  console.log('دیتابیس اصلی دستنخورده ماند؛ صفر حذف، بدون لاگین واقعی.');
  if (!report.ok) process.exitCode = 1;
}

async function doTrial() {
  const transport = fixtureTransport();
  const driver = new SavedMessagesDriver({ transport, chunkSize: 700 });
  const key = await deriveAesKey(FIXTURE_PASSPHRASE, utf8('fixed-salt-for-tests'));
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

async function doStatus() {
  let state;
  try { state = JSON.parse(await fs.readFile(STATE, 'utf8')); }
  catch {
    console.log(`مقصد: ${MAXRUBIKA_DESTINATION} | هنوز outboxـای ساخته نشده.`);
    console.log('کتابخانه: maxrubika (غیررسمی / self-bot) | توکن بات: خیر | ورسل: خیر');
    console.log('شماره/OTP: لازم نیست | فقط نام سشن محلی برای ارسال واقعی');
    return;
  }
  console.log(`مقصد: ${MAXRUBIKA_DESTINATION} | تعداد outboxها: ${state.batches.length} | حذف: ${state.deleted}`);
  for (const b of state.batches) {
    console.log(`  • ${b.outboxId} | ${b.fileCount} فایل | ${b.packetCount} بسته | ${b.status} | ${b.createdAt}`);
  }
  console.log('دیتابیس اصلی: Supabase، بدون تغییر | لاگین واقعی: خیر | شماره/OTP: خیر');
}

function help() {
  console.log(`میمچت — فایلهای دیتابیس → رمزگذاری → سیو مسیج روبیکا (MAXRubika)

  export [--fixture] [--env-key] [--tables F]
          ساخت outbox رمزشده از فایلهای دیتابیس (پیشفرض: جدولهای ساختگی آفلاین)
  verify [--file F] [--received R]
          برگشت بستهها + تأیید SHA + رمزگشایی و مقایسهٔ فایلها
  trial --fixture   تست قدیمی رمز → بسته → ارسال → برگشت
  status            وضعیت outboxها
  help              همین متن

متغیرها: BACKUP_ENCRYPTION_KEY (فقط موقع اجرا)، MC_MAXRUBIKA_SESSION (فقط نام سشن).
هیچ شماره، کد تأیید، OTP، توکن یا private_keyـای وارد چت/سورس/لاگ نمیشود.

صداقت: maxrubika غیررسمی/self-bot است؛ پروتکل خصوصی ممکن است بشکند. ارسال
واقعی نیاز به سشن محلی دارد که یکبار روی دستگاه صاحب پروژه ساخته میشود.
این محیط به روبیکا وصل نمیشود و لاگین انجام نمیدهد. بدون ورسل/دیپلوی/مرج.`);
}

try {
  if (cmd === 'export') await doExport();
  else if (cmd === 'verify') await doVerify();
  else if (cmd === 'trial') await doTrial();
  else if (cmd === 'status') await doStatus();
  else help();
} catch (err) {
  console.error(`❌ ${err?.message || err}`);
  console.error('هیچ ردیفی پاک نشد؛ دیتابیس اصلی دستنخورده است.');
  process.exitCode = 1;
}
