# TeraBox — پیدا کردن API رسمی و پاسخ به «دو اکانت لاگین کنم، API شون رو بگیرم»

**وضعیت:** تحقیق + کلاینت آفلاین اضافه شد. مقصد دوم پروژه **همچنان Internet
Archive** است؛ معماری، Supabase، لاگین، چت، ظاهر و فایلهای `MCIA1`/`MCRD1`
دستنخوردهاند. هیچ استقرار، مرج، حذف/ریست، ورسل یا لاگین واقعی انجام نشد.

---

## ۱. پاسخ کوتاه

**بله، API رسمی پیدا شد — ولی آن چیزی نیست که لاگین با دو اکانت تحویل میدهد.**

TeraBox یک «Open Platform» مستندشده و زنده دارد
([سند رسمی، ۱۲ بخش][1]). ولی **self-serve نیست**: `client_id`،
`client_secret` و `private_secret` فقط بعد از درخواست و تأیید TeraBox صادر
میشوند («Vendors need to apply…»، صفحهٔ [Integration][2] فقط «Contact us» و
«customized API solution tailored for you» دارد). یعنی:

- **API کی** مالِ *اپ تأییدشده* است، نه مالِ *اکانت*. یک دست برای کل اپ.
- لاگینِ هر اکانت فقط یک جفت **`access_token` + `refresh_token`** میدهد
  (سند ۱.۴.۲.۱). دو اکانت = **دو جفت توکن مستقل**، نه دو API کی.
- `access_token` **۲ روز**، `refresh_token` **۳۰ روز** و **یکبارمصرف** است؛
  بعد از refresh، توکن قبلی ۱۵ ثانیه زودتر میمیرد (سند ۱.۴.۲.۳).
- دامنهٔ سرویس هم بهازای توکن از `POST /oauth/tokeninfo` گرفته میشود؛
  «Different TeraBox users may correspond to different domain names».

پس «با دوتا اکانت لاگین کنم بعد api شون رو بگیرم» به این تبدیل شد:
**دو حساب جدا پشتیبانی شد، ولی کلید اپ و لاگین واقعی انجام نشد** چون کلید
اپ تأییدشدهای وجود ندارد و رمز/OTPـای هم از کسی نگرفتیم.

### تصحیح یک ادعای قبلی خودم

تو [`docs/STORAGE-CANDIDATES.md`](STORAGE-CANDIDATES.md) نوشته بودم
«TeraBox API رسمی ندارد». **دقیق نبود.** سند رسمی و endpointهای رسمی وجود
دارند؛ جملهٔ درست این است: **«API رسمی وجود دارد، ولی self-service عمومی
ندارد؛ نیاز به تأیید شرکتی/partner دارد.»** همان سند بهروز شد.

---

## ۲. تأیید زنده، بدون هیچ حساب یا رمز

دو GET کاملاً خواندنی با مقدارهای **ساختگی/نامعتبر** زدم تا معلوم شود
endpointها واقعیاند (هیچ توکن، کوکی یا `client_id` معتبری رد و بدل نشد):

| درخواست | پاسخ واقعی |
|---|---|
| `GET https://www.terabox.com/oauth/devicecode?client_id=ARENA_INVALID_TEST_ONLY` | `{"errno":100001,...,"show_msg":"unknown client"}` |
| `GET https://www.terabox.com/oauth/tokeninfo?access_token=ARENA_INVALID_TEST_ONLY` | `{"errno":200002,...,"show_msg":"invalid access_token"}` |

همین دو JSON عیناً در
[`r2-relay/terabox/tests/fixtures/oauth-errors.json`](../r2-relay/terabox/tests/fixtures/oauth-errors.json)
ذخیره و در تستها استفاده شد. نتیجه: سرویس زنده است، ولی بدون
`client_id` تأییدشده همانجا متوقف میشود؛ «لاگین سادهای که API کی بدهد»
وجود ندارد.

---

## ۳. مدل احراز هویت (سه لایه)

