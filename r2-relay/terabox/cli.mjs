#!/usr/bin/env node
/* خطفرمان بررسی Open Platform رسمی TeraBox — فقط توسط عامل اجرا میشود.
 *
 *   node terabox/cli.mjs status
 *   node terabox/cli.mjs trial --fixture
 *   node terabox/cli.mjs accounts --fixture
 *   node terabox/cli.mjs help
 *
 * حالت --fixture کاملاً آفلاین است: بدون لاگین، بدون کلید اپ واقعی، بدون شبکه.
 * حالت بدون --fixture فقط وضعیت کلیدهای محیط runtime را گزارش میکند و
 * بدون آنها هیچ تماس شبکهای نمیزند.
 */

import { createHash, randomBytes } from 'node:crypto';
import { TeraboxTransport, FixtureTerabox } from './transport.mjs';
import { TeraboxAccounts, MAX_ACCOUNTS } from './accounts.mjs';
import {
  describeOpenPlatform, parseErrno, redact, APP_ROOT_PREFIX,
  ACCESS_TOKEN_TTL_SECONDS, DOCS_URL, TOS_URL,
} from './openplatform.mjs';

const sha = (b) => createHash('sha256').update(b).digest('hex');
const appRoot = `${APP_ROOT_PREFIX}MemeChat-/`;

function transportFor(args) {
  return args.includes('--fixture') ? new FixtureTerabox() : TeraboxTransport.fromEnv(process.env);
}

async function status(args) {
  const t = transportFor(args);
  const d = t.describe();
  const o = describeOpenPlatform();
  console.log(`مقصد: TeraBox Open Platform (رسمی، ولی partner-only)`);
  console.log(`سند رسمی: ${DOCS_URL}`);
  console.log(`حالت: ${d.mode} | کلید اپ فراهمشده: ${d.credentialsSupplied ? 'بله' : 'خیر'} | تماس شبکهای: ${d.networkCalls}`);
  console.log(`self-service: خیر | کلید اپ داخل سورس: خیر | لاگین واقعی: خیر | آپلود واقعی: خیر`);
  console.log(`هر حساب: ۱ جفت access_token + refresh_token | طول توکن دسترسی: ${(ACCESS_TOKEN_TTL_SECONDS / 86400).toLocaleString('fa-IR')} روز | refresh: ۳۰ روز، یکبارمصرف`);
  console.log(`حداکثر حساب جداگانه: ${MAX_ACCOUNTS.toLocaleString('fa-IR')} | جمع کردن سهمیه: ${o.quotaPooling ? 'بله' : 'خیر'}`);
  console.log(`مراحل آپلود: ${o.uploadSteps.join(' → ')}`);
  console.log(`حذف/ریست: خیر | DELETE صدازدهشده: ${d.deleteCalled} | عملیات مخرب: ${d.destructiveOperations.length}`);
  console.log(`دیتابیس اصلی: Supabase، بدون تغییر | ورسل: خیر | استقرار/مرج: خیر`);
  console.log(`⚠️ لاگین با دو اکانت «API کی» نمیدهد؛ API کی مال اپ تأییدشدهای است که TeraBox صادر میکند.`);
  console.log(`⚠️ شرایط استفاده (${TOS_URL}) صریحاً «circumvent storage space limits» و دسترسی از رابط غیرعمومی را ممنوع کرده است.`);
}

async function authorizeFixtureAccount(t, registry, { label, code }) {
  const device = await t.deviceCode({ clientId: 'FIXTURE_CLIENT_ID' });
  if (parseErrno(device).errno !== 0) throw new Error('FIXTURE_DEVICE_CODE_FAILED');
  const token = await t.getToken({ code, grantType: 'device_code', timestamp: 1705570481 });
  const tp = parseErrno(token);
  if (!tp.ok) throw new Error('FIXTURE_GETTOKEN_FAILED');
  const info = await t.tokenInfo({ accessToken: tp.data.access_token });
  const ip = parseErrno(info);
  if (!ip.ok) throw new Error('FIXTURE_TOKENINFO_FAILED');
  const view = registry.register({
    label,
    accessToken: tp.data.access_token,
    refreshToken: tp.data.refresh_token,
    expiresIn: tp.data.expires_in,
    apiDomain: ip.data.api_domain,
    uploadDomain: ip.data.upload_domain,
    userId: ip.data.user_id,
    createdAt: Date.now(),
  });
  const quota = await t.quota({ accessToken: tp.data.access_token, apiDomain: ip.data.api_domain });
  return { view, quota: parseErrno(quota) };
}

