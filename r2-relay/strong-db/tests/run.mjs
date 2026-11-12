/* تستهای آفلاین «دیتابیس دومِ محکم».
 * اجرا: node strong-db/tests/run.mjs
 * هیچ شبکه، حساب، کلید IA، لاگین روبیکا، استقرار یا حذفی در کار نیست.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { webcrypto } from 'node:crypto';
import { fileURLToPath } from 'node:url';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');

import { Catalog, CATALOG_KIND, CATALOG_VERSION, GENESIS_HASH } from '../catalog.mjs';
import { MemoryBlobStore, SavedMessagesStore, ReplicaSet, normalizedGet } from '../stores.mjs';
import {
  StrongDb, STRONG_DB_KIND, STRONG_DB_VERSION, blobFilename, FILE_PREFIX,
} from '../strong-db.mjs';
import { sha256Hex } from '../../internet-archive/cipher.mjs';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`  ok  ${name}`); passed++; }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.stack}`); process.exitCode = 1; }
};

const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'mc-strong-db-'));
const catalogPath = path.join(tmp, 'catalog.jsonl');
const replicaPath = path.join(tmp, 'replicas.json');

async function fresh() {
  const set = await new ReplicaSet({ filePath: replicaPath }).init();
  const db = new StrongDb({ stores: set.stores(), catalog: new Catalog({ filePath: catalogPath }) });
  await db.init();
  return { set, db };
}
async function clean() {
  await fs.rm(tmp, { recursive: true, force: true });
  await fs.mkdir(tmp, { recursive: true });
}

/* حاملی که نوشتن موفق report میکند ولی خواندنش یک بایت اضافه برمیگرداند. */
class FaultyGetStore extends MemoryBlobStore {
  async get(filename) {
    const r = await super.get(filename);
    if (this.fail && r.ok) {
      return { ok: true, bytes: Buffer.concat([r.bytes, Buffer.from('x')]) };
    }
    return r;
  }
}

await test('ثابتها و نام فایل امن', () => {
  assert.equal(STRONG_DB_KIND, 'memechat-strong-second-db');
  assert.equal(STRONG_DB_VERSION, 1);
  assert.equal(CATALOG_KIND, 'MCDB1');
  assert.equal(CATALOG_VERSION, 1);
  assert.equal(GENESIS_HASH.length, 64);
  assert.equal(FILE_PREFIX, 'mcdb/');
  const f = blobFilename({ item: 'memechat-strong-db', id: 'batch/with space' });
  assert.equal(f, 'mcdb/memechat-strong-db/batch-with-space/000000.mcia');
  assert.throws(() => blobFilename({ id: '' }), /STRONG_DB_ID_REQUIRED/);
});

await test('کاتالوگ فقطالحاقی است و زنجیر هش سالم میماند', async () => {
  await clean();
  const c = new Catalog({ filePath: catalogPath });
  assert.equal((await c.load()).ok, true);
  const a = await c.append({ event: 'put', id: 'a', sha: 'aa' });
  const b = await c.append({ event: 'put', id: 'b', sha: 'bb' });
  assert.equal(a.seq, 1);
  assert.equal(b.seq, 2);
  assert.equal(b.prevHash, a.hash);
  assert.equal(c.records.length, 2);
  assert.equal(c.verifyChain().ok, true);
  assert.equal(c.describe().appendOnly, true);
  assert.equal(c.describe().deleted, false);
  const idx = c.index();
  assert.equal(idx.puts.size, 2);
  assert.equal(idx.puts.get('b').sha, 'bb');
});

await test('دستکاری یک رکورد قدیمی زنجیر را میشکند، ولی چیزی پاک نمیشود', async () => {
  const c = new Catalog({ filePath: catalogPath });
  await c.load();
  const before = c.records.length;
  c.records[0].sha = 'f'.repeat(64);      // دستکاری درونحافظهای، بدون حذف
  const v = c.verifyChain();
  assert.equal(v.ok, false);
  assert.equal(v.brokenAt, 0);
  assert.equal(c.records.length, before);
  assert.equal(c.describe().chainOk, false);
});

await test('کاتالوگ از روی فایل دوباره بارگذاری و تأیید میشود', async () => {
  const c = new Catalog({ filePath: catalogPath });
  const v = await c.load();
  assert.equal(v.ok, true, 'فایل دستنخورده روی دیسک سالم است');
  assert.equal(c.records.length, 2);
  assert.equal(c.index().puts.size, 2);
});

await test('StrongDb حداقل دو حامل سالم میخواهد', () => {
  assert.throws(() => new StrongDb({ stores: [] }), /STRONG_DB_AT_LEAST_TWO_STORES/);
  assert.throws(() => new StrongDb({ stores: [new MemoryBlobStore()] }), /STRONG_DB_AT_LEAST_TWO_STORES/);
  assert.throws(() => new StrongDb({ stores: [new MemoryBlobStore(), {}] }), /STRONG_DB_BAD_STORE/);
});

