/* تستهای آفلاین مسیر Internet Archive.
 * اجرا: node internet-archive/tests/run.mjs
 * هیچ شبکه، حساب، کلید IAS3 یا توکنی در کار نیست.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { webcrypto } from 'node:crypto';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

import {
  encryptEnvelope, decryptEnvelope, inspectEnvelope, sha256Hex,
  MAGIC, VERSION, ALG_CHACHA20_POLY1305, ENVELOPE_KIND,
} from '../cipher.mjs';
import { KEY_HEX, KEY_SOURCE, KEY_ALGORITHM, sourceKeyBytes, keyFingerprint } from '../key.mjs';
import {
  Ias3Transport, validateItemId, validateFilename, buildUploadUrl,
  buildUploadHeaders, buildDownloadUrl, buildMetadataUrl, buildCheckLimitUrl,
  parseMetadataFiles, safeUrl, FORBIDDEN_METHODS, IAS3_ORIGIN, ARCHIVE_ORIGIN,
} from '../ias3.mjs';
import {
  InternetArchiveDriver, publishForInternetArchive,
  verifyInternetArchiveDelivery, readInternetArchive,
  filenameFor, IA_DESTINATION,
} from '../adapter.mjs';
import { FixtureIas3 } from '../fixture.mjs';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`  ok  ${name}`); passed++; }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.stack}`); process.exitCode = 1; }
};

const ITEM = 'memechat-second-db';
const FILENAME = 'mcia/memechat-second-db/b1/000000.mcia';
const BATCH = 'b1';
const AAD = { item: ITEM, filename: FILENAME, batchId: BATCH };

await test('کلید فقط داخل سورس، ۳۲ بایت، ChaCha20، بدون env/derive', () => {
  assert.equal(KEY_SOURCE, 'source-code');
  assert.equal(KEY_ALGORITHM, 'ChaCha20-Poly1305');
  assert.equal(Buffer.from(KEY_HEX, 'hex').length, 32);
  assert.deepEqual(sourceKeyBytes(), Buffer.from(KEY_HEX, 'hex'));
  assert.match(keyFingerprint(), /^[0-9a-f]{16}$/);
  const keyFile = fs.readFileSync(path.join(ROOT, 'key.mjs'), 'utf8');
  assert.equal(keyFile.includes('process.env'), false);
  assert.equal(keyFile.includes('deriveAesKey'), false);
  assert.equal(keyFile.includes('AES-256-GCM'), false);
});

await test('رمزگذاری متفاوت: بستهٔ باینری MCIA1، الگوریتم ۱، نه AES-GCM', () => {
  const { blob, meta } = encryptEnvelope(Buffer.from('salam'), AAD);
  assert.equal(MAGIC.toString('ascii'), 'MCIA1');
  assert.equal(meta.magic, 'MCIA1');
  assert.equal(meta.algorithm, 'ChaCha20-Poly1305');
  assert.equal(meta.kind, ENVELOPE_KIND);
  const p = inspectEnvelope(blob);
  assert.equal(p.version, VERSION);
  assert.equal(p.alg, ALG_CHACHA20_POLY1305);
  assert.equal(p.nonce.length, 12);
  assert.equal(p.tag.length, 16);
  assert.equal(p.aad.toString('utf8'), `${ITEM}|${FILENAME}|${BATCH}`);
  const cipherFile = fs.readFileSync(path.join(ROOT, 'cipher.mjs'), 'utf8');
  assert.equal(cipherFile.includes('aes-256-gcm'), false);
  assert.equal(cipherFile.includes('crypto.subtle'), false);
});

await test('رمز → باز کردن، موبرهمو + SHA صریح', () => {
  const plain = Buffer.from('میمچت — payload 1234567890');
  const { blob, meta } = encryptEnvelope(plain, AAD);
  const out = decryptEnvelope(blob, { expected: { ...AAD, plaintextSha256: meta.plaintextSha256 } });
  assert.deepEqual(Buffer.from(out.plain), plain);
  assert.equal(out.plaintextSha256, sha256Hex(plain));
  assert.equal(out.plaintextSha256, meta.plaintextSha256);
  assert.equal(out.ciphertextSha256, meta.ciphertextSha256);
});

await test('هر بار nonce تازه؛ دو بستهٔ یکسان متن متفاوتند', () => {
  const a = encryptEnvelope(Buffer.from('same'), AAD);
  const b = encryptEnvelope(Buffer.from('same'), AAD);
  assert.notEqual(a.meta.nonce, b.meta.nonce);
  assert.notEqual(Buffer.from(a.blob).toString('hex'), Buffer.from(b.blob).toString('hex'));
});

await test('دستکاری tag / بدنه / هدر / AAD رد میشود', () => {
  const { blob } = encryptEnvelope(Buffer.from('secret'), AAD);
  const brokenTag = Buffer.from(blob); brokenTag[brokenTag.length - 1] ^= 1;
  assert.throws(() => decryptEnvelope(brokenTag), /.*/);
  const brokenBody = Buffer.from(blob); brokenBody[30] ^= 1;
  assert.throws(() => decryptEnvelope(brokenBody), /.*/);
  const brokenMagic = Buffer.from(blob); brokenMagic[0] = 88;
  assert.throws(() => decryptEnvelope(brokenMagic), /IA_BAD_MAGIC/);
  const wrongAad = encryptEnvelope(Buffer.from('secret'), { ...AAD, item: 'other-item' });
  assert.throws(() => decryptEnvelope(wrongAad.blob, { expected: AAD }), /IA_AAD_MISMATCH|Unsupported state|unable to authenticate/);
});

