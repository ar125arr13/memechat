/* تستهای آفلاین «API رسمی بله» — بدون شبکه، بدون توکن واقعی، بدون ورسل.
 * اجرا: node r2-relay/bale/tests/run.mjs
 */

import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const R2 = path.join(ROOT, '..');

const {
  baleConfig, baleStatus, callBale, sendDirectMessage,
  encodePacketForBale, decodePacketFromBale, deliverBatch,
  getBaleUpdates, discoverChatId, receivePackets,
  BALE_API_ORIGIN, MAX_BALE_TEXT, BALE_PACKET_PREFIX,
} = await import(new URL('../api.mjs', import.meta.url).href);
const {
  FIXTURE_ENV, FIXTURE_TOKEN, FIXTURE_CHAT_ID,
  FIXTURE_ENCODED_PACKET, FIXTURE_PACKET,
  mockFetch, mockRateLimitFetch, mockFetchForPackets,
} = await import(new URL('../mock.mjs', import.meta.url).href);
const { SECOND_DB_KIND, BALE_DESTINATION } = await import(
  new URL('../../rubika/adapter.mjs', import.meta.url).href
);

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`  ok  ${name}`); passed++; }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.stack}`); process.exitCode = 1; }
};

await test('endpoint رسمی بله همان مستندات است', () => {
  assert.equal(BALE_API_ORIGIN, 'https://tapi.bale.ai');
  assert.equal(MAX_BALE_TEXT, 4096);
});

await test('baleConfig بدون env نه آماده است و نه رازی برمیگرداند', () => {
  const cfg = baleConfig({});
  assert.equal(cfg.configured, false);
  assert.equal(cfg.tokenPresent, false);
  assert.equal(cfg.chatIdPresent, false);
  assert.equal(cfg.vercelUsed, false);
  assert.equal(cfg.frontendSecrets, false);
  const blob = JSON.stringify(cfg);
  assert.equal(blob.includes('BALE_BOT_TOKEN'), false);
  assert.equal(blob.includes('BALE_CHAT_ID'), false);
});

await test('baleConfig با env فیکستر آماده است ولی مقدار توکن/چت لو نمیرود', () => {
  const cfg = baleConfig(FIXTURE_ENV);
  assert.equal(cfg.configured, true);
  assert.equal(cfg.endpoint, BALE_API_ORIGIN);
  assert.equal(cfg.officialApi, true);
  const blob = JSON.stringify(cfg);
  assert.equal(blob.includes(FIXTURE_TOKEN), false);
  assert.equal(blob.includes(FIXTURE_CHAT_ID), false);
});

await test('کدگذاری Markdown-safe بسته رفتوبرگشت سالم میماند', () => {
  const packet = 'MCPK1.abc_def.ghi_jkl';
  const encoded = encodePacketForBale(packet, FIXTURE_ENV);
  assert.ok(encoded.startsWith(BALE_PACKET_PREFIX));
  assert.equal(encoded.includes('_'), false);
  assert.ok(encoded.includes('%5F'));
  assert.equal(decodePacketFromBale(encoded, FIXTURE_ENV), packet);
  assert.equal(decodePacketFromBale('یک پیام معمولی', FIXTURE_ENV), null);
});

await test('بستهٔ غیر MCPK1 و بستهٔ خیلی بلند رد میشوند', () => {
  assert.throws(() => encodePacketForBale('سلام', FIXTURE_ENV), /NOT_MCPK1_PACKET/);
  assert.throws(
    () => encodePacketForBale(`MCPK1.${'a'.repeat(MAX_BALE_TEXT)}`, FIXTURE_ENV),
    /PACKET_TOO_LARGE_FOR_BALE/,
  );
});

await test('sendDirectMessage بدنهٔ درست میفرستد و رازی برنمیگرداند', async () => {
  const out = await sendDirectMessage({
    chatId: FIXTURE_CHAT_ID, token: FIXTURE_TOKEN,
    fetchImpl: mockFetch, env: FIXTURE_ENV, text: 'سلام از میمچت',
  });
  assert.equal(out.ok, true);
  assert.equal(out.destination, BALE_DESTINATION);
  assert.equal(out.vercelUsed, false);
  assert.equal(out.deleted, false);
  assert.equal(out.retainedInPrimary, true);
  const blob = JSON.stringify(out);
  assert.equal(blob.includes(FIXTURE_TOKEN), false);
  assert.equal(blob.includes(FIXTURE_CHAT_ID), false);
});

await test('getMe از طریق بلهٔ شبیهسازیشده ready=true میدهد', async () => {
  const s = await baleStatus({
    token: FIXTURE_TOKEN, fetchImpl: mockFetch, env: FIXTURE_ENV,
  });
  assert.equal(s.ready, true);
  assert.equal(s.officialApi, true);
  assert.equal(s.message.includes(FIXTURE_TOKEN), false);
});

await test('getUpdates و discoverChatId چت خصوصی را پیدا میکنند', async () => {
  const updates = await getBaleUpdates({
    token: FIXTURE_TOKEN, fetchImpl: mockFetch, env: FIXTURE_ENV,
  });
  assert.ok(Array.isArray(updates));
  assert.equal(discoverChatId(updates), FIXTURE_CHAT_ID);
});

await test('deliverBatch همهٔ بستهها را میفرستد، بدون حذف/ریست', async () => {
  const packets = [FIXTURE_PACKET];
  const manifest = {
    kind: SECOND_DB_KIND,
    batchId: 'bale-test-1',
    destination: BALE_DESTINATION,
    envelopeSha256: 'fixture-sha',
    packetCount: packets.length,
  };
  const report = await deliverBatch({
    packets, manifest, chatId: FIXTURE_CHAT_ID, token: FIXTURE_TOKEN,
    fetchImpl: mockFetch, env: FIXTURE_ENV, minIntervalMs: 0,
  });
  assert.equal(report.ok, true);
  assert.equal(report.sentCount, 1);
  assert.equal(report.total, 1);
  assert.equal(report.deleted, false);
  assert.equal(report.retainedInPrimary, true);
  assert.deepEqual(report.destructiveOperations, []);
  const blob = JSON.stringify(report);
  assert.equal(blob.includes(FIXTURE_TOKEN), false);
  assert.equal(blob.includes(FIXTURE_CHAT_ID), false);
});

await test('receivePackets بستهها را برمیگرداند و nextOffset درست است', async () => {
  const updates = await getBaleUpdates({
    token: FIXTURE_TOKEN, fetchImpl: mockFetch, env: FIXTURE_ENV,
  });
  const r = receivePackets(updates, FIXTURE_ENV);
  assert.equal(r.packetCount, 1);
  assert.ok(r.packets[0].startsWith('MCPK1.'));
  assert.equal(r.packets[0], FIXTURE_PACKET);
  assert.equal(r.nextOffset, 3);
  assert.equal(r.deleted, false);
  assert.equal(FIXTURE_ENCODED_PACKET.startsWith(BALE_PACKET_PREFIX), true);
});

await test('چرخهٔ کامل فیکستر: هر چند بسته export شد همانها برگردند', async () => {
  const ps = ['MCPK1.aaa.bbb', 'MCPK1.ccc.ddd', 'MCPK1.eee_fff.ggg'];
  const updates = await getBaleUpdates({
    token: FIXTURE_TOKEN,
    fetchImpl: mockFetchForPackets(ps),
    env: FIXTURE_ENV,
  });
  const r = receivePackets(updates, FIXTURE_ENV);
  assert.equal(r.packetCount, 3);
  assert.deepEqual(r.packets, ps);
  assert.equal(r.nextOffset, 5);
  assert.equal(r.deleted, false);
});

await test('خطای 429 بله retry_after میدهد و رازی لو نمیرود', async () => {
  await assert.rejects(
    () => callBale('sendMessage', { chat_id: FIXTURE_CHAT_ID, text: 'x' }, {
      token: FIXTURE_TOKEN, fetchImpl: mockRateLimitFetch, env: FIXTURE_ENV,
    }),
    (err) => {
      assert.equal(err.status, 429);
      assert.equal(err.retryAfter, 2);
      assert.equal(err.message.includes(FIXTURE_TOKEN), false);
      assert.equal(err.deleted, false);
      return true;
    },
  );
});

await test('سورس ماژول فقط دامنهٔ رسمی بله را دارد؛ ورسل/GitHub/روبیکا-private نیست', () => {
  const files = ['api.mjs', 'cli.mjs', 'mock.mjs'].map((f) => path.join(ROOT, f));
  const forbidden = [
    ['vercel', 'app'].join('.'),
    ['api', 'github', 'com'].join('.'),
    ['botapi', 'rubika'].join('.'),
    'GITHUB_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY',
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const marker of forbidden) assert.equal(text.includes(marker), false, `${file}: ${marker}`);
  }
  const api = fs.readFileSync(files[0], 'utf8');
  assert.equal(api.includes(BALE_API_ORIGIN), true);
});

console.log(`\n${passed} tests passed.`);
if (process.exitCode) process.exit(process.exitCode);
