# r2-relay — نمونهٔ اولیه (prototype)، **مستقر نشده**

**وضعیت: فقط کد و سند روی برنچ جلسه.** هیچ استقرار، تغییر `MC_API`، تغییر CSP،
تغییر Edge Function، جابهجایی secret، اتصال به R2/Drive/Rubika/GitHub یا حذف دادهٔ کاربری انجام نشده است.

## سه حرف راست قبل از کد

1. **سایتهای استوریجی «سرور» نمیشوند.** Google Drive، GitHub Pages، R2، روبیکا و
   هاستهای فایل فقط بایت نگه میدارند؛ CPU، نشست، تراکنش و کوئری ندارند. تنها جایی که
   در این طرح واقعاً محاسبه میکند **Cloudflare Workers** است (و Durable Objects / D1 / KV برای
   هماهنگی و ایندکس)، بهعلاوهٔ کلاینت برای رمزگذاری و GitHub Actions برای کارهای آفلاین.
   «دیتابیس» اینجا در واقع **object store + manifest + ایندکس** است، نه SQL با تراکنش.
2. **R2 واقعاً egress صفر دارد** — این بزرگترین برتری آن است و دقیقاً همان چیزی را حل میکند
   که ایمیل سهمیهٔ Supabase نشانه گرفته. ولی «نامحدود» نیست: لایهٔ رایگان
   **۱۰ GB-month ذخیره + ۱M عملیات Class A (نوشتن) + ۱۰M عملیات Class B (خواندن)** در ماه،
   و بعد از آن $0.015/GB و $4.50/M و $0.36/M است. `r2.dev` هم rate-limited و غیرتولیدی است؛
   برای production باید custom domain وصل شود.
3. **گلوگاه بعدی تعداد درخواست است، نه حجم.** Workers Free فقط **۱۰۰٬۰۰۰ req/day**
   و **۱۰ ms CPU بهازای هر درخواست** میدهد. با `poll` هر ۳٫۵ ثانیه (≈۱۰۲۹ req/h بهازای
   هر کلاینت همیشهروشن)، سقف روزانه حدود **۴ کلاینت دائم** است. پس R2 بهتنهایی کافی نیست:
   باید poll افزایشی/ETag/WebSocket شود وگرنه `Error 1027` میگیرید.

دربارهٔ روبیکا: **API رسمی Bot v3 وجود دارد** (`botapi.rubika.ir/v3/{token}/...`، شامل
`getFile` / `sendFile` / `requestSendFile` / `getUpdates`). پس «بدون API» فقط یک
**fallback** است برای وقتی توکن ربات از کار افتاده. پیادهسازی اینجا `ManualCourierDriver`
است: بستههای متنی کوتاه و **رمزگذاریشدهای** که انسان کپی میکند توی چت (یا QR) و برمیگرداند —
بدون scraping، بدون endpoint خصوصی، بدون توکن. اتوماسیونِ بدون API یعنی مهندسی معکوس
پروتکل خصوصی + نگهداری نشست کاربر: شکننده، نقض ToS، و قابلاعتماد برای بکاند نیست؛ انجامش ندادیم.

## چی نوشته شد

| فایل | کار |
|---|---|
| `worker/src/index.js` | Worker: مسیرهای `/v1/blob`, `/v1/object`, `/v1/manifest`, `/v1/sync/verify`, `/v1/sync/commit`; HMAC session, CORS, rate limit، خواندن immutable با ETag |
| `worker/src/crypto.js` | Web Crypto مشترک (مرورگر + Worker + Node): PBKDF2→AES-256-GCM، SHA-256، base64url |
| `worker/wrangler.toml.example` | R2/KV bindings و `ALLOWED_ORIGIN`؛ **هیچ secretی داخلش نیست** |
| `client/storage-adapter.js` | رابط `StorageDriver` + درایورهای R2 / HttpStorage / ManualCourier / Memory و پروتکل «اول تأیید، بعد حذف» |
| `client/courier.js` | بستههای متنی `MCPK1` برای حمل دستی بدون API (تشخیص بستهٔ گمشده/دستکاریشده) |
| `tests/run.mjs` | ۹ تست بدون وابستگی |

```bash
cd r2-relay && node tests/run.mjs     # 9 tests passed
```

## قانون طلایی، همان که قبلاً گفتی، اینجا پیاده شده

`publishEncrypted` بچهها را توی `stage/...` مینویسد → `verifyAndCommit` **همه** را با
SHA-256 میخواند و تأیید میکند → **همه** را به `blob/<sha>` ارتقا میدهد → **تازه آن موقع**
کلیدهای staging را پاک میکند. اگر حتی یکی تأیید نشود: `retainedInStaging: true` و
**هیچ حذفی** انجام نمیشود (تستش نوشته شده). سرور فقط ciphertext میبیند؛ کلید رمزگشایی
هیچوقت به R2/Drive/Rubika/Worker نمیرسد.

## چی انجام نشده (و نباید ادعا شود)

- وصل کردن به `index.html` زنده: CSP فعلی فقط `'self'` و `supabase.co` را اجازه میدهد؛
  `MC_API` همچنان `mimchat-api` است. اضافه کردن originـه Worker یعنی انتشار تأییدشده +
  مقایسهٔ هش HTML زنده + بازسازی `AppConfig` اندروید و تست APK.
- حذف کامل Supabase: یعنی بازنویسی ورود/OTP، توکن نشست، ~۱۰۰ اکشن چت، نقشها،
  rate limit، سیگنالینگ تماس WebRTC و مهاجرت Postgres→D1. **کاری جداست و انجام نشده.**
- درایورهای Drive / GitHub / هاستهای فایل و `/v1/mirror/*`: عمداً `501` میدهند، چون
  توکنشان نباید توی مرورگر باشد و CORS/ToS هرکدام جداگانه باید بررسی شود.
- هیچ توکن، کلید، بایت دادهٔ کاربر یا پیام آزمایشی به کاربر واقعی فرستاده نشده است.

جزئیات، جدول تأمینکنندهها، حساب egress و فازهای مهاجرت: `docs/ARCHITECTURE.md`.