await test('شناسهٔ آیتم و نام فایل طبق سند رسمی اعتبارسنجی میشوند', () => {
  assert.equal(validateItemId('memechat-2026.db'), 'memechat-2026.db');
  for (const bad of ['_leading', 'ab', 'a'.repeat(101), 'has space', 'فارسی']) {
    assert.throws(() => validateItemId(bad), /IA_INVALID_ITEM_ID/);
  }
  assert.throws(() => validateFilename('../escape'), /IA_INVALID_FILENAME/);
  assert.throws(() => validateFilename('a\x00b'), /IA_INVALID_FILENAME/);
});

await test('URLهای رسمی دقیق ساخته میشوند (PUT / download / metadata / check_limit)', () => {
  assert.equal(
    buildUploadUrl({ item: ITEM, filename: FILENAME }),
    `https://s3.us.archive.org/${ITEM}/mcia/${ITEM}/b1/000000.mcia`,
  );
  assert.equal(
    buildDownloadUrl({ item: ITEM, filename: FILENAME }),
    `https://archive.org/download/${ITEM}/mcia/${ITEM}/b1/000000.mcia`,
  );
  assert.equal(buildMetadataUrl({ item: ITEM }), `https://archive.org/metadata/${ITEM}`);
  const cl = buildCheckLimitUrl({ item: ITEM, accessKey: 'AK' });
  assert.match(cl, /check_limit=1/);
  assert.match(cl, /accesskey=AK/);
  assert.match(cl, new RegExp(`bucket=${ITEM}`));
  assert.equal(IAS3_ORIGIN, 'https://s3.us.archive.org');
  assert.equal(ARCHIVE_ORIGIN, 'https://archive.org');
});

await test('هدرهای PUT دقیقاً از سند IAS3؛ بدون DELETE، بدون نشت راز', () => {
  const h = buildUploadHeaders({
    accessKey: 'AK', secretKey: 'SK', item: ITEM, size: 1234,
  });
  assert.equal(h.authorization, 'LOW AK:SK');
  assert.equal(h['x-archive-auto-make-bucket'], '1');
  assert.equal(h['x-archive-meta-mediatype'], 'data');
  assert.equal(h['x-archive-meta-collection'], 'opensource_media');
  assert.equal(h['x-archive-queue-derive'], '0');
  assert.equal(h['x-archive-size-hint'], '1234');
  assert.equal(h['x-archive-keep-old-version'], '1');
  assert.equal(h['content-type'], 'application/octet-stream');
  assert.equal(Object.values(h).some((v) => String(v).includes('DELETE')), false);
  assert.equal(h['x-archive-cascade-delete'], undefined);
  assert.equal(FORBIDDEN_METHODS.includes('DELETE'), true);
  assert.match(safeUrl('https://x/?accesskey=SECRET&bucket=b'), /__REDACTED__/);
  assert.equal(safeUrl('https://x/?accesskey=SECRET&bucket=b').includes('SECRET'), false);
  assert.match(safeUrl('LOW AK:SK rest'), /__REDACTED__/);
  assert.throws(() => buildUploadHeaders({ item: ITEM }), /NO_RUNTIME_CREDENTIALS/);
});

