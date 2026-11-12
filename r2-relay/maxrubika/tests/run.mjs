/* تستهای آفلاین مسیر «سیو مسیج روبیکا + MAXRubika».
 * اجرا: node maxrubika/tests/run.mjs
 * هیچ شبکه، لاگین، شماره، کد تأیید یا توکنی در کار نیست.
 */

import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

import {
  SavedMessagesDriver, publishForSavedMessages, verifySavedMessagesDelivery,
  encodePacketForSavedMessages, decodePacketFromSavedMessages,
  collectSavedMessagesTexts, packetId,
  MAXRUBIKA_DESTINATION, SAVED_MESSAGES_CHAT, SAVED_MESSAGES_PREFIX,
} from '../adapter.mjs';
import {
  publishDatabaseFiles, verifyDatabaseFiles, fixtureDatabaseFiles,
  serializeDatabaseFiles, replayTransport, collectPacketGroups,
  DATABASE_FILE_KIND, SESSION_ENV,
} from '../database-files.mjs';
import { utf8, randomBytes, deriveAesKey, sha256Hex } from '../../worker/src/crypto.js';
import { makePackets } from '../../client/courier.js';
import { readEncrypted } from '../../client/storage-adapter.js';
import { fixtureTables, TABLES } from '../../rubika/adapter.mjs';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`  ok  ${name}`); passed++; }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.stack}`); process.exitCode = 1; }
};

function fixtureTransport() {
  const messages = [];
  return {
    mode: 'fixture',
    calls: { send: 0, receive: 0 },
    async send(texts) {
      this.calls.send++;
      for (const t of texts) messages.push({ text: t });
      return { ok: true, sent: texts.length };
    },
    async receive(limit = 100) { this.calls.receive++; return messages.slice(-limit); },
  };
}

const key = await deriveAesKey('test-passphrase-not-a-real-secret', utf8('fixed-salt-for-tests'));

await test('کدگذاری MCR1برگشتپذیر است و %5F حفظ میشود', async () => {
  const packets = await makePackets(randomBytes(1200), { id: 'x', chunkSize: 500 });
  for (const p of packets) {
    const enc = encodePacketForSavedMessages(p);
    assert.ok(enc.startsWith(SAVED_MESSAGES_PREFIX));
    assert.equal(decodePacketFromSavedMessages(enc), p);
    assert.equal(packetId(decodePacketFromSavedMessages(enc)), 'x');
  }
  assert.throws(() => encodePacketForSavedMessages('NOT_A_PACKET'), /NOT_MCPK1_PACKET/);
  assert.equal(decodePacketFromSavedMessages('یک پیام معمولی'), null);
});

await test('ترانسپورت الزامی است؛ بدون آن درایور ساخته نمیشود', () => {
  assert.throws(() => new SavedMessagesDriver({}), /SAVED_MESSAGES_TRANSPORT_REQUIRED/);
  const d = new SavedMessagesDriver({ transport: fixtureTransport() });
  assert.equal(d.name, MAXRUBIKA_DESTINATION);
});

await test('publish → برگشت → تأیید SHA → readEncrypted موبرهمو', async () => {
  const transport = fixtureTransport();
  const driver = new SavedMessagesDriver({ transport });
  const plain = randomBytes(9000);
  const manifest = await publishForSavedMessages({
    driver, plain, key, batchId: 'saved-1', chunkSize: 1024,
  });
  assert.equal(manifest.status, 'confirmed');
  assert.equal(manifest.destination, MAXRUBIKA_DESTINATION);
  assert.equal(manifest.carrier, SAVED_MESSAGES_CHAT);
  assert.equal(manifest.officialApiUsed, false);
  assert.equal(manifest.botTokenUsed, false);
  assert.equal(manifest.vercelUsed, false);
  assert.equal(manifest.deleted, false);
  assert.deepEqual(manifest.destructiveOperations, []);
  assert.ok(manifest.chunks.length > 1);
  const delivery = await verifySavedMessagesDelivery({ driver });
  assert.equal(delivery.ok, true);
  assert.equal(delivery.matchedBatches, manifest.chunks.length);
  assert.equal(delivery.deleted, false);
  assert.deepEqual(delivery.destructiveOperations, []);
  assert.ok(delivery.results.every((r) => r.verified));
  const back = await readEncrypted({ driver, manifest, key, prefix: 'blob' });
  assert.deepEqual(back, plain);
});

await test('delete بلاک است؛ پیامهای قدیمی سیو مسیج پاک نمیشوند', async () => {
  const driver = new SavedMessagesDriver({ transport: fixtureTransport() });
  await driver.put('k', randomBytes(50));
  await assert.rejects(() => driver.delete('k'), /SAVED_MESSAGES_NO_DELETE/);
  assert.equal(await driver.has('k'), true);
});

await test('پیام نامربوط کاربر نادیده گرفته میشود و تأیید خراب نمیشود', async () => {
  const transport = fixtureTransport();
  const driver = new SavedMessagesDriver({ transport });
  const plain = randomBytes(2000);
  await publishForSavedMessages({ driver, plain, key, batchId: 'saved-2', chunkSize: 700 });
  // پیام معمولی و بستهای با id نامربوط اضافه میکنیم.
  transport.send(['MCR1.MCPK1.not-a-real-packet.body']);
  const other = await makePackets(randomBytes(300), { id: 'unrelated', chunkSize: 200 });
  await transport.send(other.map(encodePacketForSavedMessages));
  const delivery = await verifySavedMessagesDelivery({ driver });
  assert.equal(delivery.ok, true, 'فقط بچهای خودمان باید مقایسه شوند');
  assert.equal(delivery.matchedBatches, driver.sentBatches.size);
});

await test('بستهٔ دستکاریشده رد میشود (SHA mismatch)، ولی چیزی پاک نمیشود', async () => {
  const transport = fixtureTransport();
  const driver = new SavedMessagesDriver({ transport });
  const plain = randomBytes(900);
  await publishForSavedMessages({ driver, plain, key, batchId: 'saved-3', chunkSize: 400 });
  const texts = [...driver.sentTexts];
  const broken = texts[0].replace(/\.[^.]+$/, '.AAAA');
  transport.receive = async () => [{ text: broken }];
  const delivery = await verifySavedMessagesDelivery({ driver });
  assert.equal(delivery.ok, false);
  assert.equal(delivery.deleted, false);
  assert.equal(delivery.retainedInPrimary, true);
});

await test('collectSavedMessagesTexts فقط MCR1 میگیرد و تکراریها را حذف میکند', () => {
  const msgs = [
    { text: 'سلام معمولی' },
    { message: { text: 'MCR1.MCPK1.aaa.bbb' } },
    { text: 'MCR1.MCPK1.aaa.bbb' },
    { caption: 'MCR1.MCPK1.ccc.ddd' },
  ];
  const out = collectSavedMessagesTexts(msgs);
  assert.equal(out.length, 2);
  assert.ok(out.every((p) => p.startsWith('MCPK1.')));
});

await test('هیچ راز/توکن/ورسل/API رسمی تو سورس این مسیر نیست', () => {
  const files = ['adapter.mjs', 'cli.mjs', 'saved_messages.py']
    .map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f));
  const forbidden = [
    ['api', 'vercel', 'com'].join('.'),
    'SUPABASE_SERVICE_ROLE_KEY',
    'BALE_BOT_TOKEN',
    'delete_messages(',
  ];
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    for (const m of forbidden) assert.equal(t.includes(m), false, `${path.basename(f)}: ${m}`);
  }
  const py = fs.readFileSync(path.join(ROOT, 'saved_messages.py'), 'utf8');
  assert.equal(py.includes('send_message(chat=SAVED_MESSAGES_CHAT'), true);
  assert.equal(py.includes('get_last_messages('), true);
  assert.equal(py.includes('from maxrubika import Messenger'), true);
  const cjk = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
  assert.equal(cjk.test(py), false);
});

/* ---------------- فایلهای دیتابیس → رمزگذاری → سیو مسیج ---------------- */

const DB_SALT = 'memechat-maxrubika-db-files-v1';
const dbKey = await deriveAesKey('fixture-passphrase-not-a-real-secret', utf8(DB_SALT));

function dbDriver() {
  return new SavedMessagesDriver({ transport: fixtureTransport(), chunkSize: 700 });
}

await test('فایلهای دیتابیس از جدولها ساخته میشوند؛ فیلدها و ردیفها دستنخورده', () => {
  const tables = fixtureTables();          // یکبار، چون timestamp داخلش زنده است
  const files = serializeDatabaseFiles(tables);
  assert.equal(files.length, Object.keys(TABLES).length);
  for (const f of files) {
    const obj = JSON.parse(Buffer.from(f.bytes).toString('utf8'));
    assert.equal(obj.kind, DATABASE_FILE_KIND);
    assert.equal(obj.table, f.table);
    assert.deepEqual(obj.columns, [...TABLES[f.table]]);
    assert.equal(obj.rows.length, f.rowCount);
    assert.deepEqual(obj.rows, tables[f.table]);
  }
  assert.equal(fixtureDatabaseFiles().length, 2);
  assert.throws(() => serializeDatabaseFiles(null), /TABLES_REQUIRED/);
});

await test('publishDatabaseFiles فقط ciphertext به Saved Messages میفرستد', async () => {
  const driver = dbDriver();
  const files = fixtureDatabaseFiles();
  const raw = Buffer.concat(files.map((f) => Buffer.from(f.bytes))).toString('utf8');
  const outbox = await publishDatabaseFiles({ driver, files, key: dbKey, chunkSize: 1024 });
  assert.equal(outbox.kind, DATABASE_FILE_KIND);
  assert.equal(outbox.destination, MAXRUBIKA_DESTINATION);
  assert.equal(outbox.carrier, SAVED_MESSAGES_CHAT);
  assert.equal(outbox.algorithm, 'AES-256-GCM');
  assert.equal(outbox.status, 'sent-pending-verification');
  assert.equal(outbox.deliveryVerified, false);
  assert.equal(outbox.verificationRequired, true);
  assert.equal(outbox.fileCount, 2);
  assert.ok(outbox.packetCount > 0);
  assert.equal(outbox.texts.length, outbox.packetCount);
  assert.equal(outbox.deleted, false);
  assert.deepEqual(outbox.destructiveOperations, []);
  assert.equal(outbox.officialApiUsed, false);
  assert.equal(outbox.botTokenUsed, false);
  assert.equal(outbox.vercelUsed, false);
  assert.equal(outbox.frontendSecrets, false);
  assert.equal(outbox.primaryRowsUntouched, true);
  assert.equal(outbox.realLoginRequired, true);
  assert.equal(outbox.sessionEnvOnly, SESSION_ENV);
  for (const f of outbox.files) {
    assert.ok(f.manifest.status === 'confirmed');
    assert.equal(f.manifest.deliveryVerified, false);
    assert.equal(f.manifest.verificationRequired, true);
    assert.ok(f.texts.length > 0);
    assert.ok(f.texts.every((t) => t.startsWith(`${SAVED_MESSAGES_PREFIX}MCPK1.`)));
  }
  /* هیچ نویسهٔ JSONـای و هیچ متن ردیفی نباید داخل پیامها باشد */
  const joined = outbox.texts.join('');
  assert.equal(/[:{}"\s]/.test(joined), false, 'نشت plaintext به پیامها');
  for (const token of ['mimchat_staging_messages', 'سلام', 'آرشیو', '"rows"']) {
    assert.equal(joined.includes(token), false, `نشت ${token}`);
  }
  assert.equal(raw.includes('"rows"'), true);
  assert.equal(outbox.texts.length, driver.sentTexts.length);
});

await test('منیفست داخلی صادقانه «تأییدنشده» را هم اعلام میکند', async () => {
  const driver = dbDriver();
  const manifest = await publishForSavedMessages({
    driver, plain: randomBytes(1000), key: dbKey, batchId: 'db-flag-1', chunkSize: 512,
  });
  assert.equal(manifest.status, 'confirmed');
  assert.equal(manifest.deliveryVerified, false);
  assert.equal(manifest.verificationRequired, true);
});

await test('verifyDatabaseFiles از روی همان outbox، فایلها را رمزگشایی و SHA تأیید میکند', async () => {
  const outbox = await publishDatabaseFiles({ driver: dbDriver(), files: fixtureDatabaseFiles(), key: dbKey });
  const report = await verifyDatabaseFiles({ outbox, key: dbKey });
  assert.equal(report.ok, true);
  assert.equal(report.delivery.ok, true);
  assert.equal(report.files.length, outbox.fileCount);
  assert.equal(report.deleted, false);
  assert.equal(report.realLoginUsed, false);
  assert.equal(report.primaryRowsUntouched, true);
  for (const f of report.files) {
    assert.equal(f.verified, true);
    assert.equal(f.sha256, f.expectedSha256);
    assert.ok(f.bytes > 0);
    assert.ok(f.rows >= 0);
  }
});

await test('حلقهٔ کامل: outbox → ترانسپورت replay → فایل برگشتی → تأیید', async () => {
  const outbox = await publishDatabaseFiles({ driver: dbDriver(), files: fixtureDatabaseFiles(), key: dbKey });
  /* همان کاری که saved_messages.py.roundtrip_outbox انجام میدهد */
  const t = replayTransport([]);
  await t.send(outbox.texts);
  const received = (await t.receive(1000)).map((m) => m.text);
  assert.deepEqual(received, outbox.texts);
  const groups = collectPacketGroups(received);
  assert.equal(groups.size, outbox.files.reduce((n, f) => n + f.manifest.chunks.length, 0));
  const report = await verifyDatabaseFiles({ outbox, messages: received, key: dbKey });
  assert.equal(report.ok, true);
  assert.equal(report.returnedMessages, outbox.packetCount);
});

await test('کم شدن یک بسته رد میشود، ولی هیچ چیزی پاک نمیشود', async () => {
  const outbox = await publishDatabaseFiles({ driver: dbDriver(), files: fixtureDatabaseFiles(), key: dbKey });
  const broken = outbox.texts.slice(0, -1);
  const report = await verifyDatabaseFiles({ outbox, messages: broken, key: dbKey });
  assert.equal(report.ok, false);
  assert.equal(report.delivery.ok, false);
  assert.equal(report.deleted, false);
  assert.deepEqual(report.destructiveOperations, []);
  assert.equal(report.retainedInPrimary, true);
  assert.equal(report.files.some((f) => f.verified === false), true);
});

await test('کلید اشتباه رمزگشایی را رد میکند؛ دادهها حفظ میشوند', async () => {
  const outbox = await publishDatabaseFiles({ driver: dbDriver(), files: fixtureDatabaseFiles(), key: dbKey });
  const wrong = await deriveAesKey('another-passphrase-entirely', utf8(DB_SALT));
  const report = await verifyDatabaseFiles({ outbox, key: wrong });
  assert.equal(report.ok, false);
  assert.equal(report.delivery.ok, true, 'بستهها سالم برگشتند؛ خطا فقط از رمزگشایی است');
  assert.equal(report.files.every((f) => f.verified === false), true);
  assert.equal(report.deleted, false);
  assert.equal(report.retainedInPrimary, true);
});

await test('سورس مسیر جدید شماره/OTP/سشن/DELETE نمیگیرد', () => {
  const files = ['adapter.mjs', 'cli.mjs', 'saved_messages.py', 'database-files.mjs']
    .map((f) => path.join(ROOT, f));
  const joined = files.map((f) => fs.readFileSync(f, 'utf8')).join('\n');
  assert.equal(joined.includes('delete_messages('), false);
  assert.equal(/\binput\s*\(/.test(joined), false, 'هیچ پرسش تعاملی شماره/کدی نباید باشد');
  assert.equal(joined.includes('MC_MAXRUBIKA_SESSION'), true);
  assert.equal(joined.includes('send_outbox'), true);
  assert.equal(joined.includes('roundtrip_outbox'), true);
  const forbidden = [
    ['api', 'vercel', 'com'].join('.'),
    'SUPABASE_SERVICE_ROLE_KEY',
    'BALE_BOT_TOKEN',
  ];
  for (const m of forbidden) assert.equal(joined.includes(m), false, m);
});

console.log(`\n${passed} tests passed.`);
if (process.exitCode) process.exit(process.exitCode);
