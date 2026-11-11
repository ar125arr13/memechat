# دیتابیس دوم → Internet Archive (IAS3) با رمزگذاری متفاوت

**درخواست:** «خب من internet archive رو انتخاب میکنم / ولی رمز گزاری متفاوت
و کلیدش توی سورس کدها باشه فقط».

**نتیجهٔ کوتاه:** مسیر ساخته و تست شد. رمزگذاری **واقعاً متفاوت** است
(ChaCha20-Poly1305 بهجای AES-256-GCM)، و **کلید فقط داخل سورس** است
(`r2-relay/internet-archive/key.mjs`) — نه env، نه passphrase، نه runtime،
نه چت، نه از کسی پرسیده شد. API مورد استفاده **رسمی خود Internet Archive**
(IAS3) است؛ متد خیالی نساختیم.

**بعداً اضافه شد:** درخواست «کلمات رو تبدیل کنن به یه کلمهٔ دیگه، اینجوری
میشه readable» → لایهٔ **کدبوک واژگان** (`codebook.mjs`: ۲۵۶ واژهٔ فارسی +
جایگشت Sattolo بدون نقطهٔ ثابت) **روی** همان بستهٔ باینری نشست، نه بهجای
آن. خروجی قابلخواندن است، ولی امن نیست و حجم را ~۹ برابر میکند. سند جداگانه:
[`docs/READABLE-CODEBOOK.md`](READABLE-CODEBOOK.md). پیشفرض باینری تغییر
نکرد. اکنون **۲۲ تست** آفلاین در این مسیر سبز است.

---

## ۱. ⚠️ مهمترین نکتهای که باید قبل از هر چیز بدانید

مخزن این پروژه **عمومی** است. با `gh api repos/ar125arr13/memechat` چک شد:
`private=false`، `visibility=public`، و PR #1 باز است. آیتمهای Internet
Archive هم طبق سند رسمی IAS3 «**World readable**» هستند:

> «ACLs are fake. permissions are: World readable, Item uploader writable.»
> — <https://archive.org/developers/ias3.html>

یعنی:

| ادعا | واقعیت |
|---|---|
| «دادهها رمز شدند، پس خصوصیاند» | ❌ **غلط.** کلید تو مخزن public است و آیتمها publicاند؛ هر کس میتواند بخواند و با همان کلید باز کند |
| «رمزگذاری چه فایدهای دارد؟» | ✅ تمامیت (Poly1305 tag)، قالببندی، جلوگیری از دستکاری/خرابی تصادفی، وابستگی بسته به آیتم/فایل/بچ |
| «پس چرا ساختی؟» | چون دقیقاً همان چیزی است که خواستید: «رمزگذاری متفاوت، کلیدش فقط تو سورس» |

اگر روزی **محرمانگی واقعی** خواستید، کلید باید بیرون از مخزن باشد (مثلاً
فایل محلی ignored) — ولی آن کار خلاف دستور فعلی «فقط توی سورس» است، پس
انجام **نشد**. نخواستیم الکی بگوییم «امن است».

### فرق «کلید رمزگذاری» با «کلید حساب IA»

| کلید | کجاست | چرا |
|---|---|---|
| کلید ۳۲ بایتی ChaCha20-Poly1305 | ✅ داخل سورس (`key.mjs`) | درخواست صریح شما |
| IAS3 `access` / `secret` (کلید حساب) | ❌ داخل سورس **نیست**؛ فقط موقع اجرا از محیط | وجود ندارد، و اگر تو مخزن عمومی باشد هرکس میتواند آیتمهایتان را تغییر دهد/حذف کند. «صفر حذف» هم ایجاب میکند چنین کلیدی لو نرود |

بدون کلید حساب، کد صادقانه `NO_RUNTIME_CREDENTIALS` میدهد و **هیچ تماس
شبکهای** نمیزند (تستشده). هیچ آپلود واقعی، حساب، یا لاگینی انجام نشد.

---

## ۲. رمزگذاری «متفاوت» دقیقاً چه فرقی کرد