await test('بدون کلید حساب: NO_RUNTIME_CREDENTIALS و صفر تماس شبکهای', async () => {
  let calls = 0;
  const t = new Ias3Transport({ item: ITEM, fetchImpl: async () => { calls++; return { status: 200 }; } });
  assert.equal(t.configured, false);
  assert.equal(t.describe().mode, 'no-credentials');
  assert.equal(t.describe().accountKeysInSource, false);
  await assert.rejects(() => t.put(FILENAME, Buffer.from('x')), /NO_RUNTIME_CREDENTIALS/);
  assert.equal(calls, 0);
  assert.equal(t.calls.length, 0);
  const envTransport = Ias3Transport.fromEnv({ MC_IA_ITEM: ITEM });
  assert.equal(envTransport.configured, false);
});

await test('ترانسپورت واقعی: PUT فقط، هدرها redact، هیچ DELETE', async () => {
  const seen = [];
  const t = new Ias3Transport({
    item: ITEM, accessKey: 'AK', secretKey: 'SK',
    fetchImpl: async (url, init) => {
      seen.push({ url, init });
      return { status: 200 };
    },
  });
  const r = await t.put(FILENAME, Buffer.from('abc'));
  assert.equal(r.ok, true);
  assert.equal(r.deleted, false);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].init.method, 'PUT');
  assert.equal(seen[0].init.headers.authorization, 'LOW AK:SK');
  assert.equal(seen[0].init.headers['x-archive-auto-make-bucket'], '1');
  assert.equal(t.calls.every((c) => c.method === 'PUT'), true);
  assert.equal(t.calls.every((c) => c.url.includes('SK')), false);
  assert.throws(() => t._assertNoDelete('DELETE'), /IA_DELETE_FORBIDDEN/);
});

await test('parseMetadataFiles دقیقاً شکل GET واقعی /metadata/stats را میفهمد', () => {
  const real = {
    files: [
      { name: FILENAME, source: 'original', size: '123', sha1: 's', md5: 'm', format: 'Unknown' },
      { name: 'mcia/other/000000.mcia', source: 'original', size: '10' },
      { name: 'stats_files.xml', source: 'metadata', size: '5', format: 'Metadata' },
      { name: '__ia_thumb.jpg', source: 'original', size: '7621', format: 'JPEG Thumb' },
      { name: 'stats_meta.sqlite', source: 'original', size: '4913152' },
    ],
  };
  const out = parseMetadataFiles(real);
  assert.deepEqual(out.map((f) => f.name), [FILENAME, 'mcia/other/000000.mcia']);
  assert.equal(out[0].size, 123);
  assert.equal(out[0].sha1, 's');
});

await test('fixture برگرفته از پاسخ واقعی /metadata/stats درست پارس میشود', () => {
  const raw = fs.readFileSync(path.join(HERE, 'fixtures', 'metadata-stats.json'), 'utf8');
  const out = parseMetadataFiles(raw);
  assert.deepEqual(out.map((f) => f.name), ['mcia/memechat-second-db/batch-1/000000.mcia']);
  assert.equal(out[0].size, 1234);
  assert.equal(out[0].sha1, 'fixture-sha1');
  // فایلهای self-generated و تورنت source=metadata نادیده گرفته میشوند، نه حذف.
  assert.equal(parseMetadataFiles(raw, { prefix: '' }).some((f) => f.name === 'stats_archive.torrent'), false);
});

