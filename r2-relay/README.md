# دیتابیس دوم MemeChat → روبیکا (کوریر دستی)

**وضعیت: کد کامل + تست سبز روی شاخهٔ جلسه. هیچ استقراری انجام نشد.**
دیتابیس اصلی Supabase، سایت Pages، لینک، لاگین، چت، گروه، کانال، تماس،
CSP و `MC_API` **دستنخورده** ماندهاند. هیچ ردیفی پاک یا ریست نشده است.

> **دستور تازه:** صاحب پروژه گفت «از ورسل استفاده نکن». ورسل کاملاً از این
> معماری حذف شد؛ فقط یکبار متادیتای فقطخواندنیاش خوانده شد، هیچ تغییری روی آن
> اعمال نشد و بعد از این دستور دیگر حتی همان هم تکرار نشد.
>
> **تغییر تصمیم قدیمی:** قبلاً «روبیکا و گپ ساخته نمیشوند» ثبت شده بود. درخواست
> تازه («دیتابیس دوم بره روی روبیکا») آن را عوض کرد. برای **همین مسیر پیشفرض**
> هیچ حساب، ربات، توکن، OTP یا API رسمی ساخته/فرض نشده؛ فقط «حساب شخصی خودتان
> در روبیکا» بهعنوان محل نگهداری بستههای رمزشده در نظر گرفته شده است.
>
> **مسیر اختیاری تازه، بدون حذف قدیمی:** بنا به درخواست بعدی («یه پیامرسان با
> API راحت پیدا کن» / «API ارسال پیام مستقیمش رو بگیر»)، کانکتور **API رسمی
> بله** هم اضافه شد: `docs/MESSENGER-API-BALE.md` و `bale/`. پیشفرض همچنان
> کوریر دستی روبیکا و بدون توکن است؛ `bale` فقط یک مقصد/حامل اختیاری است.
> هیچ توکن واقعی ساخته/دیده/ذخیره نشد و هیچ استقراری انجام نشد.

---

## سه حرف راست قبل از بقیه

1. **روبیکا بدون API رسمی «دیتابیس» نمیشود.** کوئری، تراکنش، ایندکس،
   نوشتن خودکار از سرور و تأیید خودکار تحویل ممکن نیست. وانمود نکردیم.
   مهندسی معکوس پروتکل خصوصی / نگهداری نشست کاربر هم شکننده و نقض ToS است؛
   انجامش ندادیم و کد جعلی/API فرضی ننوشتیم.
2. **تنها راه واقعاً قابل اجرا بدون API رسمی: کوریر دستی.** سرور بچها را
   AES-256-GCM میکند، به بستههای متنی `MCPK1` تبدیل میکند؛ شما خطها را کپی
   میکنید توی «پیامهای ذخیرهشده» / کانال خصوصی خودتان در روبیکا. برگشت هم
   با کپی کردن همان خطها + تأیید SHA-256 موبهمو است. روبیکا فقط ciphertext
   میبیند.
3. **«سایتهای استوریجی سرور نمیشوند.»** R2 / Drive / GitHub / روبیکا فقط
   بایت نگه میدارند. محاسبه اینجا تو ترمینال امن (و قبلاً تو Worker نمونه)
   انجام میشود؛ کلید رمزگشایی هیچوقت به روبیکا/مرورگر نمیرسد.

## دیتابیس دوم الان کجا بود؟

| قبل | بعد |
|---|---|
| مخزن خصوصی GitHub `zahradavoodi69-code/memechat-data`، شاخهٔ `mimchat-data`، مسیر `backups/encrypted/...` | روبیکا (کوریر دستی) + منیفست الحاقی محلی |
| نویسنده `lib/core.js::writeEncryptedBatchToGitHub` | `rubika/adapter.mjs` / `drop-in/lib/rubika-secondary.js` |
| فراخوان `api/sync.js` روی ورسل | ابزار خطفرمان `rubika/cli.mjs`، **بدون ورسل** |
| `PATCH` به `sync_status` / `github_commit_sha` + `DELETE` outbox و TTL | **صفر PATCH / DELETE / RESET** |
| مخزن قدیمی GitHub | **دستنخورده و فقطخواندنی**؛ چیزی از آن پاک نشد |

دو پروژهٔ Supabase غیرفعال (`joadley…` / `gddb…`) هیچ کدی به آنها وصل نیست و
دیتابیس دوم محسوب نمیشوند. جزئیات کامل بررسی تو `../docs/SECOND-DB-RUBIKA.md`.

## نامهایی که عمداً حفظ شدند

`mimchat_staging_outbox` و `mimchat_staging_messages`، با همان فیلدها
(از جمله `github_commit_sha`, `sync_status`, `status`, `payload`, `created_at`).
ابزار جدید فقط `SELECT` میزند؛ مقادیر قدیمی همانجوریکه هستند میمانند.