| مورد | مسیرهای قبلی پروژه (`rubika` / `maxrubika`) | **این مسیر** |
|---|---|---|
| الگوریتم | AES-256-GCM (WebCrypto) | **ChaCha20-Poly1305** (RFC 8439، `node:crypto`) |
| کلید | `deriveAesKey(passphrase, salt)` | **ثابت ۳۲ بایتی داخل سورس** |
| بسته | متن `MCPK1.` / `MCR1.` | **باینری `MCIA1`** |
| nonce / IV | ۱۲ بایت | ۱۲ بایت تصادفی، هر بار تازه |
| tag | ۱۶ بایت GCM | ۱۶ بایت Poly1305 |
| AAD | رشتهٔ ساده / ندارد | **`item|filename|batchId`** — جابهجایی بسته بین آیتمها رد میشود |
| وابستگی | `crypto.subtle` | `node:crypto` مستقیم |

قالب باینری (self-contained، AAD داخل خود بسته ذخیره میشود):

```text
[0..4]   'MCIA1'          magic
[5]      version = 1
[6]      alg     = 1      ChaCha20-Poly1305
[7..8]   reserved
[9..20]  nonce   12 بایت
[21..22] aadLen  uint16BE
[23..]   aad     utf8(item|filename|batchId)
[... ]   ciphertext || Poly1305 tag(16)
```

چرا ChaCha20-Poly1305: AEAD استاندارد، در Node ≥ 20 بدون هیچ پکیج اضافهای
هست، و واقعاً الگوریتم دیگری است — نه فقط عوض کردن اسم. تست صریحاً چک
میکند که `cipher.mjs` نه `aes-256-gcm` دارد و نه WebCrypto.

---

## ۳. API رسمی IA — فقط متدهایی که تو سند دیدیم

همه از <https://archive.org/developers/ias3.html>،
<https://archive.org/developers/items.html>،
<https://archive.org/developers/metadata.html>،
<https://archive.org/developers/metadata-schema/index.html>:

| کار | متد / آدرس | هدرهای کلیدی |
|---|---|---|
| آپلود/ساخت آیتم | `PUT https://s3.us.archive.org/<item>/<filename>` | `Authorization: LOW <access>:<secret>`، `x-archive-auto-make-bucket:1` |
| متادیتا | همان PUT | `x-archive-meta-mediatype:data`، `x-archive-meta-collection:opensource_media`، `x-archive-meta-title:uri(...)` |
| جلوگیری از derive | همان PUT | `x-archive-queue-derive:0` |
| راهنمای اندازه | همان PUT | `x-archive-size-hint:<bytes>` |
| **نگهداری نسخهٔ قدیمی** | همان PUT | `x-archive-keep-old-version:1` ← بهخاطر «هیچ دادهای حذف نشود» |
| بررسی صف | `GET https://s3.us.archive.org/?check_limit=1&accesskey=..&bucket=..` | خروجی `over_limit` |
| فهرست فایلها | `GET https://archive.org/metadata/<item>` | بدون توکن |
| دانلود | `GET https://archive.org/download/<item>/<filename>` | بدون توکن |

