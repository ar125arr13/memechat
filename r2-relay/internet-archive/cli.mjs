#!/usr/bin/env node
/* خطفرمان مسیر «دیتابیس دوم → Internet Archive» — فقط همینجا، توسط عامل اجرا میشود.
 *
 *   node internet-archive/cli.mjs status
 *   node internet-archive/cli.mjs trial --fixture
 *   node internet-archive/cli.mjs trial --fixture --readable
 *   node internet-archive/cli.mjs words
 *   node internet-archive/cli.mjs help
 *
 * حالت --fixture کاملاً آفلاین است: بدون حساب، بدون کلید IAS3، بدون شبکه.
 * حالت واقعی فقط وقتی MC_IA_ACCESS_KEY / MC_IA_SECRET_KEY موقع اجرا وجود داشته
 * باشند فعال میشود؛ آنها هرگز داخل سورس نیستند.
 */

import { webcrypto } from 'node:crypto';
import { randomBytes as nodeRandomBytes } from 'node:crypto';
import {
  InternetArchiveDriver, publishForInternetArchive,
  verifyInternetArchiveDelivery, readInternetArchive, IA_DESTINATION,
} from './adapter.mjs';
import { FixtureIas3 } from './fixture.mjs';
import { Ias3Transport } from './ias3.mjs';
import { KEY_ALGORITHM, KEY_SOURCE, keyFingerprint } from './key.mjs';
import { sampleSubstitution, describeCodebook } from './codebook.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function transportFor(args) {
  if (args.includes('--fixture')) return new FixtureIas3();
  return Ias3Transport.fromEnv(process.env);
}

async function trial(args) {
  const readable = args.includes('--readable');
  const transport = transportFor(args);
  const driver = new InternetArchiveDriver({
    transport, chunkSize: 1024 * 1024, readable,
  });
  const plain = new Uint8Array(nodeRandomBytes(3 * 1024 * 1024));
  const manifest = await publishForInternetArchive({
    driver, plain, batchId: `mc-ia-trial-${Date.now().toString(36)}`,
  });
  const delivery = await verifyInternetArchiveDelivery({ driver, manifest });
  const back = await readInternetArchive({ driver, manifest });
  const same = Buffer.compare(Buffer.from(back), Buffer.from(plain)) === 0;

  console.log('');
  console.log(`مقصد: ${IA_DESTINATION} | آیتم: ${driver.item} | حالت: ${transport.describe().mode}`);
  console.log(`رمزگذاری: ${KEY_ALGORITHM} | کلید: ${KEY_SOURCE} | اثرانگشت: ${keyFingerprint()}`);
  console.log(`قابلخواندن (کدبوک واژگان): ${readable ? 'بله' : 'خیر'}`);
  console.log(`تکهها: ${manifest.chunks.length} | بستهها: ${delivery.receivedCount} | تأیید SHA: ${delivery.ok}`);
  console.log(`فایل برگشتی موبرهمو: ${same}`);
  if (readable) {
    const binary = manifest.chunks.reduce((n, c) => n + (c.binaryBytes || 0), 0);
    const stored = transport.files.size
      ? [...transport.files.values()].reduce((n, b) => n + b.length, 0)
      : 0;
    const factor = binary ? (stored / binary).toFixed(2) : '0';
    console.log(`حجم باینری: ${binary} بایت | حجم متن قابلخواندن: ${stored} بایت | ضریب: ${factor}×`);
    console.log(`نمونهٔ تبدیل: ${sampleSubstitution(3).map((x) => `${x.from} ← ${x.to}`).join('  |  ')}`);
    const first = [...transport.files.values()][0];
    if (first) console.log(`نمونهٔ فایل ذخیرهشده:\n${first.toString('utf8').slice(0, 180)}…`);
  }
  console.log(`حذف/ریست: ${manifest.deleted} | عملیات مخرب: ${manifest.destructiveOperations.length}`);
  console.log('نسخهٔ محلی (primary) دستنخورده ماند؛ هیچ ردیفی پاک نشد.');
  console.log('⚠️ مخزن عمومی است و آیتمهای IA هم عمومیاند: رمزگذاری محرمانگی نمیدهد، فقط تمامیت.');
  console.log('⚠️ کدبوک واژگان «قابلخواندن» میکند، «امن» نمیکند؛ جایگزین Poly1305 نشد.');
  if (!delivery.ok || !same) process.exitCode = 1;
}