```
[ اپ تأییدشده ]  client_id + client_secret + private_secret   ← از TeraBox، یکبار
        │  sign = md5(client_id _ timestamp _ client_secret _ private_secret)
        ▼
[ هر حساب جدا ]  /wap/outside/login?clientId=…  یا  /oauth/devicecode (QR)
        │  code / device_code
        ▼
POST /oauth/gettoken  →  access_token (۲ روز) + refresh_token (۳۰ روز، یکبارمصرف)
        ▼
POST /oauth/tokeninfo →  api_domain + upload_domain + user_id
        ▼
/openapi/*  (فقط داخل فضای اختصاصیافته به اپ)
```

- **Authorization Code Mode:** iframe/مرورگر به
  `https://www.terabox.com/wap/outside/login?clientId=XXX`، برگشت `code`،
  سپس تبادل سروری. `code` یکبارمصرف و ۵ دقیهای است.
- **Device Code Mode:** `GET /oauth/devicecode?client_id=…` →
  `device_code`، `qrcode_url` (Base64)، `expires_in` (مثال ۳۰۰)، `interval`
  (مثال ۲)؛ کاربر با اپ TeraBox اسکن میکند و سرویس `gettoken` را poll میکند
  (`errno 400001` یعنی هنوز تأیید نکرده). `user_code`/`verification_url`
  طبق خود سند **فعلاً کار نمیکنند**.
- سند بخش ۲.۲ مینویسد برای لاگین با اپ «VPN access is required». ما هیچ
  دور زدن شبکهای/پروکسی انجام ندادیم و این مسیر را بررسی نکردیم.

### کدهای خطای رسمی (سند ۱.۴.۲)

`2` پارامتر کم · `100001` client نامعتبر · `100002` code نامعتبر ·
`200001` grant_type پشتیبانی نمیشود · `200002` توکن نامعتبر ·
`200003` توکن منقضی · `200004/200005` refresh نامعتبر/منقضی ·
`300001` تعداد تبادل زیاد · `400001` کاربر هنوز تأیید نکرده ·
`500001` خطای داخلی.

---

## ۴. endpointهای رسمی پیادهسازی/مستندشده

| کار | متد | مسیر |
|---|---|---|
| صفحهٔ لاگین | GET | `/wap/outside/login?clientId=…` |
| کد دستگاه + QR | GET | `/oauth/devicecode?client_id=…` |
| تبادل code/device_code | POST | `/oauth/gettoken` |
| دامنه و user_id توکن | POST | `/oauth/tokeninfo` |
| تمدید توکن | POST | `/oauth/refreshtoken` |
| اطلاعات کاربر | GET | `/openapi/uinfo?access_tokens=…` |
| سهمیه (`total`, `used`) | GET | `/openapi/api/quota?access_tokens=…` |
| پیشآپلود | POST | `/openapi/api/precreate` |
| آپلود تکه | POST | `/rest/2.0/pcs/superfile2` **روی `upload_domain`** |
| ساخت/ادغام فایل | POST | `/openapi/api/create` |
| لیست / جستجو / متادیتا | GET | `/openapi/api/list` · `/search` · `/filemetas` |
| لینک دانلود | GET | `/openapi/api/download?fidlist=[…]&type=dlink` |
| پخش آنلاین | GET | `/openapi/api/streaming` |
| مدیریت فایل | POST | `/openapi/api/filemanager` (شامل `opera=delete` → **مسدود**) |
| لینک اشتراک | GET/POST | `/openapi/share/verify` · `/api/shorturlinfo` · `/share/list` · `/share/transfer` · `/share/download` |

ناهماهنگیهای خود سند (صداقتاً ثبت میشوند، حدس زده نشدند):

- پارامتر توکن در اکثر جاها `access_tokens` (جمع) است، ولی بعضی نمونههای
  `/openapi/active` و `/share/streaming` از `access_token` (مفرد) استفاده
  کردهاند. ما همان `access_tokens` اکثریت را گرفتیم.
- بخش ۳.۱.۳ میگوید مسیر فایل **ثابت** است:
  `/From: Other Applications/Application Name-/`؛ ولی مثال ۳.۴.۵ از
  `dir=/` استفاده کرده و مثال ۳.۴.۱ از `/From: Other Device/…`. کلاینت ما
  محافظهکارانه پیشوند اپ را **اجبار** میکند و قبل از استفادهٔ واقعی باید
  تأیید شود.