`mediatype: data` تأیید شد: سند میگوید «آیتمهایی که محتوای اصلیشان مدیا یا
صفحهٔ وب نیست، مثل datasets» و CLI رسمی هم میگوید پیشفرض upload همین است
[1](https://archive.org/developers/metadata-schema/index.html)
[2](https://archive.org/developers/internetarchive/cli.html).

**راستیآزمایی واقعی (بدون توکن):** هنگام پیادهسازی،
`GET https://archive.org/metadata/stats` را گرفتم و JSON واقعی با `files[]`
(شامل `name`, `source`, `size`, `md5`, `crc32`, `sha1`, `format`) برگشت.
نمونهای از همان پاسخ بهعنوان fixture ذخیره شد
(`internet-archive/tests/fixtures/metadata-stats.json`) و `parseMetadataFiles`
روی آن تست میشود. یعنی شکل داده حدسی نیست.

**چیزهایی که عمداً استفاده نشدند:** `DELETE`، `x-archive-cascade-delete:1`،
`PATCH`، `test_collection` (چون بعد از ~۳۰ روز پاک میشود)، و هرگونه
متد/پارامتر undisclosed. `FORBIDDEN_METHODS` و تستها جلویشان را میگیرند.

---

## ۴. صفر حذف، صفر ریست، معماری دستنخورده

- `InternetArchiveDriver.delete()` صریحاً `IA_NO_DELETE` میدهد.
- اسکن کل `r2-relay/` یک `method: 'DELETE'` قدیمی پیدا کرد: متعلق به
  `HttpStorageDriver` در `client/storage-adapter.js` (مسیر R2/Worker از قبل
  از این کارها). آن درایور در مسیر IA اصلاً ساخته/فراخوانی نمیشود و در طول
  این کار هیچ درخواست DELETEای اجرا نشد. برای صداقت اینجا ذکر شد تا ادعای
  «هیچ DELETE در کل مخزن نیست» نادرست نباشد؛ ادعای ما محدود به **مسیر IA**
  و **اجرای واقعی** است.
- `x-archive-keep-old-version:1` یعنی حتی PUT مجدد، نسخهٔ قبلی را نابود نمیکند.
- نام فایلها یکتا است (`mcia/<item>/<batchId>/<index>.mcia`) → overwrite رخ نمیده.
- فایلهای self-generated IA (`_meta.xml`، تورنتها، deriveها) فقط هنگام
  **خواندن** فیلتر میشوند، نه حذف.
- **Supabase** همچنان دیتابیس اصلی است؛ لاگین، OTP، چت، تاریخچه، `rt-*`
  و `index.html` / CSP / `MC_API` / Edge دستنخوردهاند.
- منیفست محلی + Supabase مرجع باقی میمانند؛ IA فقط محل نگهداری بستههاست
  و **دیتابیس کوئریپذیر نیست** (SQL/تراکنش/ایندکس/OTP/realtime نمیدهد).
- مسیرهای `rubika/` و `maxrubika/` سر جایشاناند و پاک نشدند (درخواست
  «پاک کن» فقط دربارهٔ فایلهای بله بود).
- بدون ورسل، بدون دیپلوی، بدون merge، بدون تغییر فرانتاند.

---

## ۵. محدودیتهای صادقانهٔ Internet Archive

| موضوع | واقعیت |
|---|---|
| خصوصی بودن | ❌ آیتمها عمومی و «World readable»اند؛ `data` هم public است |
| شرایط استفاده | ToS میگوید دسترسی «for scholarship and research purposes only»؛ آیتمهای ناقض شرایط **ممکن است حذف شوند** [3](https://archive.org/about/terms.php) |
| استفاده بهعنوان بکاپ شخصی | ⚠️ FAQ قدیمی صریحاً: «شرایط استفادهٔ ما بکاپ برای عموم را پوشش نمیدهد» [4](https://web.archive.org/web/20140402223358/https:/archive.org/about/faqs.php) |
| حجم | توصیه: هر آیتم `< ۱۰۰GB` و `< ۱۰٫۰۰۰ فایل`؛ تکفایل `< ۵۰۰GB` [5](https://archive.org/developers/items.html) [6](https://help.archive.org/help/uploading-troubleshooting/) |
| صف / تأخیر | نوشتنها تو صفاند، ایندکس تا ۲۴ ساعت طول میکشد، ممکن است `503 SlowDown` بدهد؛ `check_limit` برای پیشگیری تعبیه شد |
| شناسهٔ آیتم | ASCII alphanumeric/`_`/`-`/`.`، شروع با حرف/رقم، ≤۱۰۰ کاراکتر، **بعداً قابلتغییر نیست** |
| CORS / مرورگر | IAS3 نیاز به هدر `Authorization` و 307 redirect دارد؛ تو مرورگر اجرا **نمیشود**. فرآیند محلی (Node) لازم است؛ ولی ورسل/بکاند عمومی/دیپلوی وجود ندارد |
| پایداری | تضمین دائمیبودن نیست؛ محتوای رمزشدهٔ بیmetadata ممکن است از نگاه IA عجیب باشد |
| کوئری | ❌ دیتابیس دوم همچنان «انبار فایل» است نه DB |

---

## ۶. فایلهای کامل تحویلشده

| فایل | کار |
|---|---|
| `r2-relay/internet-archive/key.mjs` | **کلید ثابت داخل سورس** + هشدار public + اثرانگشت امن |
| `r2-relay/internet-archive/cipher.mjs` | ChaCha20-Poly1305، بستهٔ `MCIA1`، AAD، inspect/decrypt، SHA-256 |
| `r2-relay/internet-archive/codebook.mjs` | **۲۵۶ واژهٔ فارسی + جایگشت Sattolo** بدون نقطهٔ ثابت، encode/decode متن قابلخواندن، آمار حجم |
| `r2-relay/internet-archive/ias3.mjs` | کلاینت رسمی: URLها، هدرها، redaction، `Ias3Transport`، `parseMetadataFiles`، ممنوعیت DELETE |
| `r2-relay/internet-archive/adapter.mjs` | `InternetArchiveDriver`، `publishForInternetArchive`، `verify...`، `readInternetArchive` |
| `r2-relay/internet-archive/fixture.mjs` | شبیهساز آفلاین با همان شکل metadata واقعی |
| `r2-relay/internet-archive/cli.mjs` | `status` / `trial --fixture` / `help` |
| `r2-relay/internet-archive/tests/run.mjs` | ۲۲ تست آفلاین |
| `r2-relay/internet-archive/tests/fixtures/metadata-stats.json` | نمونهٔ پاسخ واقعی `/metadata/stats` |
| `r2-relay/internet-archive/README.md` | خلاصهٔ مسیر |
| `docs/SECOND-DB-INTERNET-ARCHIVE.md` | همین سند |

خروجی واقعی اجرا:

```text
مقصد: internet-archive-ias3 | آیتم: memechat-second-db | حالت: fixture
رمزگذاری: ChaCha20-Poly1305 | کلید: source-code | اثرانگشت: d0bd7dfdd1ddd83b
تکهها: 3 | بستهها: 3 | تأیید SHA: true
فایل برگشتی موبرهمو: true
حذف/ریست: false | عملیات مخرب: 0
```

و حالت قابلخواندن (همان داده، تبدیلشده به واژه):

```text
تکهها: 3 | بستهها: 3 | تأیید SHA: true | فایل برگشتی موبرهمو: true
حجم باینری: ۳٬۱۴۶٬۱۳۳ بایت | حجم متن: ۲۸٬۱۳۷٬۰۵۰ بایت | ضریب: ۸.۹۴×
نمونهٔ تبدیل: آب ← گچ  |  باد ← ماه  |  خاک ← دفتر
```

---

## ۷. چی انجام **نشد** (ادعا نمیشود)

- ❌ هیچ حساب IA، لاگین، `access`/`secret`، یا آپلود واقعی (بدون کلید حساب،
  کد `NO_RUNTIME_CREDENTIALS` میدهد و صفر تماس شبکهای میزند).
- ❌ هیچ استقرار، ادغام PR، تغییر `index.html`/CSP/`MC_API`/Edge، خاموش کردن
  Supabase، یا تغییر ظاهر/لاگین/پیامها.
- ❌ هیچ `DELETE` / `DROP` / `TRUNCATE` / `RESET`؛ هیچ ردیف/بچهای پاک نشد.
- ❌ هیچ ورسل، توکن بات، scraping، یا endpoint غیرداکیومنت.
- ❌ هیچ ادعای «محرمانگی» یا «IA شد دیتابیس اصلی/کوئریپذیر».
- ❌ دسترسی از شبکهٔ ایران تست **نشده** و تضمین نمیشود.

PR #1 همچنان **OPEN** و merge نشده.

---

## ۸. منابع

1. Metadata Schema (مدیاتایپ `data`، شناسهها) — <https://archive.org/developers/metadata-schema/index.html>
2. CLI رسمی IA (پیشفرض `data`) — <https://archive.org/developers/internetarchive/cli.html>
3. Terms of Use — <https://archive.org/about/terms.php>
4. FAQ (بکاپ عمومی تحت پوشش نیست) — <https://web.archive.org/web/20140402223358/https:/archive.org/about/faqs.php>
5. Items (محدودیت ۱۰۰GB/۱۰هزار فایل، collectionها، `test_collection`) — <https://archive.org/developers/items.html>
6. Uploading troubleshooting (تکفایل ۵۰۰GB، حذف آیتمها) — <https://help.archive.org/help/uploading-troubleshooting/>
7. IAS3 (LOW auth، auto-make-bucket، queue-derive، size-hint، keep-old-version، check_limit، 307/503) — <https://archive.org/developers/ias3.html>
8. Metadata API — <https://archive.org/developers/metadata.html>
9. rclone backend IA (تأیید endpoint/کلیدها/صف) — <https://rclone.org/internetarchive/>
10. پاسخ واقعی `GET /metadata/stats` — <https://archive.org/metadata/stats>
11. تحقیق مقایسهای قبلی — `docs/STORAGE-CANDIDATES.md`
