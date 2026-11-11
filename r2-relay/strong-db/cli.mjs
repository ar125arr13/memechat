#!/usr/bin/env node
/* خطفرمان «دیتابیس دومِ محکم» — فقط توسط عامل اجرا میشود.
 *
 *   node strong-db/cli.mjs trial    # نوشتن + تکثیر + خرابکردن + خودترمیمی + تأیید
 *   node strong-db/cli.mjs verify   # سلامت کل کاتالوگ و هر سه نسخه
 *   node strong-db/cli.mjs status   # وضعیت صادقانه
 *   node strong-db/cli.mjs help
 *
 * همهچیز آفلاین و محلی است: هیچ آپلود IA، لاگین روبیکا، سشن، توکن،
 * استقرار، مرج، ورسل یا تغییر Supabaseـای انجام نمیشود.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const CATALOG = path.join(OUT, 'catalog.jsonl');
const REPLICAS = path.join(OUT, 'replicas.json');
const LAST = path.join(OUT, 'last-verify.json');

import { Catalog } from './catalog.mjs';
import { ReplicaSet } from './stores.mjs';
import { StrongDb, STRONG_DB_KIND } from './strong-db.mjs';

async function build() {
  await fs.mkdir(OUT, { recursive: true });
  const set = await new ReplicaSet({ filePath: REPLICAS }).init();
  const db = new StrongDb({ stores: set.stores(), catalog: new Catalog({ filePath: CATALOG }) });
  const chain = await db.init();
  return { db, set, chain };
}

async function trial() {
  const { db, set, chain } = await build();
  const stamp = Date.now().toString(36);
  const payloads = [
    Buffer.from('میمچت — ردیف آزمایشی ۱: ساختار و فیلدها حفظ شوند', 'utf8'),
    Buffer.from(JSON.stringify({ kind: 'sample', rows: [{ id: 'r1', text: 'آرشیو' }, { id: 'r2', text: 'بدون حذف' }] }), 'utf8'),
    Buffer.from(await import('node:crypto').then(({ randomBytes }) => randomBytes(2048))),
  ];
  const ids = payloads.map((_, i) => `mc-strong-${stamp}-${i}`);

  const receipts = [];
  for (let i = 0; i < payloads.length; i++) {
    receipts.push(await db.put({ id: ids[i], plain: payloads[i] }));
    await set.save();
  }
  const clean = await db.verifyAll();

  /* برگشت موبرهمو از روی حاملها */
  const reads = [];
  for (let i = 0; i < payloads.length; i++) {
    const r = await db.get({ id: ids[i] });
    reads.push(Buffer.compare(Buffer.from(r.plain), payloads[i]) === 0 && r.verified);
  }

  /* خرابکردن عمدی یک نسخه (بدون پاک کردن هیچچیز) */
  const brokenId = ids[0];
  const filename = receipts[0].filename;
  set.corrupt('internet-archive', filename, Buffer.from('CORRUPTED-REPLICA'));
  await set.save();
  const damaged = await db.verifyAll();
  const healed = await db.get({ id: brokenId });

  /* ترمیم: همان blob سالم از حامل دیگر خوانده و دوباره نوشته میشود.
   * چیزی پاک نمیشود؛ فقط نسخهٔ خراب با محتوای تأییدشده جایگزین میشود. */
  const good = await set.saved.get(filename);
  await set.ia.put(filename, good.bytes);
  await db.catalog.append({
    event: 'replica-restored', id: brokenId, store: 'internet-archive',
    sha: receipts[0].sha, deleted: false,
  });
  await set.save();
  const restored = await db.verifyAll();

  await fs.writeFile(LAST, JSON.stringify({
    kind: STRONG_DB_KIND, trialAt: new Date().toISOString(),
    clean, damaged, restored, repairedFrom: healed.from,
    deleted: false, destructiveOperations: [],
  }, null, 2) + '\n', 'utf8');

  console.log('');
  console.log(`زنجیر کاتالوگ هنگام شروع: ${chain.ok ? 'سالم' : 'شکسته'} | رکوردهای قبلی: ${chain.length}`);
  console.log(`نوشتهها: ${receipts.length} | نسخهها برای هر رکورد: ${db.stores.length} | الگوریتم: ${receipts[0].algorithm}`);
  console.log(`تأیید نوشتن (write-verify): ${receipts.every((r) => r.replicas.every((x) => x.ok))}`);
  console.log(`برگشت موبرهمو: ${reads.every(Boolean)} | سلامت اولیه: ${clean.healthy} | نسخههای چکشده: ${clean.replicasChecked}`);
  console.log(`بعد از خرابکردن یک نسخه: سلامت=${damaged.healthy} | خراب=${damaged.corrupt.length} | خودترمیمی از «${healed.from}»: ${healed.repaired}`);
  console.log(`بعد از ترمیم: سلامت=${restored.healthy} | خراب=${restored.corrupt.length} | رکورد repair: ${restored.repairs}`);
  console.log(`حذف/ریست: false | عملیات مخرب: 0 | Supabase: بدون تغییر | دیپلوی/مرج/ورسل: خیر`);
  console.log('⚠️ تمامیت و افزونگی بله؛ محرمانگی خیر (مخزن public + آیتمهای IA عمومی). کوئریپذیر هم نیست.');
  if (!clean.healthy || !restored.healthy || reads.some((x) => !x) || !healed.repaired || damaged.healthy) {
    process.exitCode = 1;
  }
}