## چی نوشته شد (همه کامل، نه تکهکد)

| فایل | کار |
|---|---|
| `rubika/adapter.mjs` | رمزنگاری، بستههای `MCPK1`، خواندن فقطخواندنی Supabase، منیفست، تأیید بدون حذف |
| `rubika/cli.mjs` | `export` / `verify` / `status` / `help`؛ `export --fixture` بدون هیچ کلیدی |
| `rubika/tests/run.mjs` | ۸ تست: رمز، بستهٔ گمشده/دستکاریشده، صفر حذف، نبود API/ورسل/secret، مقصد اختیاری bale |
| `rubika/drop-in/lib/rubika-secondary.js` | نسخهٔ کامل CommonJS برای بکاند خصوصی |
| `rubika/drop-in/api/sync.js` | **نسخهٔ کامل بهروزشدهٔ `api/sync.js`**: بیGitHub، بیDELETE، بیورسل |
| `rubika/drop-in/README.md` | اینکه سورس خصوصی منتشر نشده و استقرار موکول به اجازه است |
| `bale/api.mjs`, `bale/cli.mjs`, `bale/mock.mjs`, `bale/tests/run.mjs` | کانکتور اختیاری API رسمی بله برای ارسال پیام مستقیم (۱۳ تست آفلاین) |
| `client/courier.js` | کوریر دستی حالا مسیر **فعال** است، نه پارکشده |
| `client/storage-adapter.js` | `RubikaCourierDriver` + `verifyRubikaDelivery` بدون هیچ حذف |
| `tests/run.mjs` | ۱۳ تست (۹ قدیمی + ۴ جدید «عدم حذف») |

درایورهای قدیمی `R2Driver` / `HttpStorageDriver` / `MemoryDriver` و
`verifyAndCommit` همچنان برای تست باقیاند؛ مسیر روبیکا از `verifyRubikaDelivery`
استفاده میکند که **مرحلهٔ حذف را اصلاً ندارد**.

## اجرا

```bash
cd /home/user/memechat/r2-relay
npm run test:all                 # 13 + 8 + 13 تست سبز

# تست کاملاً آفلاین، بدون رمز و بدون سرویس
npm run rubika:export:fixture
node rubika/cli.mjs verify --fixture
node rubika/cli.mjs status

# اجرای واقعی، فقط تو ترمینال امن (هیچ رمزی تو چت/مرورگر/مخزن)
export SUPABASE_URL='https://teylquevemmkrgswnwtx.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='...'
export BACKUP_ENCRYPTION_KEY='...'
node rubika/cli.mjs export
```

خروجی `rubika/out/packets-*.txt` را خطبهخط کپی کنید توی روبیکای خودتان.
برگرداندن:

```bash
node rubika/cli.mjs verify --file برگشتی.txt --manifest rubika/out/manifest-*.json
```

اگه یک بسته کم باشد: `retainedInPrimary: true`، **هیچ چیزی پاک نمیشود**.

### مسیر اختیاری بله (API رسمی، بدون ورسل)

```bash
npm run test:bale
npm run bale:status
npm run rubika:export:bale:fixture
node bale/cli.mjs send-packets \
  --file rubika/out/packets-<batchId>.txt \
  --manifest rubika/out/manifest-<batchId>.json --fixture
```

جزئیات و API دقیق: `../docs/MESSENGER-API-BALE.md` و `bale/README.md`.
بدون `--fixture` فقط `BALE_BOT_TOKEN` / `BALE_CHAT_ID` تو محیط امن سرور خوانده
میشوند؛ هیچ توکن واقعی تو این مخزن نیست.

## چی انجام نشد (و نباید ادعا شود)

- هیچ استقرار، دیپلوی، مرج، تغییر `main`، تغییر Edge / `dist.cjs` / `index.html`.
- هیچ نوشتن به GitHub، هیچ پاک کردن مخزن قدیمی، هیچ `DELETE` تو دیتابیس اصلی.
- هیچ ورسل، API رسمی روبیکا، ربات/توکن **ساختهشده یا دیدهشده**، scraping،
  endpoint خصوصی. (کانکتور اختیاری بله فقط کد است؛ توکن واقعی نساختیم.)
- هیچ کلیدی تو فرانتاند، تو لاگ، تو چت یا تو مخزن عمومی.
- هیچ ادعای «روبیکا شد دیتابیس کوئریپذیر»؛ نشد و بدون API رسمی نمیشود.

سند تصمیم، محدودیتها و فهرست کامل فایلها: `../docs/SECOND-DB-RUBIKA.md`.
