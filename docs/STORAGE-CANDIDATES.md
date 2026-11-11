# پیدا کردن جایی برای نگهداری «مقدار زیادی دیتا»

**درخواست:** «خب یه وبسایتی جایی پیدا بکن که داخلش بشه مقدار زیادی دیتا نگه داشت».

**نتیجهٔ کوتاه:** بله، جاهای واقعی وجود دارند. ولی «حجم زیاد» و «بدون
کارت/پرداخت» و «API رسمی» و «خصوصی بودن» چهارتا شرط متفاوتاند و هیچ سرویسی
هر چهارتا رو باهم بی نقص نمیدهد. پیشنهاد من **Hugging Face Hub با مخزن خصوصی
(۱۰۰ گیگ رایگان، API رسمی، بدون کارت)** است. بیشترین حجم مطلق مال
**Internet Archive** است، ولی عمومی است و شرایط استفادهاش برای بکاپ شخصی
مناسب نیست. **TeraBox** یک ترابایت میدهد ولی API خودسرویس عمومی ندارد.

> **✅ تصمیم صاحب پروژه (بعد از این تحقیق):** «من internet archive رو انتخاب
> میکنم / ولی رمز گزاری متفاوت و کلیدش توی سورس کدها باشه فقط». پیادهسازی
> کامل در [`docs/SECOND-DB-INTERNET-ARCHIVE.md`](SECOND-DB-INTERNET-ARCHIVE.md)
> و `r2-relay/internet-archive/`. ریسک «عمومی بودن» که در بخش ۳.۲ همین سند
> آمده، پذیرفته و صادقانه ثبت شد: چون مخزن هم public است، رمزگذاری فقط تمامیت
> میدهد، نه محرمانگی.

---

## ۱. فیلترهایی که از قبل روی این پروژه حاکم است

| فیلتر | منشأ | اثر |
|---|---|---|
| بدون کارت / پرداخت / اشتراک | دستور قبلی صاحب پروژه | R2 و سرویسهای مشابه کنار گذاشته شدند |
| بدون ورسل | «از ورسل استفاده نکن» | ورسل مطلقاً وارد نشد |
| سرویس قبلی تکرار نشود | «دیتابیس دوم دیگر روی سرویس قبلی نباشد» | GitHub (مقصد قدیمی `writeEncryptedBatchToGitHub`) کنار گذاشته شد |
| دیتابیس اصلی Supabase دستنخورده | دستور قبلی | هیچ تغییری روی لاگین/چت/تاریخچه/`rt-*` نیست |
| هیچ رازی تو فرانتاند/سورس/لاگ/مخزن | دستور قبلی | هر سرویس واقعی نیاز به توکن/سشن دارد؛ فقط موقع اجرا و بیرون از مرورگر |
| هیچ حذف/ریست دادهای | «هیچ دادهای حذف یا ریست نشود» | فقط معرفی و تحقیق؛ چیزی پاک یا جابهجا نشد |
| بدون استقرار/ادغام بدون اجازه | دستور قبلی | PR همچنان باز، هیچ دیپلویای انجام نشد |

نکتهٔ فنی مهم: **هیچ کدام از این سرویسها «دیتابیس کوئریپذیر» نیستند**؛
همه انباری فایلاند. مثل مسیر فعلی `maxrubika`، منیفست محلی + Supabase مرجع
خواهند ماند و اینجا فقط محل نگهداری بستههای ciphertext است.

همچنین چون کلاینت این سرویسها پایتون/سرور است، تو مرورگر اجرا نمیشود؛
همان فرآیند محلی که الان `saved_messages.py` را اجرا میکند میتواند این
ترانسپورت را هم بگیرد. قرار دادن توکن تو `index.html` یعنی لو رفتنش.

---

## ۲. جدول مقایسه (عددها از سند رسمی/تحقیق ۲۰۲۶)