await test('publish → PUT → برگشت → تأیید SHA → خواندن موبرهمو، صفر حذف', async () => {
  const transport = new FixtureIas3({ item: ITEM });
  const driver = new InternetArchiveDriver({ transport, item: ITEM, chunkSize: 1024 });
  const plain = new Uint8Array(5000);
  for (let i = 0; i < plain.length; i++) plain[i] = i % 251;
  const manifest = await publishForInternetArchive({ driver, plain, batchId: 'batch-1' });
  assert.equal(manifest.status, 'confirmed');
  assert.equal(manifest.destination, IA_DESTINATION);
  assert.equal(manifest.cipher, 'ChaCha20-Poly1305');
  assert.equal(manifest.keySource, 'source-code');
  assert.equal(manifest.officialApiUsed, true);
  assert.equal(manifest.botTokenUsed, false);
  assert.equal(manifest.vercelUsed, false);
  assert.equal(manifest.deleted, false);
  assert.deepEqual(manifest.destructiveOperations, []);
  assert.equal(manifest.primaryRowsUntouched, true);
  assert.ok(manifest.chunks.length > 1);
  assert.equal(manifest.chunks[0].filename, filenameFor({ batchId: 'batch-1', index: 0, item: ITEM }));

  const delivery = await verifyInternetArchiveDelivery({ driver, manifest });
  assert.equal(delivery.ok, true);
  assert.equal(delivery.restoredSha256, manifest.sha);
  assert.equal(delivery.packetCount, manifest.chunks.length);
  assert.equal(delivery.deleted, false);
  assert.deepEqual(delivery.destructiveOperations, []);

  const back = await readInternetArchive({ driver, manifest });
  assert.deepEqual(back, plain);
  assert.equal(transport.calls.some((c) => c.method === 'DELETE'), false);
  assert.equal(transport.files.size, manifest.chunks.length);
});

await test('delete بلاک است و فایلهای قدیمی حفظ میشوند', async () => {
  const transport = new FixtureIas3({ item: ITEM });
  const driver = new InternetArchiveDriver({ transport, item: ITEM });
  await driver.put('stage/b/0', Buffer.from('x'));
  await assert.rejects(() => driver.delete('stage/b/0'), /IA_NO_DELETE/);
  assert.equal(await driver.has('stage/b/0'), true);
  assert.equal(transport.files.size, 1);
});

await test('بستهٔ دستکاریشده رد میشود، ولی هیچی پاک نمیشود', async () => {
  const transport = new FixtureIas3({ item: ITEM });
  const driver = new InternetArchiveDriver({ transport, item: ITEM, chunkSize: 64 });
  const manifest = await publishForInternetArchive({ driver, plain: new Uint8Array(300), batchId: 'bad' });
  const f = manifest.chunks[0].filename;
  const corrupted = Buffer.from(transport.files.get(f));
  corrupted[corrupted.length - 1] ^= 1;
  transport.files.set(f, corrupted);
  const trip = await driver.roundTrip();
  assert.equal(trip.ok, false);
  assert.equal(trip.deleted, false);
  assert.equal(trip.retainedInPrimary, true);
  assert.ok(trip.errors.length > 0);
  assert.equal(transport.files.size, manifest.chunks.length);
});

await test('اسکن سورس: ورسل/بله/توکن/DELETE/CJK ممنوع؛ کلید حتماً داخل سورس هست', () => {
  const files = ['key.mjs', 'cipher.mjs', 'ias3.mjs', 'adapter.mjs', 'fixture.mjs', 'cli.mjs']
    .map((f) => path.join(ROOT, f)).filter((f) => fs.existsSync(f));
  assert.equal(files.length, 6);
  const cjk = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
  for (const f of files) {
    const t = fs.readFileSync(f, 'utf8');
    assert.equal(/\bvercel\b/i.test(t), false, `${path.basename(f)}: vercel`);
    assert.equal(/\bbale\b/i.test(t), false, `${path.basename(f)}: bale`);
    assert.equal(t.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
    assert.equal(cjk.test(t), false, `${path.basename(f)}: CJK`);
  }
  const key = fs.readFileSync(path.join(ROOT, 'key.mjs'), 'utf8');
  assert.match(key, /export const KEY_HEX = '[0-9a-f]{64}'/);
  assert.match(key, /KEY_SOURCE = 'source-code'/);
  const ias3 = fs.readFileSync(path.join(ROOT, 'ias3.mjs'), 'utf8');
  assert.equal(ias3.includes('method: \'DELETE\''), false);
  assert.equal(ias3.includes('x-archive-cascade-delete\':'), false);
});

console.log(`\n${passed} tests passed.`);
if (process.exitCode) process.exit(process.exitCode);
