/* تستهای آفلاین «دیتابیس اصلی تعیینشده = بله، فعال موقت = سوپا».
 * اجرا: node r2-relay/primary/tests/run.mjs
 * هیچ شبکه، هیچ توکن واقعی، هیچ استقرار، هیچ حذف.
 */

import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const {
  PrimaryDbRouter, probeBale, baleCapabilityReport,
  DESIGNATED_PRIMARY, ACTIVE_FALLBACK, LEGACY_SECOND_DB,
  REQUIRED_PRIMARY_CAPABILITIES, BALE_CAPABILITIES,
} = await import(new URL('../router.mjs', import.meta.url).href);
const { TABLES } = await import(new URL('../../rubika/adapter.mjs', import.meta.url).href);
const {
  FIXTURE_ENV, FIXTURE_TOKEN, FIXTURE_CHAT_ID, mockFetch,
  mockEchoFetch, mockRateLimitFetch,
} = await import(new URL('../../bale/mock.mjs', import.meta.url).href);
const {
  BalePrimaryTrial, runPreflight, DEFAULT_TRIAL_MS, MAX_TRIAL_MS,
} = await import(new URL('../trial.mjs', import.meta.url).href);

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`  ok  ${name}`); passed++; }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.stack}`); process.exitCode = 1; }
};

function fakeSupabase() {
  return {
    name: 'supabase-primary-temporary',
    rows: new Map(),
    calls: [],
    async read(table, opts = {}) {
      this.calls.push({ op: 'read', table, method: opts.method || 'GET' });
      return { table, rows: this.rows.get(table) || [], method: opts.method || 'GET' };
    },
    async write(table, payload, opts = {}) {
      this.calls.push({ op: 'write', table, allowWrites: opts.allowWrites === true });
      return { table, payload, allowWrites: opts.allowWrites === true };
    },
  };
}

await test('بله «اصلی تعیینشده» است ولی سوپا «فعال موقت» است', () => {
  const r = new PrimaryDbRouter({ supabase: fakeSupabase() });
  const s = r.status();
  assert.equal(s.designatedPrimary, DESIGNATED_PRIMARY);
  assert.equal(s.activePrimary, ACTIVE_FALLBACK);
  assert.equal(s.temporary, true);
  assert.equal(s.dataDeleted, false);
  assert.equal(s.deleted, false);
  assert.deepEqual(s.destructiveOperations, []);
  assert.equal(s.primaryRowsUntouched, true);
  assert.equal(s.vercelUsed, false);
  assert.equal(s.frontendSecrets, false);
  assert.equal(s.deployed, false);
  assert.equal(s.merged, false);
});

await test('گزارش قابلیتها صادقانه است: بله دیتابیس نیست', () => {
  const c = baleCapabilityReport();
  assert.equal(c.canBePrimary, false);
  assert.equal(c.endpoint, 'https://tapi.bale.ai');
  assert.equal(c.limits.maxTextChars, 4096);
  assert.equal(c.limits.updateRetentionHours, 24);
  assert.equal(c.limits.updateRetentionCount, 2000);
  for (const cap of REQUIRED_PRIMARY_CAPABILITIES) {
    assert.equal(BALE_CAPABILITIES[cap], false, `${cap} نباید true باشد`);
    assert.ok(c.missing.includes(cap), `${cap} باید تو لیست کمبودها باشد`);
  }
  assert.ok(c.conclusion.includes('نه دیتابیس'));
});

await test('نام جدولها/فیلدها حفظ شدند و روبیکا حذف نشد', () => {
  const r = new PrimaryDbRouter({ supabase: fakeSupabase() });
  const s = r.status();
  assert.deepEqual(s.preservedSchema.tableNames, Object.keys(TABLES));
  assert.equal(s.preservedSchema.columns.mimchat_staging_messages.includes('github_commit_sha'), true);
  assert.equal(s.legacySecondDb.kind, LEGACY_SECOND_DB);
  assert.equal(s.legacySecondDb.works, false);
  assert.equal(s.legacySecondDb.deleted, false);
});

await test('tryPromoteBale شکست میخورد و خودکار سوپا رو موقتاً برمیگرداند', async () => {
  const r = new PrimaryDbRouter({
    supabase: fakeSupabase(),
    bale: {
      token: FIXTURE_TOKEN, chatId: FIXTURE_CHAT_ID,
      fetchImpl: mockFetch, env: FIXTURE_ENV,
    },
  });
  const out = await r.tryPromoteBale();
  assert.equal(out.repaired, true);
  assert.equal(out.promoted, undefined);
  assert.equal(out.active, ACTIVE_FALLBACK);
  assert.equal(out.temporary, true);
  assert.equal(out.reversible, true);
  assert.equal(out.dataDeleted, false);
  assert.deepEqual(out.destructiveOperations, []);
  assert.equal(r.status().activePrimary, ACTIVE_FALLBACK);
  assert.equal(r.status().designatedPrimary, DESIGNATED_PRIMARY);
  assert.ok(r.status().incidents.length >= 1);
});

await test('پروب واقعی: getMe/getUpdates/sendMessage جواب میدهند ولی قابلیت DB نه', async () => {
  const report = await probeBale({
    token: FIXTURE_TOKEN, chatId: FIXTURE_CHAT_ID,
    fetchImpl: mockFetch, env: FIXTURE_ENV,
  });
  assert.equal(report.canBePrimary, false);
  const byName = Object.fromEntries(report.checks.map((c) => [c.name, c.ok]));
  assert.equal(byName.credentialsAtRuntime, true);
  assert.equal(byName.getMe, true);
  assert.equal(byName.getUpdates, true);
  assert.equal(byName.sendMessage, true);
  assert.equal(byName['capability:sqlQuery'], false);
  assert.equal(byName['capability:transaction'], false);
  assert.equal(byName['capability:durableStorage'], false);
  assert.ok(report.missing.length > 0);
  assert.equal(report.dataDeleted, false);
});

await test('repair/rollback برگشتپذیر است و راز/حذفی تو گزارش نیست', () => {
  const r = new PrimaryDbRouter({ supabase: fakeSupabase() });
  const a = r.repair('TEST_A');
  const b = r.rollbackToSupabase();
  assert.equal(a.active, ACTIVE_FALLBACK);
  assert.equal(b.active, ACTIVE_FALLBACK);
  assert.equal(r.status().incidents.length, 2);
  const blob = JSON.stringify(r.status());
  assert.equal(blob.includes(FIXTURE_TOKEN), false);
  assert.equal(blob.includes(FIXTURE_CHAT_ID), false);
  assert.equal(blob.includes('dataDeleted":true'), false);
  assert.equal(r.assertIntegrity().ok, true);
});

await test('read فقط GET میزند؛ write مخرب رد میشود', async () => {
  const supa = fakeSupabase();
  const r = new PrimaryDbRouter({ supabase: supa });
  const read = await r.read('mimchat_staging_messages');
  assert.equal(read.method, 'GET');
  assert.equal(supa.calls[0].op, 'read');
  await assert.rejects(
    () => r.write('mimchat_staging_messages', { sql: 'DELETE FROM users' }),
    /DESTRUCTIVE_OPERATION_BLOCKED/,
  );
  const ok = await r.write('mimchat_staging_messages', { note: 'additive' });
  assert.equal(ok.allowWrites, true);
  assert.equal(r.assertIntegrity().ok, true);
});

await test('اگه کسی اصلی رو عوض کند، write بلاک میشود تا سوپا دستنخورده بماند', async () => {
  const r = new PrimaryDbRouter({ supabase: fakeSupabase() });
  r.active = DESIGNATED_PRIMARY;
  await assert.rejects(
    () => r.write('x', { note: 'safe' }),
    (e) => e.active === DESIGNATED_PRIMARY && e.dataDeleted === false,
  );
  r.rollbackToSupabase();
  assert.equal(r.status().activePrimary, ACTIVE_FALLBACK);
});

await test('سورس router فقط دامنهٔ رسمی بله را دارد؛ ورسل/GitHub/روبیکا-private نیست', () => {
  const src = fs.readFileSync(path.join(ROOT, 'router.mjs'), 'utf8');
  const forbidden = [
    ['vercel', 'app'].join('.'),
    ['api', 'github', 'com'].join('.'),
    ['botapi', 'rubika'].join('.'),
    'GITHUB_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY',
  ];
  for (const m of forbidden) assert.equal(src.includes(m), false, m);
  assert.equal(src.includes('https://tapi.bale.ai'), true);
  const cjk = /[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af]/;
  assert.equal(cjk.test(src), false);
});

/* ---------------- تست محدودزمانی «الان تنظیمش کن روی بله» ---------------- */

await test('trial: بله چند ثانیه فعال شد، فایل رمزشده رفت و برگشت و SHA تأیید شد', async () => {
  const router = new PrimaryDbRouter({ supabase: fakeSupabase() });
  const trial = new BalePrimaryTrial({
    router, token: FIXTURE_TOKEN, chatId: FIXTURE_CHAT_ID,
    fetchImpl: mockEchoFetch(), env: FIXTURE_ENV, durationMs: 2000,
  });
  const r = await trial.run();
  assert.equal(r.blocked, null);
  assert.equal(r.ok, true);
  assert.equal(r.activeDuringTrial, DESIGNATED_PRIMARY);
  assert.equal(r.activeAfter, ACTIVE_FALLBACK);
  assert.equal(r.temporaryAfter, true);
  assert.equal(r.repaired, true);
  assert.equal(r.reversible, true);
  assert.ok(r.autoRepairReason);
  assert.equal(r.roundTrip.verified, true);
  assert.equal(r.roundTrip.encryption, 'AES-256-GCM');
  assert.equal(r.roundTrip.receivedCount, r.roundTrip.packetCount);
  assert.equal(r.roundTrip.envelopeSha256, r.roundTrip.restoredSha256);
  assert.equal(r.dataDeleted, false);
  assert.deepEqual(r.destructiveOperations, []);
  assert.equal(r.retainedInPrimary, true);
  assert.equal(router.status().activePrimary, ACTIVE_FALLBACK);
  assert.equal(router.assertIntegrity().ok, true);
  const blob = JSON.stringify(r);
  assert.equal(blob.includes(FIXTURE_TOKEN), false);
  assert.equal(blob.includes(FIXTURE_CHAT_ID), false);
});

await test('trial: اگه بله خراب شود، باز هم خودکار و فوری برمیگردد رو سوپا', async () => {
  const router = new PrimaryDbRouter({ supabase: fakeSupabase() });
  const trial = new BalePrimaryTrial({
    router, token: FIXTURE_TOKEN, chatId: FIXTURE_CHAT_ID,
    fetchImpl: mockRateLimitFetch, env: FIXTURE_ENV, durationMs: 1000,
  });
  const r = await trial.run();
  assert.equal(r.ok, false);
  assert.ok(String(r.error).includes('BALE_429'));
  assert.equal(r.activeAfter, ACTIVE_FALLBACK);
  assert.equal(r.repaired, true);
  assert.equal(r.dataDeleted, false);
  assert.deepEqual(r.destructiveOperations, []);
  assert.equal(router.status().activePrimary, ACTIVE_FALLBACK);
  assert.ok(router.status().incidents.length >= 1);
});

await test('trial: سقف مدت رعایت میشود (درخواست بیش از ۵ دقیقه clamp میشود)', () => {
  const router = new PrimaryDbRouter({ supabase: fakeSupabase() });
  const trial = new BalePrimaryTrial({
    router, token: FIXTURE_TOKEN, chatId: FIXTURE_CHAT_ID,
    fetchImpl: mockFetch, env: FIXTURE_ENV, durationMs: MAX_TRIAL_MS + 60_000,
  });
  assert.equal(trial.durationMs, MAX_TRIAL_MS);
  assert.equal(trial.durationClamped, true);
  assert.equal(DEFAULT_TRIAL_MS, 30_000);
  assert.equal(trial.status().config.ready, true);
});

await test('trial: بدون توکن/چتآیدی هیچ تماسی برقرار نمیشود و سوپا دستنخورده میماند', async () => {
  const router = new PrimaryDbRouter({ supabase: fakeSupabase() });
  const trial = new BalePrimaryTrial({
    router, token: '', chatId: '', fetchImpl: mockEchoFetch(), env: {}, durationMs: 1000,
  });
  const r = await trial.run();
  assert.equal(r.ok, false);
  assert.equal(r.blocked, 'NO_RUNTIME_CREDENTIALS');
  assert.equal(r.activeAfter, ACTIVE_FALLBACK);
  assert.equal(router.status().activePrimary, ACTIVE_FALLBACK);
  assert.equal(r.dataDeleted, false);
});

await test('trial: حین تست نوشتن به سوپا بلاک است تا چیزی عوض نشود', async () => {
  const router = new PrimaryDbRouter({ supabase: fakeSupabase() });
  router.active = DESIGNATED_PRIMARY;
  await assert.rejects(
    () => router.write('mimchat_staging_messages', { note: 'safe' }),
    /NON_SUPABASE_PRIMARY_NOT_ALLOWED/,
  );
  router.rollbackToSupabase();
  assert.equal(router.status().activePrimary, ACTIVE_FALLBACK);
});

await test('preflight: با توکن فیکستر، getMe و getUpdates تأیید میشوند و رازی چاپ نمیشود', async () => {
  const r = await runPreflight({
    token: FIXTURE_TOKEN, chatId: FIXTURE_CHAT_ID,
    fetchImpl: mockFetch, env: FIXTURE_ENV,
  });
  assert.equal(r.ok, true);
  assert.equal(r.blocked, null);
  assert.equal(r.getMeOk, true);
  assert.equal(r.updatesReachable, true);
  assert.equal(r.endpoint, 'https://tapi.bale.ai');
  assert.equal(r.vercelUsed, false);
  assert.equal(r.dataDeleted, false);
  const blob = JSON.stringify(r);
  assert.equal(blob.includes(FIXTURE_TOKEN), false);
  assert.equal(blob.includes(FIXTURE_CHAT_ID), false);
});

await test('preflight: بدون توکن، تست واقعی بلاک میشود و هیچ تماسی زده نمیشود', async () => {
  const r = await runPreflight({
    token: '', chatId: '', fetchImpl: mockFetch, env: {},
  });
  assert.equal(r.ok, false);
  assert.equal(r.blocked, 'NO_RUNTIME_CREDENTIALS');
  assert.equal(r.getMeOk, false);
  assert.equal(r.updatesReachable, false);
  assert.equal(r.dataDeleted, false);
});

console.log(`\n${passed} tests passed.`);
if (process.exitCode) process.exit(process.exitCode);
