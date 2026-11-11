# memechat

شاخهٔ کاری `arena/6b6dad2d-memechat`. سایت زنده، لینک Pages و دیتابیس اصلی
Supabase دستنخوردهاند.

تازهترین تغییر معماری: **دیتابیس دوم → پیامهای ذخیرهشدهٔ روبیکا با
MAXRubika**. درخواست «فایلای بله رو پاک کن / بریم یه پیامرسان دیگه / مثلا
با maxrubika و سیو مسیج روبیکا اوکیش کن» اجرا شد: تمام فایلها و اسناد بله
حذف شدند، مسیر قدیمی روبیکای دستی سالم برگشت، و مسیر تازه
[`r2-relay/maxrubika/`](r2-relay/maxrubika/README.md) ساخته و تست شد.
بررسی کامل، محدودیتهای صادقانه، منابع و فهرست فایلها:
[`docs/SECOND-DB-MAXRUBIKA.md`](docs/SECOND-DB-MAXRUBIKA.md).
سند مسیر دستی قدیمی هم سر جایش است:
[`docs/SECOND-DB-RUBIKA.md`](docs/SECOND-DB-RUBIKA.md).

بدون توکن بات، بدون API رسمی روبیکا، بدون ورسل، بدون هیچ حذف ردیفی؛ Supabase
(دیتابیس اصلی)، لاگین، چت و تاریخچه دستنخوردهاند. `maxrubika` یک کتابخانهٔ
غیررسمی/self-bot پایتونی است که یکبار لاگین شماره + کد تأیید روی دستگاه
خودتان میخواهد و تو مرورگر اجرا نمیشود؛ هیچ راز/OTPـای وارد چت، سورس یا
مخزن نشد.

**تازهترین انتخاب: Internet Archive.** صاحب پروژه گفت «من internet archive
رو انتخاب میکنم / ولی رمز گزاری متفاوت و کلیدش توی سورس کدها باشه فقط».
مسیر [`r2-relay/internet-archive/`](r2-relay/internet-archive/README.md)
ساخته و تست شد: **ChaCha20-Poly1305** (متفاوت از AES-256-GCM)، کلید ثابت
**فقط داخل سورس**، بستهٔ باینری `MCIA1`، و API رسمی IAS3. سند کامل:
[`docs/SECOND-DB-INTERNET-ARCHIVE.md`](docs/SECOND-DB-INTERNET-ARCHIVE.md).

⚠️ صداقت: مخزن عمومی است و آیتمهای IA «World readable»اند، پس کلید داخل
سورس محرمانگی نمیدهد (فقط تمامیت). کلید حساب IAS3 داخل سورس نیست و بدون آن
هیچ آپلود واقعی انجام نشد. صفر حذف/ریست، Supabase بدون تغییر، بدون ورسل و
بدون استقرار.

**لایهٔ قابلخواندن (`0.7.0`):** بنا به درخواست «کلمات رو تبدیل کنن به یه
کلمهٔ دیگه، اینجوری میشه readable»، [`codebook.mjs`](r2-relay/internet-archive/codebook.mjs)
ساخته شد: ۲۵۶ واژهٔ فارسی + جایگشت Sattolo (مثلاً `آب → گچ`)، **روی**
همان بستهٔ ChaCha20-Poly1305، نه بهجای آن. سند:
[`docs/READABLE-CODEBOOK.md`](docs/READABLE-CODEBOOK.md). قابلخواندن بله،
امن خیر، معنیدار خیر، حجم ~۹ برابر؛ پیشفرض باینری تغییر نکرد. ۲۲ تست سبز.

**تحقیق تکمیلی: API رسمی TeraBox (`0.8.0`).** بنا به پرسش «میشه api تراباکس
رو پیدا کنی که با دوتا اکانت لاگین کنم بعد api شون رو بگیرم»،
[سند رسمی Open Platform](https://www.terabox.com/integrations/docs) پیدا و
بررسی شد: **API رسمی وجود دارد، ولی self-service نیست** — `client_id` /
`client_secret` / `private_secret` فقط بعد از تأیید شرکتی TeraBox صادر
میشوند، و لاگین هر حساب فقط یک `access_token` + `refresh_token` میدهد،
نه «API کی». دو GET خواندنی با مقدار نامعتبر، زندهبودن endpointها را تأیید
کرد (`100001 unknown client` / `200002 invalid access_token`). کلاینت آفلاین
[`r2-relay/terabox/`](r2-relay/terabox/README.md) دو حساب مستقل، refresh
یکبارمصرف و آپلود سهمرحلهای را تست میکند؛ بدون لاگین/توکن/کلید واقعی، بدون
جمع کردن سهمیه (ToS ممنوعش کرده)، بدون حذف. سند کامل:
[`docs/TERABOX-OPEN-PLATFORM.md`](docs/TERABOX-OPEN-PLATFORM.md). **مقصد دوم
همچنان Internet Archive است** و چیزی جابهجا نشد.

**پیشبرد MAXRubika (`0.9.0`):** بنا به «اون مکس روبیکا رو پیش ببریم که فایلای
دیتا بیس رو رمز گزاری بفرسته توی سیو مسیج»، ورودی دیگه بایت تصادفی نیست:
**فایلهای دیتابیس** (همان جدولها/فیلدها/ردیفها) یکییکی AES-256-GCM میشوند →
`MCPK1` → متنهای `MCR1` → یک outbox رمزشده در `maxrubika/out/` →
`saved_messages.py send-outbox` → برگشت و رمزگشایی + تأیید SHA در
[`r2-relay/maxrubika/`](r2-relay/maxrubika/README.md). متنی که روبیکا میبیند
**فقط ciphertext** است؛ صفر حذف، بدون تغییر Supabase، و مقصد دوم IA سر جایش
است. سند: [`docs/SECOND-DB-MAXRUBIKA.md`](docs/SECOND-DB-MAXRUBIKA.md) بخش ۹.

**«شمارم بدم؟» → خیر.** چیزی که لازم است شماره نیست، **سشن محلی** است؛ لاگین
اولیهٔ MAXRubika روی دستگاه صاحب پروژه انجام میشود و کانکتور فقط نام سشن را
از `MC_MAXRUBIKA_SESSION` میخواند. این محیط به سرورهای روبیکا وصل نمیشود،
پس شماره/کد تأیید هیچ قدمی جلو نمیبرد و وارد چت/سورس/لاگ نشد.

تحقیق مقایسهای که منجر به انتخاب IA شد (همراه تصحیح بخش TeraBox):
[`docs/STORAGE-CANDIDATES.md`](docs/STORAGE-CANDIDATES.md).