- مثالهای `gettoken`/`refreshtoken` با `--form` (multipart)اند و مثالهای
  `precreate`/`create` با `--data-urlencode`. همان ترکیب پیاده شد
  (`FormData` برای OAuth، `URLSearchParams` برای آپلود).

---

## ۵. آپلود (سه مرحله، سند ۳.۴)

1. **precreate** — `autoinit=1`، `path`،
   `block_list='["<md5 تکه>", …]'` → `uploadid`،
   `return_type` (۱ = فایل نیست، ۲ = از قبل هست)، `block_list` شماره تکهها.
2. **superfile2** — `method=upload`، **`app_id=250528` (ثابت)**، `path`،
   `uploadid`، `partseq`، بدنهٔ `file` (باینری)؛ دامنه از
   `upload_domain` (مثال `c-jp.terabox.com`). **اگر بیش از یک تکه باشد،
   هر تکه باید > ۴MB باشد.**
3. **create** — `path`، `size`، `uploadid`، همان `block_list`، `rtype`.
   `rtype=1` یعنی هنگام تداخل تغییر نام بده؛ `rtype=3` یعنی **بازنویسی** که
   ما مسدود کردیم (قانون «هیچ دادهای حذف/ریست نشود»).

همهٔ اینها در `FixtureTerabox` آفلاین تست شدند: یک تکهٔ ۶۴KB،
`precreate → superfile2 → create`، سپس `download`/`list`، برگشت فایل
**موبرهمو + SHA-256 یکسان**.

---

## ۶. «دو اکانت» دقیقاً چی شد و چی نشد

**شد:** `accounts.mjs` دو حساب با توکن، `user_id`، `api_domain` و
`upload_domain` **کاملاً جدا** نگه میدارد؛ `assertIsolated()` توکن مشترک را
رد میکند؛ `describe()` فقط اثرانگشت ۸رقمی SHA-256 نشان میدهد و هیچ توکنی
چاپ نمیکند؛ refresh یکبارمصرف و چرخش ۱۵ ثانیهای پیاده شد. سهمیهٔ هر حساب
جداگانه خوانده میشود.

**نشد (و ادعا نمیشود):** جمع کردن دو سهمیه برای رد کردن سقف، ساخت حساب
انبوه، یا «۲ ترابایت از دو اکانت رایگان». دلیلش حدس من نیست؛ متن
[شرایط استفادهٔ TeraBox][3] (منتشر/لازمالاجرا ۲۰۲۶-۰۹-۱۷) در «Acceptable
Use Policy» صریحاً میگوید:

> - «access, search, or create accounts for the Services by any means other
>   than our publicly supported interfaces (for example, "scraping" or
>   creating accounts in bulk)»
> - «abuse referrals or promotions to get more storage space than deserved»
> - «**circumvent storage space limits**»

و «User Responsibilities» میگوید نباید اطلاعات اکانت را به دیگران داد یا
دسترسی داد؛ تخلف میتواند به تعلیق/حذف اکانت و حذف محتوا بینجامد. بنابراین
هیچ مکانیزم pooling/دور زدن سقف ساخته نشد: `quotaPooling: false`.

همچنین گزارشهای کاربران (Reddit، ۲۰۲۶) میگویند اکانتهای **تازه** دیگر
۱TB دائمی نمیگیرند و سهمیهٔ دائمی به ۳۰GB کاهش یافته و مابقی موقتی است.
اینها **منبع رسمی نیستند** و بهعنوان سیاست قطعی ثبت نشدند؛ فقط بهعنوان
ریسک «عدد ۱TB پایدار نیست» ذکر میشوند. سایت رسمی همچنان ۱TB تبلیغ میکند.

---

## ۷. مسیرهایی که بررسی و **رد** شدند