async function status(args) {
  const t = transportFor(args);
  const d = t.describe();
  const cb = describeCodebook();
  console.log(`مقصد: ${IA_DESTINATION} | آیتم: ${d.item} | حالت: ${d.mode}`);
  console.log(`API: IAS3 رسمی (https://s3.us.archive.org) | ورسل: خیر | دیپلوی: خیر`);
  console.log(`رمزگذاری: ${KEY_ALGORITHM} (متفاوت از AES-256-GCM) | کلید: ${KEY_SOURCE} | اثرانگشت: ${keyFingerprint()}`);
  console.log(`کدبوک: ${cb.wordCount} واژهٔ فارسی | ${cb.magic} | محرمانگی: خیر | خواندنی: بله`);
  console.log(`تمامیت همچنان از: ${cb.integrityPreservedBy}`);
  console.log(`کلید حساب IA داخل سورس: خیر | کلید حساب فراهمشده: ${d.credentialsSupplied ? 'بله' : 'خیر'}`);
  console.log(`دیتابیس اصلی: Supabase، بدون تغییر | حذف ردیف: صفر | DELETE صدازدهشده: ${d.deleteCalled}`);
  console.log('⚠️ مخزن public است؛ کلید داخل سورس برای همه قابلدیدن است. محرمانگی ادعا نمیشود.');
}

function words() {
  const cb = describeCodebook();
  console.log(`کدبوک ${cb.wordCount} واژهٔ فارسی — نمونهٔ جایگشت (کلید داخل سورس):`);
  for (const x of sampleSubstitution(12)) {
    console.log(`  بایت ${String(x.byte).padStart(3)} : ${x.from}  →  ${x.to}`);
  }
  console.log(`اثرانگشت کلید: ${cb.keyFingerprint} | محرمانگی: خیر | تمامیت: ${cb.integrityPreservedBy}`);
}

function help() {
  console.log(`میمچت — دیتابیس دوم روی Internet Archive (IAS3)

  status                       وضعیت مسیر
  trial --fixture              تست آفلاین: بستهٔ باینری MCIA1
  trial --fixture --readable   تست آفلاین: همان بسته + تبدیل به واژههای فارسی
  words                        نمونهٔ جایگشت واژهها
  help                         همین متن

رمزگذاری: ChaCha20-Poly1305 (نه AES-256-GCM)، کلید ثابت داخل key.mjs،
بستهٔ باینری MCIA1، AAD شامل item/filename/batchId.
کدبوک: ۲۵۶ واژهٔ فارسی + جایگشت قطعی از همان کلید → خروجی قابلخواندن.
کدبوک جایگزین رمزگذاری نشد؛ روی آن نشست تا Poly1305/AAD/SHA پابرجا بماند.

صداقت: مخزن عمومی است و آیتمهای IA عمومیاند؛ رمزگذاری فقط تمامیت میدهد،
نه محرمانگی. کدبوک هم «خواندنی» میکند، نه «امن». حجم متن حدود ۱۰ برابر
باینری میشود. کلید حساب IAS3 داخل سورس نیست و بدون آن هیچ آپلود واقعی
انجام نمیشود. بدون ورسل و بدون دیپلوی. صفر حذف، صفر ریست.`);
}

const cmd = process.argv[2] || 'help';
const args = process.argv.slice(3);
if (cmd === 'trial') await trial(args);
else if (cmd === 'status') await status(args);
else if (cmd === 'words') words();
else help();
