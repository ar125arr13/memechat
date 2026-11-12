# TeraBox Open Platform — کلاینت رسمی (partner-only)

این پوشه **فقط یک کلاینت/تحقیق اضافهشده** است؛ مقصد دوم پروژه همچنان
Internet Archive است و هیچ فایل/تنظیمی از مسیرهای قبلی عوض نشده.

## چی پیدا شد

TeraBox یک **سند رسمی Open Platform** دارد:
<https://www.terabox.com/integrations/docs> — OAuth، آپلود تکهای، لیست،
دانلود، سهمیه، اشتراک. endpointها زندهاند (با GET نامعتبر تأیید شدند).
اما **self-serve نیست**: `client_id` / `client_secret` / `private_secret`
را فقط بعد از درخواست شرکتی/تأیید TeraBox میدهند
(<https://www.terabox.com/integrations> → «Contact us»، «customized API solution»).

پس «لاگین با دو اکانت → گرفتن API شون» از نظر فنی اینطور نیست:

| لایه | از کجا میآید | چندتاست |
|---|---|---|
| `client_id` + `client_secret` + `private_secret` | تأیید اپ توسط TeraBox | **یک دست** برای کل اپ |
| `access_token` + `refresh_token` | OAuth هر حساب جداگانه | **یک جفت بهازای هر حساب** |
| `api_domain` / `upload_domain` | `POST /oauth/tokeninfo` | ممکن است برای هر حساب فرق کند |

## فایلها

| فایل | کار |
|---|---|
| `openplatform.mjs` | سازندهٔ خالص درخواستها بر اساس سند رسمی: امضای MD5، OAuth، quota، precreate/superfile2/create، redact، مسدود کردن عملیات مخرب |
| `accounts.mjs` | نگهداری **دو حساب مستقل** با توکن/دامنهٔ جدا، refresh یکبارمصرف، خروجی redactشده |
| `transport.mjs` | `TeraboxTransport` (فقط با کلید اپ runtime شبکه میزند) و `FixtureTerabox` (کاملاً آفلاین) |
| `cli.mjs` | `status` / `trial --fixture` / `accounts --fixture` / `help` |
| `tests/run.mjs` | تستهای آفلاین |
| `tests/fixtures/oauth-errors.json` | دو پاسخ واقعی سرور با مقادیر نامعتبر (بدون هیچ رمز) |

سند کامل تصمیم/منابع/محدودیتها:
[`../../docs/TERABOX-OPEN-PLATFORM.md`](../../docs/TERABOX-OPEN-PLATFORM.md).

## قوانینی که اینجا رعایت شد

- **هیچ لاگین واقعی، توکن واقعی، رمز عبور، OTP، کوکی `ndus` یا کلید اپ واقعی**
  در سورس/چت/لاگ نیست. کلیدها فقط از `MC_TERABOX_CLIENT_ID`،
  `MC_TERABOX_CLIENT_SECRET`، `MC_TERABOX_PRIVATE_SECRET` در runtime خوانده
  میشوند؛ بدونشان `TERABOX_NO_APP_CREDENTIALS` و **صفر تماس شبکهای**.
- `opera=delete`، `rtype=3` (overwrite)، `DELETE`، `PATCH`، `TRUNCATE` مسدوداند.
- دو حساب **جمع نمیشوند**: سهمیهها پول نمیشود. شرایط استفادهٔ TeraBox صریحاً
  «circumvent storage space limits» و دسترسی از رابط غیرعمومی را ممنوع کرده
  است؛ هیچ مکانیزم دور زدن سقف، ساخت حساب انبوه یا scraping ساخته نشد.
- فقط رابط **رسمی مستندشده**؛ هیچ endpoint مهندسیمعکوس/غیررسمی پیاده نشد.
- بدون ورسل، بدون دیپلوی، بدون مرج، بدون تغییر Supabase، بدون حذف ردیف.

## وضعیت صادقانه

`trial --fixture` فقط شبیهسازی است: دو حساب ساختگی، آپلود تکهای در حافظه،
برگشت موبرهمو + SHA. اینکه فرمها/پارامترها **روی حساب واقعی** کار میکنند
تأیید نشده، چون اپ تأییدشدهای وجود ندارد و لاگین انجام نشد. قبل از هر
استفادهٔ واقعی باید امضا، `Content-Type` فرمها و پیشوند مسیر اپ
(`/From: Other Applications/...`) با TeraBox تأیید شود.