| مسیر | چرا رد شد |
|---|---|
| `ndus` کوکی جلسه از DevTools + endpointهای وب مهندسیمعکوس (`dm.1024terabox.com`، `jsToken`، `bdstoken`) | رابط «publicly supported» نیست؛ ToS بالا صریحاً ممنوعش کرده؛ کوکی مثل رمز عبور است، زود منقضی میشود، قرارداد/پایداری ندارد، و اکثر کتابخانهها فقط **دانلود لینک اشتراک**اند نه آپلود/دیتابیس. هیچ کوکیـای نگرفتیم/نساختیم. [نمونه][4] · [نمونه][5] |
| استخراج `client_id/app_id` از ترافیک وب اپ با Fiddler/mitmproxy | همان ممنوعیت ToS + ادعای دروغ «رسمی بودن»؛ انجام نشد. [گفتوگوی GitHub][6] |
| سرویسهای «TeraBox API» شخص ثالث (`teraboxapi.com`، `teraboxdl.site`، `api.teraboxfast.com`، `xapiverse.com`، `mswpresents.tech`) | اکثراً **resolve لینک اشتراک → لینک مستقیم/ HLS** هستند، یعنی ذخیره/آپلود نمیکنند؛ و **پولی**اند (مثلاً ₹۱٫۹۹۹/ماه، ۲۰۰ لیره، پرداخت Paddle/UPI/کریپتو). پروژه بدون کارت/پرداخت تعریف شده → کنار گذاشته شدند. [نمونه][7] · [نمونه][8] |
| «customized API» صفحهٔ Integration | همان تأیید شرکتی است؛ فرم self-service و کلید فوری وجود ندارد. انجام نشد (بدون حساب سازمانی/قرارداد). |

نتیجهٔ صادقانه: **تنها راه رسمی و قابلاتکا همان Open Platform تأییدشده
است**، و تا وقتی آن کلید اپ صادر نشود، «گرفتن API دو اکانت» ممکن نیست.

---

## ۸. محدودیتهای دیگری که باید قبل از تصمیم بدانی

- **لاگین واقعی انجام نشد**؛ بنابراین امضای MD5، جنس بدنهٔ فرمها، پیشوند
  مسیر اپ و رفتار `upload_domain` **روی حساب واقعی تأیید نشده** و فقط از سند
  پیروی شده است. قبل از استفادهٔ زنده باید با TeraBox چک شود.
- توکنها کوتاهعمرند (۲ روز / ۳۰ روز)؛ نیاز به تمدید منظم و نگهداری امن
  `refresh_token` وجود دارد. refresh یکبارمصرف است؛ از دست رفتنش یعنی لاگین
  دوباره.
- فقط داخل **پوشهٔ اختصاصی اپ** میتوان نوشت؛ دسترسی به کل درایو کاربر نیست.
- TeraBox رمزگذاری سرتاسری (E2E) ندارد؛ «Encrypted space» مال پلن پولی است.
  برای دیتابیس دوم، محتوا باید مثل مسیر IA رمزشده نگه داشته شود.
- شرایط استفاده اجازه میدهد سرویس/سقف رایگان را تغییر دهند یا دسترسی را
  معلق کنند؛ یعنی **بکاپ تضمینشده و همیشگی** نیست (همان ریسکی که برای IA
  هم گفتیم).
- دسترسی از ایران/شبکه تست نشد؛ تست زندهای هم از سندباکس به `terabox.com`
  جز همان دو GET خواندنی انجام نشد.

---

## ۹. چی ساخته شد (اضافه، بدون دست زدن به بقیه)

| فایل | محتوا |
|---|---|
| `r2-relay/terabox/openplatform.mjs` | سازندهٔ خالص تمام درخواستهای بالا + `buildSign` + `redact` + `parseErrno` + مسدودساز عملیات مخرب |
| `r2-relay/terabox/accounts.mjs` | `TeraboxAccounts`: دو حساب مستقل، refresh یکبارمصرف، خروجی redactشده |
| `r2-relay/terabox/transport.mjs` | `TeraboxTransport` (بدون کلید اپ → `TERABOX_NO_APP_CREDENTIALS`، صفر شبکه) + `FixtureTerabox` |
| `r2-relay/terabox/cli.mjs` | `status` / `trial --fixture` / `accounts --fixture` / `help` |
| `r2-relay/terabox/tests/run.mjs` | تستهای آفلاین |
| `r2-relay/terabox/tests/fixtures/oauth-errors.json` | دو پاسخ واقعی سرور با مقادیر نامعتبر |
| `r2-relay/terabox/README.md` | خلاصهٔ ماژول |
| `docs/TERABOX-OPEN-PLATFORM.md` | همین سند |

متغیرهای محیط (فقط runtime، هرگز داخل سورس/فرانتاند):
`MC_TERABOX_CLIENT_ID`، `MC_TERABOX_CLIENT_SECRET`،
`MC_TERABOX_PRIVATE_SECRET`.

