// Dependency-free tests. Run with: node tests/run.mjs
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import {
  utf8, fromUtf8, sha256Hex, randomBytes, deriveAesKey,
  encryptChunk, decryptChunk, concatBytes, chunkBytes, unb64url,
} from '../worker/src/crypto.js';
import { makePackets, joinPackets } from '../client/courier.js';
import {
  MemoryDriver, ManualCourierDriver, publishEncrypted,
  verifyAndCommit, readEncrypted,
} from '../client/storage-adapter.js';

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

await test('publish -> verify -> commit -> read (verify-before-delete)', async () => {
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

await test('ManualCourierDriver exports packets and re-imports them', async () => {
  let exported = null;
  const driver = new ManualCourierDriver({ onExport: (_k, p) => { exported = p; }, chunkSize: 300 });
  const bytes = utf8('فایل رمزگذاری شده برای روبیکا، بدون API');
  await driver.put('chat-msg-1', bytes);
  assert.ok(Array.isArray(exported) && exported.length > 0);
  const other = new ManualCourierDriver();
  await other.import('chat-msg-1', exported);
  assert.equal(fromUtf8(await other.get('chat-msg-1')), fromUtf8(bytes));
});

console.log(`\n${passed} tests passed.`);
if (process.exitCode) process.exit(process.exitCode);