| سرویس | حجم رایگان | کارت؟ | API رسمی | خصوصی؟ | مهمترین محدودیت |
|---|---|---|---|---|---|
| **Hugging Face Hub** | **۱۰۰GB خصوصی** + عمومی «best-effort» | خیر | بله (`huggingface_hub` / Hub API + توکن) | بله (private repo) | ساخته شده برای مدل/دیتاست؛ استفاده بهعنوان بکاپ عمومی ممکن است سوءاستفاده تلقی شود |
| **Internet Archive** | عملاً نامحدود؛ توصیه `< ۱TB` هر item، تکفایل `< ۵۰۰GB` | خیر | بله (IAS3، سازگار با S3) | **خیر، همه عمومی** | شرایط استفاده «فقط پژوهش/امور علمی»؛ آیتمها ممکن است حذف شوند؛ صف نوشتن و تأخیر ۲۴ ساعته |
| **TeraBox** | **۱TB (۱۰۲۴GB)** | خیر | **خیر** (فقط API سفارشی با «تماس با ما») | بله ولی بدون E2E | تبلیغات، کندی، سقف ۴GB هر فایل در موبایل، نگرانیهای حریم خصوصی |
| **MEGA** | **۲۰GB** | خیر | بله (SDK رسمی C++ / MEGAcmd) | بله، رمزگذاری سرتاسری | سهمیهٔ انتقال پویا و اعلامنشده؛ حجم کمتر |
| Google Drive | ۱۵GB (مشترک با Gmail/Photos) | خیر | بله (OAuth) | بله | نیاز به پروژهٔ Google Cloud / OAuth |
| pCloud | ۱۰GB (بعضی مراحل لازم است) | خیر | بله (app key) | بله (Crypto پولی) | حجم کمتر |
| GitHub (سرویس قبلی) | ۱۰GiB فضای LFS | خیر | بله | بله | **کنار گذاشته شد**: تکرار سرویس قبلی + توصیهٔ رسمی `< ۱GB` و اکیداً `< ۵GB` برای ریپو + فایل بالای ۱۰۰MB ممنوع |
| Cloudflare R2 | ۱۰GB | **بله** | بله | بله | **کنار گذاشته شد**: فعالسازی از مسیر checkout نیاز به روش پرداخت دارد، حتی برای ردیف رایگان |
| Supabase Storage | همان سرویس اصلی | — | بله | بله | **کنار گذاشته شد**: دیتابیس دوم نباید همان سرویس اصلی باشد |

---

## ۳. جزئیات هر گزینه (صداقت فنی)

### ۳.۱ Hugging Face Hub — پیشنهاد من

سند رسمی «Storage limits» میگوید حساب رایگان **۱۰۰GB فضای مخزن خصوصی**
دارد، برای مخازن عمومی هم «best-effort»، بدون سقف اندازهٔ هر ریپو، با توصیهٔ
تکفایل `< ۲۰۰GB` و سقف سخت `۵۰۰GB` برای هر فایل، و توصیهٔ `< ۱۰۰ هزار فایل`
در هر ریپو. توکنهای دسترسی (`read` / `write` / `fine-grained`) هم سند رسمی
دارند و میشود توکن را محدود به یک ریپو کرد. هیچ کارتی برای ثبتنام لازم نیست.

منابع:
- <https://huggingface.co/docs/hub/en/storage-limits>
- <https://huggingface.co/docs/hub/en/security-tokens>
- <https://huggingface.co/docs/hub/en/enterprise> (تأیید ۱۰۰GB خصوصی برای Free)

**اما صادقانه:** همان سند مینویسد این فضا «برای جامعهٔ هوش مصنوعی» است،
برای مخازن عمومی «جلوگیری از سوءاستفاده» دارد و از کاربران میخواهد محتوای
حجیم «واقعاً برای دیگران مفید» باشد. یعنی ریختن بستههای رمزشدهٔ بکاپ شخصی
تو مخزن **عمومی**، استفادهٔ خارج از هدف سرویس است. راه درست: مخزن **خصوصی**
با توکن `fine-grained` محدود به همان ریپو، و محتوا همان AES-256-GCM فعلی
(یعنی حتی سرویس هم فقط ciphertext میبیند).

### ۳.۲ Internet Archive — بزرگترین، ولی بی ربط به بکاپ خصوصی

IAS3 یک API رسمی سازگار با S3 است (`https://s3.us.archive.org`)، کلیدها از
`https://archive.org/account/s3.php` گرفته میشوند، و حساب رایگان است بدون
کارت. سند رسمی آپلود میگوید تکفایل نباید از حدود ۵۰۰ تا ۷۰۰GB بیشتر شود و
هر item بهتر است `< ۱۰ هزار فایل` و `< ۱TB` باشد؛ یعنی عملاً فضای خیلی
بیشتری از بقیه.

منابع:
- <https://rclone.org/internetarchive/> (backend رسمی rclone، آدرس IAS3، کلیدها، صف پردازش)
- <https://help.archive.org/help/uploading-troubleshooting/>
- <https://archive.org/about/terms.php>

**اما سه مشکل جدی:** (۱) هر چیزی که آپلود شود **عمومی** است و نام item بعداً
قابل تغییر نیست؛ (۲) شرایط استفاده میگوید دسترسی «فقط با هدف پژوهش و مطالعهٔ
علمی» است و FAQ قدیمی صریحاً مینویسد «شرایط استفادهٔ ما بکاپ برای عموم را
پوشش نمیدهد»؛ (۳) همان سند رسمی میگوید آیتمهای ناقض شرایط **حذف میشوند**،
نوشتنها تو صف قرار میگیرند، ایندکس شدن تا ۲۴ ساعت طول میکشد و ممکن است
`503-slowdown-spam` بدهد. پس «همیشگی و تضمینشده» نیست. رمزگذاری محتوا را
خصوصی میکند، ولی متادیتا/وجود فایل/نام item عمومی میماند.