await test('put: همان blob روی ۳ حامل نوشته و تکتک تأیید میشود', async () => {
  await clean();
  const { set, db } = await fresh();
  const plain = Buffer.from('میمچت — ساختار، فیلدها و ردیفها حفظ شوند', 'utf8');
  const r = await db.put({ id: 'batch-1', plain });
  assert.equal(r.verified, true);
  assert.equal(r.replicas.length, 3);
  assert.equal(r.replicas.every((x) => x.ok), true);
  assert.equal(r.algorithm, 'ChaCha20-Poly1305');
  assert.equal(r.keySource, 'source-code');
  assert.equal(r.plaintextSha256, sha256Hex(plain));
  assert.equal(r.deleted, false);
  assert.deepEqual(r.destructiveOperations, []);
  assert.equal(r.retainedInPrimary, true);
  assert.equal(r.chainSeq, 1);
  const names = r.replicas.map((x) => x.name);
  assert.deepEqual(names, ['internet-archive', 'saved-messages', 'local']);
  /* هر سه نسخه دقیقاً همان بستهٔ MCIA1 را دارند */
  for (const s of set.stores()) {
    const got = await normalizedGet(s, r.filename);
    assert.ok(got);
    assert.equal(sha256Hex(got), r.sha);
    assert.equal(got.subarray(0, 5).toString('ascii'), 'MCIA1');
  }
  await set.save();
});

await test('get: موبرهمو + AAD + Poly1305 + SHA تأیید میشود', async () => {
  const { db } = await fresh();
  const plain = Buffer.from('میمچت — ساختار، فیلدها و ردیفها حفظ شوند', 'utf8');
  const g = await db.get({ id: 'batch-1' });
  assert.equal(Buffer.compare(Buffer.from(g.plain), plain), 0);
  assert.equal(g.verified, true);
  assert.equal(g.repaired, false);
  assert.equal(g.from, 'internet-archive');
  assert.equal(g.algorithm, 'ChaCha20-Poly1305');
  assert.equal(g.aad.includes('batch-1'), true);
  assert.equal(g.deleted, false);
});

await test('verifyAll روی حالت سالم: زنجیر + تمام نسخهها سبز', async () => {
  const { db } = await fresh();
  const v = await db.verifyAll();
  assert.equal(v.healthy, true);
  assert.equal(v.chainOk, true);
  assert.equal(v.records, 1);
  assert.equal(v.replicasChecked, 3);
  assert.deepEqual(v.corrupt, []);
  assert.equal(v.deleted, false);
  assert.equal(v.primaryRowsUntouched, true);
});

await test('شناسهٔ تکراری رد میشود (هیچ بازنویسی/حذفی نیست)', async () => {
  const { db } = await fresh();
  await assert.rejects(() => db.put({ id: 'batch-1', plain: Buffer.from('دیگر') }),
    /STRONG_DB_DUPLICATE_ID/);
  assert.equal(db.catalog.records.length, 1);
});

await test('delete عمداً خطا میدهد؛ کاتالوگ و نسخهها سر جایند', async () => {
  const { db } = await fresh();
  await assert.rejects(() => db.delete('batch-1'), /STRONG_DB_NO_DELETE/);
  assert.equal(db.catalog.verifyChain().ok, true);
  assert.equal((await db.get({ id: 'batch-1' })).verified, true);
});

await test('خراب شدن یک نسخه → خودترمیمی از حامل دیگر + رکورد repair', async () => {
  const { set, db } = await fresh();
  const rec = db.catalog.index().puts.get('batch-1');
  set.corrupt('internet-archive', rec.filename, Buffer.from('CORRUPTED'));
  await set.save();
  const v = await db.verifyAll();
  assert.equal(v.healthy, false);
  assert.equal(v.chainOk, true);
  assert.equal(v.corrupt.length, 1);
  assert.equal(v.corrupt[0].store, 'internet-archive');
  assert.equal(v.deleted, false);
  const g = await db.get({ id: 'batch-1' });
  assert.equal(g.verified, true);
  assert.equal(g.repaired, true);
  assert.equal(g.from, 'saved-messages');
  assert.equal(g.failedStores[0].reason, 'SHA_MISMATCH');
  assert.equal(g.deleted, false);
  assert.equal(db.catalog.index().repairs.length, 1);
});

await test('دستکاری خود بسته (tag/AAD) قبل از برگرداندن plaintext رد میشود', async () => {
  await clean();
  const { set, db } = await fresh();
  const r = await db.put({ id: 'batch-2', plain: Buffer.from('قابل اعتماد') });
  const bad = Buffer.from(await normalizedGet(set.ia, r.filename));
  bad[bad.length - 1] ^= 0x01;                 // یک بیت از tag Poly1305
  for (const s of set.stores()) {
    await s.put(r.filename, bad);              // همان بستهٔ دستکاریشده (متنی یا باینری)
  }
  await set.save();
  const err = await db.get({ id: 'batch-2' }).catch((e) => e);
  assert.equal(err.message, 'STRONG_DB_ALL_REPLICAS_FAILED');
  assert.equal(err.deleted, false);
  assert.equal(err.retainedInPrimary, true);
  assert.ok(err.failedStores.length >= 3);
  assert.equal(db.catalog.verifyChain().ok, true, 'هیچ رکوردی پاک/تغییر نکرد');
});