---

## ۱۰. چی انجام **نشد** (ادعا نمیشود)

- هیچ لاگین واقعی، ثبتنام اپ، دریافت `client_id` واقعی، توکن حساب، رمز عبور،
  OTP، کوکی `ndus` یا پرداخت.
- هیچ آپلود/دانلود واقعی روی TeraBox؛ `trial` فقط fixture حافظهای است.
- هیچ جابهجایی مقصد دوم: IA و `r2-relay/internet-archive/` سر جایند،
  `r2-relay/maxrubika/` و مسیر روبیکای دستی هم سر جایند.
- هیچ تغییر Supabase، لاگین، چت، تاریخچه، `index.html`، Edge، CSP، `MC_API`.
- هیچ حذف ردیف/فایل/ریست، `DELETE`، `opera=delete`، `rtype=3`، ورسل، دیپلوی،
  مرج، یا دستور لازمالاجرا برای صاحب پروژه.

---

## ۱۱. منابع

1. TeraBox Open Platform Integration Document (سند رسمی، ۱۲ بخش): <https://www.terabox.com/integrations/docs>
2. TeraBox Integration («Contact us» / «customized API solution»): <https://www.terabox.com/integrations>
3. TeraBox Terms of Service (۲۰۲۶-۰۹-۱۷): <https://www.terabox.com/terms/duty>
4. GitHub — `saahiyo/terabox-gateway` (نیاز به `ndus`): <https://github.com/saahiyo/terabox-gateway>
5. GitHub — `Paidguy/terabox-api` («unofficial integration with no API contract»): <https://github.com/Paidguy/terabox-api>
6. Gist — «Reverse Engineering Terabox» (بحث استخراج client_id): <https://gist.github.com/CypherpunkSamurai/58d8f2b669e101e893a6ecf3d3938412>
7. `teraboxapi.com/docs` — API پولی resolve لینک: <https://teraboxapi.com/docs>
8. `api.teraboxfast.com` — کلید ۲۰۰ لیرهای: <https://api.teraboxfast.com/>
9. `xapiverse.com/marketplace/terabox` — marketplace API: <https://xapiverse.com/marketplace/terabox>
10. `dashboard.teraboxdl.site` — پلن ₹۱٫۹۹۹/ماه: <https://dashboard.teraboxdl.site/>
11. GitHub — `abhay1298/cloudplay` («apply for an Open Platform application … wait for approval»): <https://github.com/abhay1298/cloudplay>
12. GitHub — `ctmhacker72/diskwala-terabox` («requires … obtained from TeraBox»): <https://github.com/ctmhacker72/diskwala-terabox>
13. GitHub — `RuzBox` («TeraBox tidak dapat mengotorisasi akun sebelum kredensial aplikasi disetujui»): <https://github.com/fairuzbaru43-blip/RuzBox>
14. Reddit r/cloudstorage — «TeraBox just nerfed their 1TB Free claim» (گزارش کاربر، غیررسمی): <https://www.reddit.com/r/cloudstorage/comments/1rz53kg/terabox_just_nerfed_their_1tb_free_claim/>
15. SaaSWorthy — «Does Terabox provide API? No» (منبع تحقیق قبلی، حالا فقط بهمعنای نبود self-serve): <https://www.saasworthy.com/product/terabox>
16. پاسخ زندهٔ `GET /oauth/devicecode` با client نامعتبر: <https://www.terabox.com/oauth/devicecode?client_id=ARENA_INVALID_TEST_ONLY>
17. پاسخ زندهٔ `GET /oauth/tokeninfo` با توکن نامعتبر: <https://www.terabox.com/oauth/tokeninfo?access_token=ARENA_INVALID_TEST_ONLY>

[1]: https://www.terabox.com/integrations/docs
[2]: https://www.terabox.com/integrations
[3]: https://www.terabox.com/terms/duty
[4]: https://github.com/saahiyo/terabox-gateway
[5]: https://github.com/Paidguy/terabox-api
[6]: https://gist.github.com/CypherpunkSamurai/58d8f2b669e101e893a6ecf3d3938412
[7]: https://teraboxapi.com/docs
[8]: https://api.teraboxfast.com/