### ۳.۳ TeraBox — بیشترین عدد، بدون API خودسرویس

سایت رسمی «1024GB Cloud Storage» و «Network disk capacity limited to
1024GB» را برای پلن رایگان تأیید میکند؛ بدون کارت، با اپ ویندوز/مک/لینوکس/
اندروید/آیفون و وب. پلن رایگان تبلیغات دارد، سرعت محدود است و سقف آپلود تکفایل
در موبایل ۴GB (در PC حدود ۲۰GB) است؛ آپلود ۱۲۸GB و «Encrypted space» مال
پلن پولیاند.

منابع:
- <https://www.terabox.com/>
- <https://www.terabox.com/integrations>
- <https://www.saasworthy.com/product/terabox> («Does Terabox provide API? No»)
- <https://buttondown.com/flexoba/archive/terabox-review-2026-1tb-free-worth-it/>

صفحهٔ Integration فقط «Account Association / File Management / Transmission /
Sharing» را برای **شرکتها** با «Contact us» و «customized API solution tailored
for you» معرفی میکند؛ یعنی API عمومی self-serve در دسترس نیست. نتیجه: یا آپلود
دستی از طریق اپ، یا اتوماسیون غیررسمی/مهندسی-معکوس — همان کاری که تو فاز
روبیکا گفتیم نمیخواهیم و ادعای «API رسمی»ش دروغ است. علاوه بر این، نبود
رمزگذاری سرتاسری و نگرانیهای حریم خصوصی/تبلیغات را چند منبع مستقل ذکر کردهاند.

### ۳.۴ MEGA — کمترین ریسک، حجم متوسط

۲۰GB رایگان، بدون کارت، بدون تاریخ انقضا، با رمزگذاری سرتاسری حتی تو پلن
رایگان. SDK رسمی C++ و `MEGAcmd` وجود دارد، یعنی API «واقعی» است، نه حدسی
(کتابخانهٔ قدیمی `mega.py` خودش رسماً منسوخ شده و به SDK ارجاع میدهد).
عیبش: سهمیهٔ انتقال (bandwidth) پویا و عدد اعلامنشده — دانلود/اشتراک زیاد
میتواند موقتاً بلاک شود — و اینکه SDK بومی است، یعنی سبکتر از یک REST ساده
نیست.

منابع:
- <https://mega.io/developers>
- <https://github.com/meganz/sdk>
- <https://github.com/meganz/MEGAcmd>
- <https://blog.mega.io/best-free-cloud-storage>
- <https://ai-refresh.com/tech-help/cloud-storage-free-plans/>

### ۳.۵ چرا GitHub و R2 را نیاوردیم

- GitHub همان سرویس قبلی دیتابیس دوم بود (`writeEncryptedBatchToGitHub` در
  `api/sync.js`) و گفتهاید نباید تکرار شود. تازه سند رسمی هم `۱۰GiB` فضای
  LFS رایگان میدهد، ولی توصیه میکند ریپو `< ۱GB` و اکیداً `< ۵GB` باشد و
  فایل بالای `۱۰۰MB` را رد میکند؛ یعنی اساساً جای بکاپ حجیم نیست.
  منابع: <https://docs.github.com/en/billing/concepts/product-billing/git-lfs>،
  <https://docs.github.com/en/billing/reference/product-usage-included>،
  <https://compresto.app/blog/github-file-size-limit>
- R2 رایگانش `۱۰GB` است، ولی فعالسازی از مسیر checkout نیاز به روش پرداخت
  (کارت/PayPal) دارد، حتی اگر هرگز از ردیف رایگان خارج نشوید. چون خط قرمز
  «بدون کارت» سر جایش است، کنار گذاشته شد. (یک منبع میگوید فوراً کارت لازم
  نیست، ولی اسناد رسمی و چند منبع دیگر خلافش را میگویند؛ ما محتاطانه کنار
  گذاشتیم.)
  منابع: <https://agentdeals.dev/vendor/cloudflare-r2>،
  <https://cityuderek.com/fa-docs/cloudflare/cloudflare-r2-free-tier-vs-s3>،
  <https://developers.cloudflare.com/r2/pricing/>

---

## ۴. توصیه