async function verify() {
  const { db } = await build();
  const r = await db.verifyAll();
  await fs.writeFile(LAST, JSON.stringify({ kind: STRONG_DB_KIND, verifiedAt: new Date().toISOString(), ...r }, null, 2) + '\n', 'utf8');
  console.log('');
  console.log(`سلامت کل: ${r.healthy} | زنجیر کاتالوگ: ${r.chainOk} | رکوردها: ${r.records}`);
  console.log(`نسخههای بررسیشده: ${r.replicasChecked} | خراب: ${r.corrupt.length} | رکورد repair: ${r.repairs}`);
  for (const c of r.corrupt) console.log(`  ⚠️ ${c.id} / ${c.store}: ${c.reason}`);
  console.log(`حذف/ریست: ${r.deleted} | عملیات مخرب: ${r.destructiveOperations.length} | دیتابیس اصلی: دستنخورده`);
  if (!r.healthy) process.exitCode = 1;
}

async function status() {
  const { db, chain } = await build();
  const s = await db.status();
  console.log('');
  console.log(`نوع: ${s.kind} | نسخه: ${s.version} | الگوریتم: ${s.algorithm} | کلید: ${s.keySource} | اثر: ${s.keyFingerprint}`);
  console.log(`تمامیت: ${s.integrity}`);
  console.log(`کاتالوگ: ${s.catalog.kind} | رکوردها: ${s.catalog.records} | زنجیر: ${s.catalog.chainOk ? 'سالم' : 'شکسته'} | فقطالحاقی: ${s.catalog.appendOnly}`);
  for (const st of s.stores) console.log(`  نسخه: ${st.name} | فایلها: ${st.files ?? st.texts ?? 0}`);
  console.log(`نسخه بهازای هر رکورد: ${s.replicasPerRecord} | کوئریپذیر: ${s.queryable} | محرمانگی: ${s.confidentiality}`);
  console.log(`دیتابیس اصلی: ${s.primary} | حذف: ${s.deleted} | لاگین/آپلود واقعی: خیر | ورسل/استقرار/مرج: خیر`);
  if (!chain.ok) console.log('⚠️ زنجیر کاتالوگ شکسته است؛ هیچ چیزی پاک نشد.');
}

function help() {
  console.log(`میمچت — «دیتابیس دومِ محکم»

  trial     نوشتن ۳ رکورد روی ۳ حامل + تأیید + خرابکردن + خودترمیمی + تأیید دوباره
  verify    سلامت زنجیرهٔ هش، تکثیرها و بستههای ChaCha20-Poly1305
  status    وضعیت صادقانه (بدون ادعای محرمانگی/کوئریپذیری)
  help      همین متن

همهٔ دادهها داخل strong-db/out/ و gitignoredاند. هیچ سرویس، حساب، کلید
جدید، لاگین، دیپلوی، مرج یا ورسلی در کار نیست. صفر حذف/ریست.`);
}

const cmd = process.argv[2] || 'help';
try {
  if (cmd === 'trial') await trial();
  else if (cmd === 'verify') await verify();
  else if (cmd === 'status') await status();
  else help();
} catch (err) {
  console.error(`❌ ${err?.message || err}`);
  console.error('هیچ ردیفی پاک نشد؛ دیتابیس اصلی Supabase دستنخورده است.');
  process.exitCode = 1;
}