async function trial(args) {
  const t = transportFor(args);
  if (!args.includes('--fixture')) {
    console.log('بدون کلید اپ تأییدشده، اجرای واقعی ممکن نیست: TERABOX_NO_APP_CREDENTIALS');
    console.log('هیچ تماس شبکهای، لاگین یا آپلودی انجام نشد. وضعیت:');
    await status([]);
    return;
  }

  // ۱) همان پاسخ واقعی سرور با client_id نامعتبر (GET خواندنی، بدون رمز)
  const invalid = parseErrno(await t.deviceCode({ clientId: 'ARENA_INVALID_TEST_ONLY' }));
  console.log(`تأیید زندهٔ endpoint (بدون حساب): errno=${invalid.errno} | ${invalid.show_msg}`);

  // ۲) دو حساب کاملاً جدا
  const registry = new TeraboxAccounts({ maxAccounts: MAX_ACCOUNTS, appRoot });
  const a = await authorizeFixtureAccount(t, registry, { label: 'account-a', code: 'fixture-device-acct-a' });
  const b = await authorizeFixtureAccount(t, registry, { label: 'account-b', code: 'fixture-device-acct-b' });
  registry.assertIsolated();

  // ۳) آپلود سهمرحلهای روی حساب اول، بدون حذف/بازنویسی
  const plain = Buffer.from(randomBytes(128 * 1024));
  const blockList = [createHash('md5').update(plain).digest('hex')];
  const path = `${appRoot}000001.mcb1`;
  const tokenA = registry.tokenFor('account-a');
  const apiA = a.view.apiDomain;
  const uploadA = a.view.uploadDomain;
  const pre = parseErrno(await t.precreate({ accessToken: tokenA, apiDomain: apiA, path, blockList }));
  if (!pre.ok) throw new Error('FIXTURE_PRECREATE_FAILED');
  const shard = await t.uploadShard({ accessToken: tokenA, uploadDomain: uploadA, path,
    uploadid: pre.data?.uploadid || pre.raw.uploadid, partseq: 0, bytes: plain });
  const created = parseErrno(await t.createFile({ accessToken: tokenA, apiDomain: apiA, path,
    size: plain.length, uploadid: pre.raw.uploadid, blockList, rtype: 1 }));
  if (!created.ok) throw new Error('FIXTURE_CREATE_FAILED');
  const back = t.readFile(created.raw.fs_id);
  const same = back && Buffer.compare(back, plain) === 0 && sha(back) === sha(plain);

  // ۴) refresh یکبارمصرف
  const before = registry.get('account-a').refreshToken;
  const refreshed = parseErrno(await t.refreshToken({ refreshToken: before, timestamp: 1705570482 }));
  const rotated = refreshed.ok ? registry.applyRefresh('account-a', {
    usedRefreshToken: before,
    accessToken: refreshed.data.access_token,
    refreshToken: refreshed.data.refresh_token,
    expiresIn: refreshed.data.expires_in,
  }) : null;

  const d = t.describe();
  console.log('');
  console.log(`حسابها: ${registry.describe().registered} | جدا از هم: ${registry.describe().isolated} | جمع سهمیه: خیر`);
  console.log(`  A: user=${a.view.userId} | api=${a.view.apiDomain} | upload=${a.view.uploadDomain} | اثرتوکن=${a.view.accessTokenFingerprint}`);
  console.log(`  B: user=${b.view.userId} | api=${b.view.apiDomain} | upload=${b.view.uploadDomain} | اثرتوکن=${b.view.accessTokenFingerprint}`);
  console.log(`سهمیهٔ نمونه (fixture): ${(a.quota.raw.total / 1024 ** 3).toFixed(0)} گیگ | استفاده: ${(a.quota.raw.used / 1024 ** 3).toFixed(0)} گیگ`);
  console.log(`آپلود: precreate → superfile2 (${shard.md5.slice(0, 12)}…) → create | fs_id=${created.raw.fs_id}`);
  console.log(`فایل برگشتی موبرهمو + SHA: ${same}`);
  console.log(`refresh یکبارمصرف: ${Boolean(rotated)} | توکن قدیمی تا ${rotated ? '۱۵' : '۰'} ثانیه معتبر میماند`);
  console.log(`حذف/ریست: خیر | DELETE صدازدهشده: ${d.deleteCalled} | عملیات مخرب: ${d.destructiveOperations.length} | تماس شبکهای: ${d.networkCalls}`);
  console.log(`نمونهٔ URL پوشاندهشده: ${redact(`https://www.terabox.com/openapi/api/quota?access_tokens=${tokenA}&client_secret=SECRET`)}`);
  console.log('⚠️ اینها همه fixtureاند؛ هیچ لاگین، توکن واقعی یا آپلود واقعی انجام نشد.');
  console.log('⚠️ Supabase، لاگین، چت و فایلهای IA دستنخوردهاند؛ مقصد دوم عوض نشد.');
  if (!same || !rotated || invalid.errno !== 100001) process.exitCode = 1;
}

async function accounts(args) {
  const t = transportFor(args);
  if (!args.includes('--fixture')) { await status([]); return; }
  const registry = new TeraboxAccounts({ maxAccounts: MAX_ACCOUNTS, appRoot });
  await authorizeFixtureAccount(t, registry, { label: 'account-a', code: 'fixture-device-acct-a' });
  await authorizeFixtureAccount(t, registry, { label: 'account-b', code: 'fixture-device-acct-b' });
  const d = registry.describe();
  console.log(`تعداد حسابها: ${d.registered}/${d.maxAccounts} | جدا: ${d.isolated} | جمع سهمیه: ${d.quotaPooling ? 'بله' : 'خیر'}`);
  for (const a of d.accounts) {
    console.log(`  ${a.label}: user=${a.userId} | api=${a.apiDomain} | upload=${a.uploadDomain} | اثرتوکن=${a.accessTokenFingerprint} | نیاز به refresh: ${a.needsRefresh}`);
  }
  console.log(`کلیدها داخل سورس: خیر | لاگین واقعی: خیر | refresh یکبارمصرف: بله`);
}

function help() {
  console.log('دستورها (برای اجرای عامل، نه کاربر):');
  console.log('  status           وضعیت کلیدهای runtime و محدودیتهای رسمی');
  console.log('  trial --fixture  شبیهسازی آفلاین دو حساب + آپلود سهمرحلهای');
  console.log('  accounts --fixture  نمایش redactشدهٔ دو حساب مستقل');
  console.log(`سند کامل: docs/TERABOX-OPEN-PLATFORM.md | API: ${DOCS_URL}`);
}

const [cmd, ...args] = process.argv.slice(2);
switch (cmd) {
  case 'status': await status(args); break;
  case 'trial': await trial(args); break;
  case 'accounts': await accounts(args); break;
  default: help();
}