| اگر هدفت… | برو سراغ |
|---|---|
| حجم زیاد **+ خصوصی + API رسمی + بدون کارت** | **Hugging Face، مخزن private، توکن fine-grained** |
| حداکثر حجم ممکن و عمومی بودن مهم نیست | Internet Archive (با قبول ریسک ToS/حذف) |
| بیشترین عدد تبلیغشده، حتی بدون API | TeraBox (فقط آپلود دستی) |
| حریم خصوصی قوی و قابلاعتماد، حجم متوسط | MEGA |

پیشنهاد من برای **ادامهٔ همین پروژه**: Hugging Face خصوصی. دلیلش اینکه
همان معماری فعلی (`SavedMessagesDriver` و ترانسپورت تزریقشده) فقط کافیست یک
ترانسپورت تازه بگیرد؛ بستههای رمزشدهٔ `MCPK1`/`MCR1` همانطور میمانند، منیفست
محلی و Supabase مرجع میمانند، و هیچ رازی تو سورس/مرورگر قرار نمیگیرد
(توکن فقط موقع اجرا، تو فرآیند پایتونی محلی). صفر حذف، صفر تغییر زنده.

---

## ۵. کارهایی که **انجام نشد** (ادعا نمیشود)

- هیچ حسابی ساخته نشد، هیچ ایمیل/توکن/کلید/پسوردی وارد چت، سورس یا مخزن نشد.
- هیچ آپلود واقعی، لاگین، تماس API، یا تست شبکهای به این سرویسها انجام نشد.
- دسترسپذیری این سرویسها از ایران/شبکهٔ تو تست **نشده**؛ نمیتوانم تضمینش کنم.
- هیچ استقرار، ادغام PR، تغییر `index.html`/CSP/`MC_API`/Edge، خاموش کردن
  Supabase، حذف ردیف، ریست، ورسل، یا تغییر ظاهر/لاگین/پیامها انجام نشد.
- عددهای بالا مربوط به زمان تحقیقاند و ممکن است عوض شوند؛ قبل از تصمیم نهایی
  دوباره سند رسمی چک میشود.
- هیچکدام از اینها «دیتابیس دوم کوئریپذیر» نیستند؛ SQL/تراکنش/ایندکس/OTP/
  realtime نمیدهند.

PR #1 همچنان **OPEN** و merge نشده. شاخهٔ کار: `arena/6b6dad2d-memechat`.

---

## ۶. فهرست منابع

1. Hugging Face — Storage limits: <https://huggingface.co/docs/hub/en/storage-limits>
2. Hugging Face — User access tokens: <https://huggingface.co/docs/hub/en/security-tokens>
3. Hugging Face — Team & Enterprise plans: <https://huggingface.co/docs/hub/en/enterprise>
4. Internet Archive — Terms of Use: <https://archive.org/about/terms.php>
5. Internet Archive — Uploading troubleshooting: <https://help.archive.org/help/uploading-troubleshooting/>
6. rclone — Internet Archive / IAS3: <https://rclone.org/internetarchive/>
7. Internet Archive — FAQ (بکاپ عمومی تحت پوشش نیست): <https://web.archive.org/web/20140402223358/https:/archive.org/about/faqs.php>
8. TeraBox — صفحهٔ اصلی: <https://www.terabox.com/>
9. TeraBox — Integration: <https://www.terabox.com/integrations>
10. SaaSWorthy — «Does Terabox provide API? No»: <https://www.saasworthy.com/product/terabox>
11. TeraBox Review 2026: <https://buttondown.com/flexoba/archive/terabox-review-2026-1tb-free-worth-it/>
12. MEGA — SDK رسمی: <https://mega.io/developers>
13. MEGA — مخزن C++ SDK: <https://github.com/meganz/sdk>
14. MEGA — MEGAcmd: <https://github.com/meganz/MEGAcmd>
15. MEGA — Best free cloud storage 2026: <https://blog.mega.io/best-free-cloud-storage>
16. Cloud storage free plans 2026 (سهمیهٔ انتقال پویای MEGA): <https://ai-refresh.com/tech-help/cloud-storage-free-plans/>
17. GitHub Docs — Git LFS billing: <https://docs.github.com/en/billing/concepts/product-billing/git-lfs>
18. GitHub Docs — Product usage included: <https://docs.github.com/en/billing/reference/product-usage-included>
19. GitHub file size limits: <https://compresto.app/blog/github-file-size-limit>
20. Cloudflare R2 free tier / نیاز به پرداخت: <https://agentdeals.dev/vendor/cloudflare-r2>
21. Cloudflare R2 pricing رسمی: <https://developers.cloudflare.com/r2/pricing/>
22. مقایسهٔ کلی فضای رایگان ۲۰۲۶: <https://www.cloudstorageexplorer.com/best-free-cloud-storage>
