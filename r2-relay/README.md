# دیتابیس دوم MemeChat → روبیکا (کوریر دستی)

**وضعیت: کد کامل + تست سبز روی شاخهٔ جلسه. هیچ استقراری انجام نشد.**
دیتابیس اصلی Supabase، سایت Pages، لینک، لاگین، چت، گروه، کانال، تماس،
CSP و `MC_API` **دستنخورده** ماندهاند. هیچ ردیفی پاک یا ریست نشده است.

> **تازهترین تغییر:** صاحب پروژه گفت «فایلای بله رو پاک کن / بریم یه
> پیامرسان دیگه / مثلا با maxrubika و سیو مسیج روبیکا اوکیش کن».
> تمام فایلهای بله (`bale/`، `client/bale-direct.js`، `primary/` و دو سندش)
> **حذف شدند** و مسیر تازه ساخته شد:
> [`maxrubika/`](maxrubika/README.md) + سند
> [`../docs/SECOND-DB-MAXRUBIKA.md`](../docs/SECOND-DB-MAXRUBIKA.md).
> فایلهای رمزشده → `MCPK1` → `MCR1` → **پیامهای ذخیرهشدهٔ روبیکا** →
> برگشت و تأیید SHA-256. بدون توکن بات، بدون API رسمی روبیکا، بدون ورسل،
> صفر حذف. `grep -rni bale` روی مخزن صفر نتیجه داد.

> **دستور تازه:** صاحب پروژه گفت «از ورسل استفاده نکن». ورسل کاملاً از این
> معماری حذف شد؛ فقط یکبار متادیتای فقطخواندنیاش خوانده شد، هیچ تغییری روی آن
> اعمال نشد و بعد از این دستور دیگر حتی همان هم تکرار نشد.
>
> **تغییر تصمیم قدیمی:** قبلاً «روبیکا و گپ ساخته نمیشوند» ثبت شده بود. درخواست
> تازه («دیتابیس دوم بره روی روبیکا») آن را عوض کرد. اینجا **هیچ حساب، ربات،
> توکن، OTP یا API رسمی** ساخته/فرض نشده؛ فقط «حساب شخصی خودتان در روبیکا»
> بهعنوان محل نگهداری بستههای رمزشده در نظر گرفته شده است.

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
| `rubika/tests/run.mjs` | ۷ تست: رمز، بستهٔ گمشده/دستکاریشده، صفر حذف، نبود API/ورسل/secret |
| `rubika/drop-in/lib/rubika-secondary.js` | نسخهٔ کامل CommonJS برای بکاند خصوصی |
| `rubika/drop-in/api/sync.js` | **نسخهٔ کامل بهروزشدهٔ `api/sync.js`**: بیGitHub، بیDELETE، بیورسل |
| `rubika/drop-in/README.md` | اینکه سورس خصوصی منتشر نشده و استقرار موکول به اجازه است |
| `client/courier.js` | کوریر دستی حالا مسیر **فعال** است، نه پارکشده |
| `client/storage-adapter.js` | `RubikaCourierDriver` + `verifyRubikaDelivery` بدون هیچ حذف |
| `tests/run.mjs` | ۱۳ تست (۹ قدیمی + ۴ جدید «عدم حذف») |

درایورهای قدیمی `R2Driver` / `HttpStorageDriver` / `MemoryDriver` و
`verifyAndCommit` همچنان برای تست باقیاند؛ مسیر روبیکا از `verifyRubikaDelivery`
استفاده میکند که **مرحلهٔ حذف را اصلاً ندارد**.

## اجرا

```bash
cd /home/user/memechat/r2-relay
npm run test:all                 # 13 + 7 + 8 = 28 تست JS سبز
npm run test:maxrubika:py        # 9 تست Python سبز

# تست کاملاً آفلاین، بدون رمز و بدون سرویس
npm run rubika:export:fixture
node rubika/cli.mjs verify --fixture
node rubika/cli.mjs status

# مسیر تازه: سیو مسیج روبیکا با MAXRubika (آفلاین، بدون لاگین)
npm run maxrubika:status
npm run maxrubika:trial
python3 maxrubika/saved_messages.py status

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

### maxrubika / Saved Messages — محدودیتهای صادقانه

- MAXRubika **غیررسمی / self-bot** است، نه API رسمی روبیکا؛ پروتکل خصوصی،
  ممکن است بشکند، و self-bot میتواند خلاف شرایط سرویس باشد.
- **توکن بات لازم نیست**، ولی یکبار لاگین شماره + کد تأیید **روی دستگاه
  خودتان** لازم است (سشن محلی). ما چیزی نپرسیدیم/ذخیره نکردیم.
- پایتون است و تو مرورگر اجرا نمیشود؛ بدون ورسل، بدون دیپلوی، بدون بکاند عمومی.
- `delete_messages` صدا زده نمیشود؛ پیامهای قدیمی سیو مسیج پاک نمیشوند.
- Saved Messages **دیتابیس کوئریپذیر نیست**؛ فقط حامل بستههای ciphertext است.

## چی انجام نشد (و نباید ادعا شود)

- هیچ استقرار، دیپلوی، مرج، تغییر `main`، تغییر Edge / `dist.cjs` / `index.html`.
- هیچ نوشتن به GitHub، هیچ پاک کردن مخزن قدیمی، هیچ `DELETE` تو دیتابیس اصلی.
- هیچ ورسل، API رسمی روبیکا، ربات، توکن، scraping، endpoint خصوصی.
- هیچ کلیدی تو فرانتاند، تو لاگ، تو چت یا تو مخزن عمومی.
- هیچ ادعای «روبیکا شد دیتابیس کوئریپذیر»؛ نشد و بدون API رسمی نمیشود.

سند تصمیم، محدودیتها و فهرست کامل فایلها: `../docs/SECOND-DB-RUBIKA.md`.
