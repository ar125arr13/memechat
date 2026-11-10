#!/usr/bin/env node
/* خطفرمان «تست محدودزمانی دیتابیس اصلی روی بله».
 *
 *   node primary/cli.mjs trial --fixture                 # آفلاین، بدون هیچ راز واقعی
 *   node primary/cli.mjs trial --fixture --duration-ms 5000
 *   node primary/cli.mjs trial                           # واقعی؛ فقط توکن/چتآیدی از محیط امن
 *   node primary/cli.mjs status
 *   node primary/cli.mjs help
 *
 * بدون --fixture، BALE_BOT_TOKEN و BALE_CHAT_ID فقط از process.env خوانده
 * میشوند. هیچ رازی تو چت/سورس/لاگ/فرانتاند نیست. بدون آنها هیچ تماسی برقرار
 * نمیشود و خروجی صادقانه میگوید «انجام نشد».
 */

import { webcrypto } from 'node:crypto';
import { PrimaryDbRouter } from './router.mjs';
import { BalePrimaryTrial, DEFAULT_TRIAL_MS } from './trial.mjs';
import {
  FIXTURE_ENV, FIXTURE_TOKEN, FIXTURE_CHAT_ID, mockEchoFetch,
} from '../bale/mock.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function has(flag) { return process.argv.includes(flag); }

function fakeSupabase() {
  return {
    name: 'supabase-primary-temporary',
    async read(table, opts = {}) { return { table, rows: [], method: opts.method || 'GET' }; },
    async write(_t, _p, opts = {}) { return { allowWrites: opts.allowWrites === true }; },
  };
}

function makeRouter() { return new PrimaryDbRouter({ supabase: fakeSupabase() }); }

async function doTrial() {
  const fixture = has('--fixture');
  const durationMs = Number(arg('--duration-ms')) || (fixture ? 3000 : DEFAULT_TRIAL_MS);
  let token, chatId, fetchImpl, env;
  if (fixture) {
    token = FIXTURE_TOKEN;
    chatId = FIXTURE_CHAT_ID;
    fetchImpl = mockEchoFetch();
    env = FIXTURE_ENV;
    console.log('🧪 حالت تست: شبیهساز آفلاین بله، بدون هیچ توکن/شبکهٔ واقعی.');
  } else {
    token = String(process.env.BALE_BOT_TOKEN || '').trim();
    chatId = String(process.env.BALE_CHAT_ID || '').trim();
    fetchImpl = globalThis.fetch;
    env = process.env;
  }

  const router = makeRouter();
  const trial = new BalePrimaryTrial({
    router, token, chatId, fetchImpl, env, durationMs,
    onEvent: (e) => console.log(`   · ${e.type}${e.reason ? ` (${e.reason})` : ''}`),
  });
  const report = await trial.run();

  if (report.blocked) {
    console.log(`⛔ ${report.blocked}: ${report.message}`);
    console.log('   سوپا همچنان فعال است؛ هیچ تماسی به بله زده نشد و چیزی پاک نشد.');
    process.exitCode = 2;
    return;
  }

  console.log('');
  console.log(`بله حین تست: ${report.activeDuringTrial} | بعد از تست: ${report.activeAfter} (موقت: ${report.temporaryAfter})`);
  console.log(`مدت: ${report.elapsedMs}ms | سقف: ${report.durationMs}ms | برگشت خودکار: ${report.autoRepairReason}`);
  const rt = report.roundTrip;
  if (rt) {
    console.log(`فایل رمزشده: ${rt.encryption} | ${rt.receivedCount}/${rt.packetCount} بسته برگشت | SHA تأیید: ${rt.verified}`);
  }
  console.log(`نتیجه: ${report.ok ? '✅ کار کرد (تو همان پنجرهٔ کوتاه)' : '❌ کار نکرد'}`);
  if (report.error) console.log(`   خطا: ${report.error}`);
  console.log(`حذف/ریست: ${report.dataDeleted} | عملیات مخرب: ${report.destructiveOperations.length} | برگشتپذیر: ${report.reversible}`);
  console.log('سوپا دوباره فعال است؛ لاگین/چت/تاریخچه دستنخورده.');
  if (!report.ok) process.exitCode = 1;
}

function doStatus() {
  const router = makeRouter();
  const s = router.status();
  console.log(`اصلی تعیینشده: ${s.designatedPrimary}`);
  console.log(`اصلی فعال: ${s.activePrimary} | موقت: ${s.temporary} | دلیل: ${s.temporaryReason}`);
  console.log(`قابلیت بله بهعنوان دیتابیس: ${s.capabilityReport.canBePrimary}`);
  console.log(`روبیکا: ${s.legacySecondDb.kind} | کار میکند: ${s.legacySecondDb.works} | حذف شده: ${s.legacySecondDb.deleted}`);
  console.log(`حذف داده: ${s.dataDeleted} | استقرار: ${s.deployed} | ادغام: ${s.merged}`);
}

function help() {
  console.log(`میمچت — تست محدودزمانی «بله بهعنوان دیتابیس اصلی»

دستورها:
  trial --fixture                     تست آفلاین کامل (ارسال + برگشت + تأیید SHA)
  trial --fixture --duration-ms 5000  همان، با پنجرهٔ ۵ ثانیه
  trial                               تست واقعی؛ BALE_BOT_TOKEN/BALE_CHAT_ID از محیط امن سرور
  status                              وضعیت لایهٔ دیتابیس اصلی
  help                                همین متن

رفتار ثابت: بله فقط چند ثانیه فعال میشود، بعد حتی در خطا/تایماوت خودکار به
سوپا برمیگردد. صفر DELETE/RESET؛ بدون ورسل؛ بدون راز تو سورس/فرانتاند/لاگ؛
هیچ استقرار یا تغییر زندهای انجام نشد.

محدودیت صادقانه: بله پیامرسان است نه دیتابیس (کوئری/تراکنش/ذخیرهٔ پایدار
ندارد). این دستور فقط «آیا ارسال و برگشت فایل رمزشده کار میکند» را میسنجد،
نه اینکه جای Supabase را گرفته باشد.`);
}

const cmd = process.argv[2] || 'help';
if (cmd === 'trial') await doTrial();
else if (cmd === 'status') await doStatus();
else help();
