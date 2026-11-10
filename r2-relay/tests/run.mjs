// Dependency-free tests. Run with: node tests/run.mjs
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
  utf8, fromUtf8, sha256Hex, randomBytes, deriveAesKey,
  encryptChunk, decryptChunk, concatBytes, chunkBytes, unb64url,
} from '../worker/src/crypto.js';
import { makePackets, joinPackets, RUBIKA_MANUAL_COURIER } from '../client/courier.js';
import {
  MemoryDriver, ManualCourierDriver, RubikaCourierDriver, BaleDirectDriver,
  publishEncrypted, publishForRubika, publishForBaleDirect, verifyAndCommit,
  verifyRubikaDelivery, readEncrypted,
  encodePacketForBale, decodePacketFromBale, BALE_DIRECT_DESTINATION,
} from '../client/storage-adapter.js';
import { BaleDirectClient, BALE_API_ORIGIN, REQUIRED_CSP_CONNECT_SRC } from '../client/bale-direct.js';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`  ok  ${name}`); passed++; }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.stack}`); process.exitCode = 1; }
};

const key = await deriveAesKey('test-passphrase-not-a-real-secret', utf8('fixed-salt-for-tests'));

await test('AES-256-GCM round trip + ciphertext integrity', async () => {
  const plain = utf8('سلام میم چت — encrypted payload 1234567890');
  const p = await encryptChunk(key, plain, 'batch-1');
  assert.equal(p.v, 1);
  assert.equal(p.sha, await sha256Hex(unb64url(p.ct)));
  assert.equal(fromUtf8(await decryptChunk(key, p, 'batch-1')), fromUtf8(plain));
});

await test('tampered ciphertext is rejected before decryption', async () => {
  const p = await encryptChunk(key, utf8('secret'), 'aad');
  p.sha = '0'.repeat(64);
  await assert.rejects(() => decryptChunk(key, p, 'aad'), /integrity check failed/);
});

await test('wrong AAD fails authentication', async () => {
  const p = await encryptChunk(key, utf8('secret'), 'right');
  await assert.rejects(() => decryptChunk(key, p, 'wrong'));
});

await test('chunkBytes / concatBytes are lossless', async () => {
  const b = randomBytes(1000);
  assert.deepEqual(concatBytes(chunkBytes(b, 64)), b);
});

await test('no-API courier: pack -> carry -> join', async () => {
  const payload = randomBytes(4096);
  const packets = await makePackets(payload, { chunkSize: 500, name: 'backup.mcpack' });
  assert.ok(packets.length > 1);
  assert.ok(packets.every((p) => p.startsWith('MCPK1.')));
  const { bytes, meta } = await joinPackets([...packets].reverse());
  assert.deepEqual(bytes, payload);
  assert.equal(meta.n, packets.length);
  assert.equal(meta.sha, await sha256Hex(payload));
});

await test('no-API courier: missing or corrupt packet is detected', async () => {
  const packets = await makePackets(randomBytes(1200), { chunkSize: 400 });
  await assert.rejects(() => joinPackets(packets.slice(1)), /missing packet/);
  const broken = [...packets];
  broken[1] = broken[1].replace(/\.[^.]+$/, '.AAAA');
  await assert.rejects(() => joinPackets(broken), /corrupt packet|payload hash|size mismatch|bad packet/);
});

await test('publish -> verify -> commit -> read (legacy verify-before-delete)', async () => {
  const driver = new MemoryDriver();
  const plain = randomBytes(600000);            // forces 3 chunks at 256 KiB
  const manifest = await publishEncrypted({ driver, plain, key, batchId: 'batch-abc' });
  assert.equal(manifest.status, 'pending');
  assert.ok(manifest.chunks.length >= 3);
  for (const c of manifest.chunks) assert.equal(await driver.has(c.stageKey), true);

  const confirmed = await verifyAndCommit({ driver, manifest });
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.deleted.length, manifest.chunks.length);
  assert.equal(confirmed.commit.length, 64);
  for (const c of manifest.chunks) {
    assert.equal(await driver.has(c.stageKey), false, 'staging must be deleted');
    assert.equal(await driver.has(`blob/${c.sha}`), true, 'canonical blob must exist');
  }
  assert.deepEqual(await readEncrypted({ driver, manifest: confirmed, key }), plain);
});

await test('verification failure keeps EVERY staged byte (no deletion)', async () => {
  const driver = new MemoryDriver();
  const plain = utf8('important user data that must not be lost');
  const manifest = await publishEncrypted({ driver, plain, key, batchId: 'batch-fail', chunkSize: 8 });
  assert.ok(manifest.chunks.length > 1);
  const victim = manifest.chunks[1].stageKey;
  await driver.put(victim, utf8('corrupted on the mirror'));
  await assert.rejects(
    () => verifyAndCommit({ driver, manifest }),
    (e) => e.retainedInStaging === true,
  );
  for (const c of manifest.chunks) assert.equal(await driver.has(c.stageKey), true);
});

await test('ManualCourierDriver (alias RubikaCourierDriver) exports and re-imports', async () => {
  let exported = null;
  const driver = new ManualCourierDriver({ onExport: (_k, p) => { exported = p; }, chunkSize: 300 });
  const bytes = utf8('فایل رمزگذاری شده برای روبیکا، بدون API');
  await driver.put('chat-msg-1', bytes);
  assert.ok(Array.isArray(exported) && exported.length > 0);
  const other = new ManualCourierDriver();
  await other.import('chat-msg-1', exported);
  assert.equal(fromUtf8(await other.get('chat-msg-1')), fromUtf8(bytes));
});

/* ---------------- تستهای معماری تازهٔ دیتابیس دوم ---------------- */

await test('کوریر روبیکا: بدون API رسمی، بدون ورسل، بدون حذف', async () => {
  assert.equal(RUBIKA_MANUAL_COURIER.officialApiUsed, false);
  assert.equal(RUBIKA_MANUAL_COURIER.vercelUsed, false);
  assert.equal(RUBIKA_MANUAL_COURIER.deletes, false);
  const driver = new RubikaCourierDriver();
  await assert.rejects(() => driver.delete('anything'), /NO_DELETE/);
});

await test('publishForRubika: منیفست صراحتاً «حذف ممنوع» دارد', async () => {
  const driver = new MemoryDriver();
  const plain = utf8('بچ آرشیو دیتابیس دوم');
  const manifest = await publishForRubika({ driver, plain, key, batchId: 'rubika-1', chunkSize: 64 });
  assert.equal(manifest.destination, 'rubika-manual-courier');
  assert.equal(manifest.noDelete, true);
  assert.equal(manifest.deleted, false);
  assert.equal(manifest.primaryRowsUntouched, true);
  assert.deepEqual(manifest.destructiveOperations, []);
});

await test('verifyRubikaDelivery: همهٔ بایتها میمانند، صفر حذف، خواندن سالم', async () => {
  const driver = new MemoryDriver();
  const plain = randomBytes(5000);
  const manifest = await publishForRubika({ driver, plain, key, batchId: 'rubika-2', chunkSize: 512 });
  const confirmed = await verifyRubikaDelivery({ driver, manifest });
  assert.equal(confirmed.status, 'confirmed');
  assert.equal(confirmed.deleted, false);
  assert.deepEqual(confirmed.deletedKeys, []);
  assert.deepEqual(confirmed.destructiveOperations, []);
  for (const c of manifest.chunks) {
    assert.equal(await driver.has(c.stageKey), true, 'staging هم باید بماند');
    assert.equal(await driver.has(`rubika/${c.sha}`), true, 'نسخهٔ روبیکا هم ساخته شد');
  }
  assert.deepEqual(await readEncrypted({ driver, manifest: confirmed, key, prefix: 'rubika' }), plain);
});

await test('RubikaCourierDriver.confirm: هش پاکت تأیید میشود، باز هم صفر حذف', async () => {
  const bytes = utf8('بستهٔ برگشتی از پیامهای ذخیرهشدهٔ روبیکا');
  const packets = await makePackets(bytes, { id: 'rb-1', chunkSize: 40 });
  const manifest = { batchId: 'rb-1', envelopeSha256: await sha256Hex(bytes) };
  const driver = new RubikaCourierDriver();
  const report = await driver.confirm(manifest, packets);
  assert.equal(report.ok, true);
  assert.equal(report.deleted, false);
  assert.equal(report.retainedInPrimary, true);
  assert.equal(report.officialApiUsed, false);
  assert.equal(report.vercelUsed, false);
});

/* ---------------- API بله مستقیم از سورس، بدون بکاند ---------------- */

const BALE_FIXTURE_TOKEN = ['123456789', 'browserFixtureNotReal'].join(':');
const BALE_FIXTURE_CHATS = ['9001', '9002'];
const baleCalls = [];
const baleFetch = async (url, opts) => {
  baleCalls.push({ url, method: opts.method, body: opts.body });
  return { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 42 } }) };
};

await test('bale-direct: آدرس API تو سورس است و بسته رفتوبرگشت سالم میماند', () => {
  assert.equal(BALE_API_ORIGIN, 'https://tapi.bale.ai');
  assert.ok(REQUIRED_CSP_CONNECT_SRC.includes('tapi.bale.ai'));
  const packet = 'MCPK1.abc_def.ghi_jkl';
  const encoded = encodePacketForBale(packet, {});
  assert.equal(encoded.includes('_'), false);
  assert.ok(encoded.includes('%5F'));
  assert.equal(decodePacketFromBale(encoded, {}), packet);
  assert.equal(decodePacketFromBale('یک پیام معمولی', {}), null);
  assert.throws(() => encodePacketForBale('سلام', {}), /NOT_MCPK1_PACKET/);
});

await test('BaleDirectClient: بستهها برای چند بازوی بیکار میروند، بدون بکاند/راز', async () => {
  const packets = await makePackets(utf8('بستهٔ رمزشدهٔ تستی برای بازوهای بیکار'), { id: 'bd-1', chunkSize: 40 });
  const client = new BaleDirectClient({
    token: BALE_FIXTURE_TOKEN, chatIds: BALE_FIXTURE_CHATS,
    fetchImpl: baleFetch, minIntervalMs: 0,
  });
  const report = await client.sendPackets({ packets });
  assert.equal(report.destination, BALE_DIRECT_DESTINATION);
  assert.equal(report.backend, false);
  assert.equal(report.vercelUsed, false);
  assert.equal(report.frontendSecretInSource, false);
  assert.equal(report.idleBotCount, 2);
  assert.equal(report.sentCount, packets.length * 2);
  assert.equal(report.verifiedCount, report.sentCount);
  assert.equal(report.deleted, false);
  assert.equal(report.retainedInPrimary, true);
  assert.deepEqual(report.destructiveOperations, []);
  const blob = JSON.stringify(report);
  assert.equal(blob.includes(BALE_FIXTURE_TOKEN), false);
  assert.equal(blob.includes('9001'), false);
  assert.equal(blob.includes('9002'), false);
  assert.ok(baleCalls.every((c) => c.url.startsWith(BALE_API_ORIGIN)));
});

await test('publishForBaleDirect: فایل رمزشده ارسال و همان نسخه محلی خوانده میشود', async () => {
  const driver = new BaleDirectDriver({
    token: BALE_FIXTURE_TOKEN, chatIds: ['9001'],
    fetchImpl: baleFetch, minIntervalMs: 0, chunkSize: 64,
  });
  const plain = randomBytes(300);
  const manifest = await publishForBaleDirect({ driver, plain, key, batchId: 'bd-2', chunkSize: 64 });
  assert.equal(manifest.destination, BALE_DIRECT_DESTINATION);
  assert.equal(manifest.status, 'confirmed');
  assert.equal(manifest.backend, false);
  assert.equal(manifest.frontendSecrets, false);
  assert.equal(manifest.tokenSuppliedAtRuntime, true);
  assert.equal(manifest.deleted, false);
  assert.deepEqual(manifest.destructiveOperations, []);
  assert.deepEqual(await readEncrypted({ driver, manifest, key, prefix: 'blob' }), plain);
  assert.ok(driver.lastDelivery && driver.lastDelivery.sentCount > 0);
  await assert.rejects(() => driver.delete('x'), /BALE_NO_DELETE/);
});

await test('bale-direct: اگر CORS پاسخ ندهد، ارسال میشود ولی «تأیید نشده» علامت میخورد', async () => {
  const flaky = async (_url, opts) => {
    if (opts && opts.mode === 'no-cors') {
      return { ok: false, status: 0, json: async () => ({}) };
    }
    throw new TypeError('Failed to fetch');
  };
  const client = new BaleDirectClient({
    token: BALE_FIXTURE_TOKEN, chatIds: ['9001'],
    fetchImpl: flaky, minIntervalMs: 0, allowOpaque: true,
  });
  const packets = await makePackets(utf8('cors'), { id: 'bd-3', chunkSize: 40 });
  const report = await client.sendPackets({ packets });
  assert.equal(report.sentCount, packets.length);
  assert.equal(report.verifiedCount, 0);
  assert.equal(report.unverifiedCount, packets.length);
  assert.equal(report.opaqueFallbackUsed, true);
  assert.equal(report.deleted, false);
  assert.equal(report.retainedInPrimary, true);
});

await test('bale-direct: بدون توکن موقع اجرا، هیچ ارسالی انجام نمیشود', async () => {
  const client = new BaleDirectClient({ token: '', chatIds: [], fetchImpl: baleFetch, minIntervalMs: 0 });
  assert.equal(client.configured, false);
  await assert.rejects(
    () => client.sendPackets({ packets: ['MCPK1.a.b'] }),
    /BALE_RUNTIME_CONFIG_MISSING/,
  );
});

console.log(`\n${passed} tests passed.`);
if (process.exitCode) process.exit(process.exitCode);
