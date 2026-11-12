/* تستهای «دیتابیس دوم → روبیکا»، بدون وابستگی خارجی.
 * اجرا: node r2-relay/rubika/tests/run.mjs
 */

import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const importLocal = (p) => import(pathToFileURL(p).href);

const {
  prepareBatch, verifyBatch, encryptEnvelope, decryptEnvelope,
  readPrimary, fixtureTables, TABLES, FORBIDDEN_MARKERS,
  SECOND_DB_KIND, DESTINATION,
} = await importLocal(path.join(ROOT, 'adapter.mjs'));
const { makePackets, joinPackets } = await importLocal(path.join(ROOT, '..', 'client', 'courier.js'));

const KEY = 'fixture-test-key-not-a-real-secret';
let passed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`  ok  ${name}`); passed++; }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.stack}`); process.exitCode = 1; }
};

await test('پاکت AES-256-GCM رفتوبرگشت شد و با کلید غلط باز نشد', async () => {
  const obj = { hello: 'سلام', n: 7 };
  const env = encryptEnvelope(obj, KEY);
  assert.equal(env.version, 1);
  assert.equal(env.algorithm, 'AES-256-GCM');
  assert.deepEqual(decryptEnvelope(env, KEY), obj);
  assert.throws(() => decryptEnvelope(env, 'another-key-that-is-long-enough'), /Unsupported state|auth/i);
});

await test('بستههای MCPK1: جابهجا، گمشده و دستکاریشده تشخیص داده میشوند', async () => {
  const payload = { a: 'بچ آرشیو '.repeat(20), b: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10] };
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  const packets = await makePackets(bytes, { id: 'b1', chunkSize: 40 });
  assert.ok(packets.length > 1);
  assert.ok(packets.every((p) => p.startsWith('MCPK1.')));
  const { bytes: back, meta } = await joinPackets([...packets].reverse());
  assert.deepEqual(back, bytes);
  await assert.rejects(() => joinPackets(packets.slice(1)), /missing packet/);
  const broken = [...packets];
  broken[0] = broken[0].replace(/\.[^.]+$/, '.AAAA');
  await assert.rejects(() => joinPackets(broken), /corrupt packet|payload hash|size mismatch|bad packet/);
});

await test('readPrimary فقط GET میزند و نام جدولها/فیلدها حفظ میشوند', async () => {
  const calls = [];
  const fixture = fixtureTables();
  const fakeFetch = async (url, opts) => {
    calls.push({ url, method: opts.method, body: opts.body });
    const u = new URL(url);
    const table = u.pathname.split('/').pop();
    const offset = Number(u.searchParams.get('offset') || 0);
    const limit = Number(u.searchParams.get('limit') || 200);
    const rows = fixture[table] || [];
    return { ok: true, json: async () => rows.slice(offset, offset + limit) };
  };
  const tables = await readPrimary({ base: 'https://example.supabase.co', serviceKey: 'test-service-key', fetchImpl: fakeFetch, pageSize: 2 });
  assert.ok(calls.length >= 2);
  assert.ok(calls.every((c) => c.method === 'GET' && c.body === undefined), 'هیچ نوشتن/حذفی نباید باشد');
  assert.deepEqual(Object.keys(tables), Object.keys(TABLES));
  assert.equal(tables.mimchat_staging_outbox.length, 2);
  assert.equal(tables.mimchat_staging_messages.length, 2);
  assert.ok(TABLES.mimchat_staging_messages.includes('github_commit_sha'));
  assert.equal(tables.mimchat_staging_messages[1].github_commit_sha, 'old-github-sha-kept', 'دادهٔ قدیمی دستنخورده ماند');
});

await test('prepareBatch: منیفست صادقانه، بدون API رسمی/ورسل/حذف/secret', async () => {
  const { manifest, packets, envelopeSha256 } = await prepareBatch({ tables: fixtureTables(), rawKey: KEY, batchId: 'batch-test-1', chunkSize: 300 });
  assert.equal(manifest.kind, SECOND_DB_KIND);
  assert.equal(manifest.destination, DESTINATION);
  assert.equal(manifest.officialApiUsed, false);
  assert.equal(manifest.vercelUsed, false);
  assert.equal(manifest.frontendSecrets, false);
  assert.equal(manifest.primaryRowsUntouched, true);
  assert.equal(manifest.deleted, false);
  assert.deepEqual(manifest.destructiveOperations, []);
  assert.equal(manifest.packetCount, packets.length);
  assert.ok(packets.length > 1);
  assert.equal(envelopeSha256.length, 64);
  assert.deepEqual(manifest.tableNames, Object.keys(TABLES));
  const blob = JSON.stringify(manifest) + '\n' + packets.join('\n');
  for (const marker of FORBIDDEN_MARKERS) assert.equal(blob.includes(marker), false, `نباید ${marker} لو برود`);
});

await test('verifyBatch: بستههای برگشتی از روبیکا موبهمو تأیید میشوند، صفر حذف', async () => {
  const { manifest, packets } = await prepareBatch({ tables: fixtureTables(), rawKey: KEY, batchId: 'batch-test-2', chunkSize: 250 });
  const report = await verifyBatch({ manifest, packets: [...packets].reverse(), rawKey: KEY });
  assert.equal(report.ok, true);
  assert.equal(report.deleted, false);
  assert.equal(report.primaryRowsUntouched, true);
  assert.equal(report.retainedInPrimary, true);
  assert.deepEqual(report.destructiveOperations, []);
  assert.equal(report.packetCount, packets.length);
  assert.equal(report.rowCounts.mimchat_staging_outbox, 2);
});

await test('verifyBatch: بستهٔ گمشده رد میشود ولی هیچ دادهای پاک نمیشود', async () => {
  const { manifest, packets } = await prepareBatch({ tables: fixtureTables(), rawKey: KEY, batchId: 'batch-test-3', chunkSize: 250 });
  await assert.rejects(
    () => verifyBatch({ manifest, packets: packets.slice(1), rawKey: KEY }),
    (e) => e.retainedInPrimary === true && e.deleted === false,
  );
});

await test('هیچ DELETE/PATCH/TRUNCATE/DROP واقعی تو ماژول جدید نیست', async () => {
  const src = fs.readFileSync(path.join(ROOT, 'adapter.mjs'), 'utf8');
  const cli = fs.readFileSync(path.join(ROOT, 'cli.mjs'), 'utf8');
  const bad = /\bmethod\s*:\s*['"](DELETE|PATCH|POST|PUT|TRUNCATE|DROP)['"]/i;
  assert.equal(bad.test(src), false);
  assert.equal(bad.test(cli), false);
  assert.equal(src.includes('DELETE'), true, 'فقط تو توضیح/کامنت مجاز است');
});

console.log(`\n${passed} tests passed.`);
if (process.exitCode) process.exit(process.exitCode);
