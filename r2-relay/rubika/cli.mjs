#!/usr/bin/env node
/* MemeChat — ابزار خطفرمان «دیتابیس دوم» (پیشفرض: کوریر دستی روبیکا، بدون API).
 *
 * اجرا فقط تو یک ترمینال امن؛ هیچ رمزی تو چت/مرورگر/مخزن نمیرود.
 *   node cli.mjs export --fixture                    # تست آفلاین، بدون هیچ کلیدی
 *   node cli.mjs export --destination bale --fixture # برچسب مقصد بله (اختیاری)
 *   node cli.mjs export                              # خواندن فقطخواندنی از Supabase
 *   node cli.mjs verify --file packets.txt --manifest manifest.json
 *   node cli.mjs status
 *   node cli.mjs help
 *
 * مسیر اختیاری ارسال خودکار با API رسمی بله: ../bale/cli.mjs
 */

import { webcrypto } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');
const STATE = path.join(OUT, 'state.json');
const FIXTURE_KEY = 'fixture-test-key-not-a-real-secret';

import {
  prepareBatch, verifyBatch, readPrimary, fixtureTables, TABLES,
  DESTINATION, BALE_DESTINATION,
} from './adapter.mjs';

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function has(flag) { return process.argv.includes(flag); }
function key() {
  const k = (process.env.BACKUP_ENCRYPTION_KEY || '').trim();
  if (has('--fixture')) return k || FIXTURE_KEY;
  if (k.length < 16) {
    console.error('❌ BACKUP_ENCRYPTION_KEY تو محیط امن تنظیم نشده. هیچ کاری انجام نشد.');
    process.exit(2);
  }
  return k;
}
async function ensureOut() { await fs.mkdir(OUT, { recursive: true }); }

async function latest(pattern) {
  const files = (await fs.readdir(OUT)).filter((f) => {
    if (pattern.startsWith('packets-')) return f.startsWith('packets-') && f.endsWith('.txt');
    return f.startsWith('manifest-') && f.endsWith('.json');
  }).sort();
  return files.length ? path.join(OUT, files[files.length - 1]) : null;
}

async function appendState(entry) {
  let state = { v: 2, kind: 'memechat-second-db-rubika-state', batches: [], deleted: false, destructiveOperations: [] };
  try { state = JSON.parse(await fs.readFile(STATE, 'utf8')); } catch { /* first run */ }
  state.batches.push(entry);
  state.deleted = false;
  state.destructiveOperations = [];
  state.updatedAt = new Date().toISOString();
  await fs.writeFile(STATE, JSON.stringify(state, null, 2) + '\n', 'utf8');
}

async function doExport() {
  await ensureOut();
  const fixture = has('--fixture');
  let tables;
  if (fixture) {
    tables = fixtureTables();
    console.log('🧪 حالت تست: ردیفهای ساختگی، بدون اتصال به هیچ سرویسی.');
  } else {
    const base = (process.env.SUPABASE_URL || '').trim();
    const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
    if (!base || !serviceKey) {
      console.error('❌ SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY تو محیط امن تنظیم نشده. هیچ کاری انجام نشد.');
      process.exit(2);
    }
    tables = await readPrimary({ base, serviceKey });
    console.log('📖 فقط خوانده شد از دیتابیس اصلی؛ هیچ نوشتن/حذفی انجام نشد.');
  }
  const destArg = arg('--destination');
  const destination = destArg === 'bale' ? BALE_DESTINATION : (destArg || DESTINATION);
  if (![DESTINATION, BALE_DESTINATION].includes(destination)) {
    console.error('❌ مقصد نامعتبر. فقط پیشفرض (کوریر دستی) یا bale مجاز است.');
    process.exit(2);
  }
  const { manifest, packets } = await prepareBatch({ tables, rawKey: key(), destination });
  const packetsFile = path.join(OUT, `packets-${manifest.batchId}.txt`);
  const manifestFile = path.join(OUT, `manifest-${manifest.batchId}.json`);
  await fs.writeFile(packetsFile, packets.join('\n') + '\n', 'utf8');
  await fs.writeFile(manifestFile, JSON.stringify(manifest, null, 2) + '\n', 'utf8');
  await appendState({
    batchId: manifest.batchId,
    createdAt: manifest.createdAt,
    packetCount: manifest.packetCount,
    rowCounts: manifest.rowCounts,
    envelopeSha256: manifest.envelopeSha256,
    destination: manifest.destination,
    officialApiUsed: manifest.officialApiUsed,
    vercelUsed: false,
    deleted: false,
  });
  console.log(`✅ بچ ${manifest.batchId} آماده شد`);
  console.log(`   بستهها: ${packetsFile}`);
  console.log(`   منیفست: ${manifestFile}`);
  console.log(`   ${manifest.packetCount} بستهٔ MCPK1 | مقصد: ${manifest.destination}`);
  console.log('');
  if (manifest.destination === BALE_DESTINATION) {
    console.log('برای ارسال خودکار: node ../bale/cli.mjs send-packets --file <همینفایل> --manifest <همینمنیفست>');
    console.log('توکن/چتآیدی فقط تو محیط امن سرور؛ هیچ رازی تو چت/کد/فرانتاند نیست.');
  } else {
    console.log('الان خطها رو کپی کن توی «پیامهای ذخیرهشدهٔ» روبیکای خودت.');
    console.log('هیچ API، ربات، توکن، ورسل یا GitHubی در کار نیست؛ روبیکا فقط متن رمزشده میبیند.');
  }
  console.log('دیتابیس اصلی دستنخورده ماند؛ صفر حذف.');
}