await test('status محرمانگی و کوئریپذیری را ادعا نمیکند', async () => {
  await clean();
  const { db, set } = await fresh();
  await db.put({ id: 's1', plain: Buffer.from('x') });
  await set.save();
  const s = await db.status();
  assert.equal(s.kind, STRONG_DB_KIND);
  assert.equal(s.confidentiality.includes('integrity-only'), true);
  assert.equal(s.queryable, false);
  assert.equal(s.primary, 'Supabase unchanged');
  assert.equal(s.deleted, false);
  assert.equal(s.deployed, false);
  assert.equal(s.merged, false);
  assert.equal(s.vercelUsed, false);
  assert.equal(s.realLoginPerformed, false);
  assert.equal(s.realUploadPerformed, false);
  assert.equal(s.replicasPerRecord, 3);
  assert.equal(s.catalog.appendOnly, true);
  assert.match(s.keyFingerprint, /^[0-9a-f]{16}$/);
});

await test('ReplicaSet ماندگار است و بین دو نمونه داده گم نمیشود', async () => {
  const set2 = await new ReplicaSet({ filePath: replicaPath }).init();
  assert.equal(set2.ia.files.size, 1);
  assert.equal(set2.saved.messages.size, 1);
  assert.equal(set2.local.files.size, 1);
  assert.equal(set2.describe().length, 3);
  const cat = new Catalog({ filePath: catalogPath });
  assert.equal((await cat.load()).ok, true);
  assert.equal(cat.records.length, 1);
});

await test('نوشتن ناموفق: رکورد ثبت نمیشود، ولی شکست در کاتالوگ میماند', async () => {
  await clean();
  const cat = new Catalog({ filePath: catalogPath });
  await assert.rejects(() => cat.append({ v: 99, event: 'put' }), /CATALOG_RESERVED_FIELD:v/);
  const faulty = new FaultyGetStore({ name: 'faulty' });
  faulty.fail = true;
  const db = new StrongDb({
    stores: [new MemoryBlobStore({ name: 'good' }), faulty],
    catalog: new Catalog({ filePath: catalogPath }),
  });
  await db.init();
  const err = await db.put({ id: 'retry-1', plain: Buffer.from('دادهٔ مهم') }).catch((e) => e);
  assert.match(err.message, /STRONG_DB_REPLICA_VERIFY_FAILED:faulty/);
  assert.equal(err.deleted, false);
  assert.equal(err.retainedInPrimary, true);
  assert.equal(err.replicas[1].ok, false);
  assert.equal(db.catalog.verifyChain().ok, true);
  assert.equal(db.catalog.index().puts.size, 0);
  assert.equal(db.catalog.index().writeFailures.length, 1);
  await assert.rejects(() => db.get({ id: 'retry-1' }), /STRONG_DB_UNKNOWN_ID/);

  /* تلاش دوباره با همان شناسه مجاز است؛ رکورد شکست قبلی سر جایش میماند. */
  const db2 = new StrongDb({
    stores: [new MemoryBlobStore({ name: 'good-2' }), new MemoryBlobStore({ name: 'good-3' })],
    catalog: new Catalog({ filePath: catalogPath }),
  });
  await db2.init();
  const r = await db2.put({ id: 'retry-1', plain: Buffer.from('دادهٔ مهم') });
  assert.equal(r.verified, true);
  assert.equal((await db2.get({ id: 'retry-1' })).verified, true);
  assert.equal(db2.catalog.index().writeFailures.length, 1);
  assert.equal(db2.catalog.index().puts.size, 1);
  assert.equal(db2.catalog.records.length, 2);
  assert.equal(db2.catalog.verifyChain().ok, true);
});

await test('سورس ماژول راز/DELETE/ورسل/CJK ندارد و سند صادق است', async () => {
  const files = ['catalog.mjs', 'stores.mjs', 'strong-db.mjs', 'cli.mjs']
    .map((f) => path.join(ROOT, f));
  const joined = (await Promise.all(files.map((f) => fs.readFile(f, 'utf8')))).join('\n');
  assert.equal(joined.includes('SUPABASE_SERVICE_ROLE_KEY'), false);
  assert.equal(joined.includes('delete_messages('), false);
  assert.equal(joined.includes('api.vercel.com'), false);
  assert.equal(/[\u4e00-\u9fff\u3040-\u30ff\uac00-\ud7af\uff0c]/.test(joined), false);
  assert.equal(joined.includes('STRONG_DB_NO_DELETE'), true);
  const doc = await fs.readFile(path.join(ROOT, '..', '..', 'docs', 'STRONG-DB.md'), 'utf8');
  assert.equal(doc.includes('محرمانگی'), true);
  assert.equal(doc.includes('کوئریپذیر'), true);
  assert.equal(doc.includes('Supabase'), true);
});

await fs.rm(tmp, { recursive: true, force: true });
console.log(`\n${passed} تست «دیتابیس دومِ محکم» سبز شد (کاملاً آفلاین، بدون حساب و بدون حذف).`);
if (process.exitCode) process.exit(process.exitCode);