async function doVerify() {
  await ensureOut();
  const file = arg('--file') || await latest('packets-');
  const manifestFile = arg('--manifest') || await latest('manifest-');
  if (!file || !manifestFile) {
    console.error('❌ فایل بستهها یا منیفست پیدا نشد. اول export کن، یا --file/--manifest بده.');
    process.exit(2);
  }
  const packets = (await fs.readFile(file, 'utf8')).split('\n').map((s) => s.trim()).filter(Boolean);
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  let report;
  try {
    report = await verifyBatch({ manifest, packets, rawKey: key() });
  } catch (e) {
    console.error(`❌ تأیید نشد: ${e.message}`);
    console.error('   هیچ ردیفی از دیتابیس اصلی پاک یا تغییر نکرد (retainedInPrimary).');
    process.exit(1);
  }
  const reportFile = path.join(OUT, `verification-${manifest.batchId}.json`);
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`✅ تأیید شد: ${report.envelopeSha256.slice(0, 16)}…`);
  console.log(`   ${report.packetCount} بسته، ${Object.values(report.rowCounts).reduce((a, b) => a + b, 0)} ردیف، صفر حذف`);
  console.log(`   گزارش: ${reportFile}`);
  console.log('   دیتابیس اصلی همچنان دستنخورده است.');
}

async function doStatus() {
  let state;
  try { state = JSON.parse(await fs.readFile(STATE, 'utf8')); }
  catch { console.log('هنوز بچهای ساخته نشده. اول: node cli.mjs export --fixture'); return; }
  console.log(`دیتابیس دوم: کوریر دستی روبیکا (پیشفرض) + مسیر اختیاری API رسمی بله | ورسل: خیر`);
  console.log(`تعداد بچها: ${state.batches.length} | حذف: ${state.deleted} | عملیات مخرب: ${state.destructiveOperations.length}`);
  for (const b of state.batches) {
    console.log(`  • ${b.batchId} | ${b.packetCount} بسته | ${b.envelopeSha256.slice(0, 12)}… | ${b.createdAt}`);
  }
}

function help() {
  console.log(`میمچت — دیتابیس دوم روی روبیکا، بدون API رسمی و بدون ورسل

دستورها:
  export --fixture                     بچ تستی آفلاین (هیچ کلید/سرویسی لازم نیست)
  export --destination bale --fixture  همان بچها، ولی برچسب مقصد «بله» میخورد
  export                               خواندن فقطخواندنی از Supabase اصلی + ساخت بستهها
  verify --file F --manifest M         برگرداندن بستهها + تأیید SHA-256
  verify                               آخرین packets-*.txt / manifest-*.json را میگیرد
  status                               منیفست الحاقی محلی را نشان میدهد
  help                                 همین متن

متغیرهای محیط (فقط ترمینال امن، نه مرورگر/چت/مخزن):
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, BACKUP_ENCRYPTION_KEY

ارسال اختیاری با API رسمی بله (بدون ورسل):
  node ../bale/cli.mjs send-packets --file F --manifest M
  متغیرها: BALE_BOT_TOKEN, BALE_CHAT_ID  (فقط محیط امن سرور)

قوانین ثابت: فقط SELECT؛ صفر PATCH/DELETE/RESET؛ بدون ورسل/GitHub API؛
هیچ کلیدی تو فرانتاند؛ نام جدولها و فیلدها دستنخورده.`);
}

const cmd = process.argv[2] || 'help';
if (cmd === 'export') await doExport();
else if (cmd === 'verify') await doVerify();
else if (cmd === 'status') await doStatus();
else help();
