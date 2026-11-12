# دیتابیس دوم → «پیامهای ذخیرهشدهٔ روبیکا» با MAXRubika

**درخواست:** «فایلای بله رو پاک کن / بریم یه پیامرسان دیگه / مثلا با
maxrubika و سیو مسیج روبیکا اوکیش کن».

**نتیجهٔ کوتاه:** بله بهطور کامل حذف شد، معماری قدیمی روبیکای دستی سالم
برگشت، و مسیر تازه **ساخته و تست شد**: فایلهای رمزشده → بستههای `MCPK1` →
متنهای `MCR1` → **Saved Messages خودتان در روبیکا** → برگشت و تأیید SHA-256.
بدون توکن بات، بدون API رسمی روبیکا، بدون ورسل، بدون حذف هیچ ردیفی.

---

## ۱. چی پاک شد (و چی نه)

| عمل | فایلها |
|---|---|
| حذف کامل | `r2-relay/bale/*` (۵ فایل)، `r2-relay/client/bale-direct.js`، `r2-relay/primary/*` (۷ فایل)، `docs/MESSENGER-API-BALE.md`، `docs/PRIMARY-DB-BALE.md` |
| بازگردانی به نسخهٔ قبلِ بله (`354e7f3`) | `r2-relay/client/storage-adapter.js`، `r2-relay/tests/run.mjs`، `r2-relay/rubika/{adapter,cli}.mjs`، `r2-relay/rubika/tests/run.mjs`، `r2-relay/package.json`، `r2-relay/README.md`، `README.md`، `docs/SECOND-DB-RUBIKA.md`، `r2-relay/.gitignore` |
| اضافهٔ تازه | `r2-relay/maxrubika/*` (۴ فایل + ۲ تست)، `docs/SECOND-DB-MAXRUBIKA.md` |

بعد از پاکسازی **هیچ فایل یا ماژول باقیماندهای از بله** در مخزن نماند؛
فقط چند اشارهٔ تاریخی (همین جدول، `r2-relay/README.md` و یک عبارت تست)
نامشان را آوردهاند. تستهای قدیمی دوباره سبز شدند: `13 + 7`.

**هیچ دادهای پاک نشد:** اینها فایلهای سورساند، نه ردیفهای دیتابیس. هیچ
`DELETE` / `DROP` / `TRUNCATE` / `RESET` اجرا نشد، Supabase زنده دستنخورده
است، آرشیو قدیمی GitHub و ردیفهای قدیمی سر جایشاناند. فایلهای حذفشده هم
تو تاریخچهٔ گیت قابل برگشتاند.

---

## ۲. `maxrubika` چیه (تحقیق واقعی، نه حدس)

| منبع | نتیجه |
|---|---|
| [1](https://github.com/MEH2RAB/maxrubika) | کتابخانهٔ Python async برای روبیکا و شاد؛ هم `Bot` و هم `Messenger` (یوزربات/self-bot) |
| [6](https://pypi.org/project/maxrubika/1.15.0/) | روی PyPI منتشر شده، MIT، `pip install maxrubika`؛ تگها صریحاً `userbot` / `self-bot` |
| [7](https://github.com/imhamiddev/GitHub-Release-Downloader-Rubika) | نمونهٔ واقعی: سرویسی که با حساب شخصی، فایلها را مستقیم تو **Saved Messages** میریزد |
| [2](https://github.com/caffeinexz/Tele2Rub) | نمونهٔ واقعی `Tele2Rub`: فایلها → Saved Messages روبیکا، با سشن `rubsession` |
| [11](https://meh2rab.github.io/maxrubika/client-messages-send/) | `send_message(chat="me", text=...)` = پیامهای ذخیرهشده |
| [12](https://meh2rab.github.io/maxrubika/client-messages-fetch/) | `get_last_messages` / `get_chat_messages` / `search_messages` |
| [13](https://meh2rab.github.io/maxrubika/ai/) | دستورالعمل رسمی پکیج: «قبل از کد، مستندات کامل را بخوان؛ هیچ متدی نساز» |

من علاوه بر مستندات، **whl واقعی پکیج را از PyPI گرفتم و سورسش را خواندم** تا
اسم متدها تأیید شود:

```text
send_message(chat, text, ...)  →  if chat.lower() in ('me','cloud','self','myself'):
                                      chat_guid = self.guid
send_file(chat, file, text, ...)   →  send_message(... file_inline=file, type='File')
get_last_messages(chat, limit)     →  request('getMessages', ...)
get_chat_messages(chat, ...)       →  request('getMessages', ...)
Messenger(session)                 →  with Messenger("mySession") as app
```

### نکتهای که تو مستندات نبود و از سورس پیدا کردم

`send_message("me")` درست کار میکند، ولی `get_last_messages` / `get_chat_messages`
از `get_guid(chat)` رد میشوند و **`get_guid("me")` پشتیبانی نمیشود** (بهعنوان
username تلقی میشود). پس خواندن برگشت حتماً با **`app.guid`** انجام میشود.
این مورد تو `saved_messages.py` و تستها صریحاً ثبت شده؛ متد خیالی نساختیم.

---

## ۳. صداقت دربارهٔ محدودیتها (مهم)

| موضوع | واقعیت |
|---|---|
| API رسمی روبیکا | ❌ استفاده **نشده**. MAXRubika یک کلاینت **غیررسمی / self-bot** روی پروتکل خصوصی روبیکاست |
| توکن بات | ❌ لازم **نیست**. خبری از `@botfather` و توکن نیست؛ سشن حساب شخصی جایگزین است |
| لاگین | ⚠️ **یکبار** شماره تلفن + کد تأیید (SMS/تماس/اعلان) + احتمالاً رمز دو مرحله، **روی دستگاه خودتان**؛ فایل سشن محلی ساخته میشود. اینجا از کسی چیزی نپرسیدیم، نساختیم، ذخیره نکردیم |
| پایداری | ⚠️ پروتکل خصوصی/مهندسی-معکوس است؛ ممکن است با آپدیت روبیکا بشکند. **self-bot میتواند خلاف شرایط سرویس باشد**. ادعای پایداری یا تأیید رسمی نمیکنیم |
| اجرا تو مرورگر | ❌ پایتون است، تو frontend اجرا **نمیشود**. برخلاف مسیر قبلی «API داخل سورس کلاینت»، اینجا یک فرآیند محلی/سرور خودتان لازم است. ولی **بدون ورسل، بدون دیپلوی، بدون بکاند عمومی** |
| کلیدها | ✅ فقط **نام سشن** از `MC_MAXRUBIKA_SESSION` خوانده میشود. هیچ auth/private_key/OTP/توکنی تو سورس، فرانتاند، لاگ، چت یا مخزن نیست |
| دیتابیس اصلی | ✅ Supabase بدون تغییر؛ لاگین، OTP، چت، تاریخچه، `rt-*` دستنخورده |
| حذف | ✅ صفر. `delete_messages` عمداً صدا زده نمیشود؛ پیامهای قدیمی Saved Messages میمانند |
| دیتابیس واقعی | ❌ **باز هم دیتابیس نیست.** Saved Messages جای نگهداری بستههای ciphertext است، نه کوئری/تراکنش/ایندکس. مرجع همچنان منیفست محلی + Supabase |

---

## ۴. فایلهای کامل تحویلشده

| فایل | کار |
|---|---|
| `r2-relay/maxrubika/adapter.mjs` | `SavedMessagesDriver`، کدگذاری `MCR1` (`_`→`%5F`)، گروهبندی بستهها بر اساس `id`، `publishForSavedMessages`، `verifySavedMessagesDelivery`، `roundTrip` با SHA-256 |
| `r2-relay/maxrubika/saved_messages.py` | کانکتور واقعی پایتون: `Messenger` / `send_message(chat="me")` / `send_file` / `get_last_messages` + `send_outbox` / `roundtrip_outbox` / `receive_to_file`، حالت آفلاین `FixtureMessenger`، فقط نام سشن از env |
| `r2-relay/maxrubika/database-files.mjs` | **تازه (۰.۹.۰):** فایلهای دیتابیس → `publishDatabaseFiles` → outbox رمزشده، و `verifyDatabaseFiles` با برگشت/رمزگشایی |
| `r2-relay/maxrubika/cli.mjs` | `export` / `verify` / `status` / `trial --fixture` / `help` |
| `r2-relay/maxrubika/tests/run.mjs` | ۱۶ تست Node آفلاین |
| `r2-relay/maxrubika/tests/test_saved_messages.py` | ۱۴ تست Python آفلاین |
| `docs/SECOND-DB-MAXRUBIKA.md` | همین سند |

نمونهٔ اجرای آفلاینی که همین الان انجام شد (مسیر قدیمی `trial`):

```text
مقصد: rubika-saved-messages | چت: me | حالت: fixture
تکهها: 4 | پیام فرستادهشده: 8
برگشت و تأیید SHA: true | بچهای تأییدشده: 4
فایل رمزشده موبرهمو: true
حذف/ریست: false | عملیات مخرب: 0
```

نمونهٔ اجرای آفلاینی مسیر **فایلهای دیتابیس** (۰.۹.۰):

```text
فایلهای دیتابیس آماده و رمزشده شدند | منبع: جدولهای ساختگی (آفلاین)
تعداد فایلها: 2 | ردیفها: mimchat_staging_outbox.json=2, mimchat_staging_messages.json=2
الگوریتم: AES-256-GCM | بستهها: 7 | پیشوند: MCR1.
بررسی نشت plaintext در متنها: true
وضعیت: sent-pending-verification | تأیید نهایی هنوز انجام نشده | حذف/ریست: false

python roundtrip-outbox → {"ok":true,"sent":7,"received":7,"deleted":false}

تأیید outbox | منبع پیامها: فایل برگشتی
برگشت بستهها و SHA: true | پیامهای برگشتی: 7
  mimchat_staging_outbox.json: ✅ ردیفها=2 | بایت=1029
  mimchat_staging_messages.json: ✅ ردیفها=2 | بایت=1952
نتیجهٔ کل: true | رمزگشایی: AES-256-GCM | حذف/ریست: false
```

---

## ۵. اجرای واقعی (روی دستگاه خودتان)

```bash
pip install maxrubika
export MC_MAXRUBIKA_SESSION="mySession"   # فقط نام سشن؛ لاگین یکباره تعاملی
python3 r2-relay/maxrubika/saved_messages.py status
python3 r2-relay/maxrubika/saved_messages.py receive 100
```

لاگین اولیه را خود کتابخانه بهصورت تعاملی میپرسد (شماره + کد)؛ آن مقادیر
**هرگز** وارد چت، سورس یا مخزن نمیشوند. اگر `MC_MAXRUBIKA_SESSION` تنظیم
نباشد، کانکتور صادقانه در حالت `fixture` میماند و هیچ تماس شبکهای نمیزند.

---

## ۶. تستها

```bash
node r2-relay/tests/run.mjs                                  # 13 tests passed
node r2-relay/rubika/tests/run.mjs                            #  7 tests passed
node r2-relay/maxrubika/tests/run.mjs                         # 16 tests passed
node r2-relay/internet-archive/tests/run.mjs                  # 22 tests passed
node r2-relay/terabox/tests/run.mjs                           # 19 tests passed
python3 -m unittest discover -s r2-relay/maxrubika/tests -v   # 14 tests passed
npm --prefix r2-relay run test:all                            # 77 تست JS سبز
```

---

## ۷. چی انجام **نشد** (ادعا نمیشود)

- ❌ هیچ استقرار، ادغام PR، تغییر `index.html`/CSP/`MC_API`/Edge زنده.
- ❌ هیچ لاگین واقعی، شماره، کد تأیید، OTP، سشن واقعی یا تماس به روبیکا
  (حتی در نسخهٔ ۰.۹.۰؛ شماره خواسته نشد و وارد چت/سورس/لاگ نشد).
- ❌ هیچ توکن بات، ورسل، API رسمی روبیکا، scraping یا بکاند عمومی.
- ❌ هیچ حذف ردیف/بچ/پیام؛ `delete_messages` صدا زده نشد.
- ❌ هیچ ادعای «روبیکا شد دیتابیس کوئریپذیر» یا «بله شد دیتابیس اصلی».
- ❌ هیچ تغییری تو ظاهر سایت، لاگین، پیامها یا لینکها.

PR #1 همچنان **OPEN** و merged نشده.

---

## ۸. منابع

1. مخزن رسمی MAXRubika — <https://github.com/MEH2RAB/maxrubika>
2. `Tele2Rub` (فایل → Saved Messages روبیکا) — <https://github.com/caffeinexz/Tele2Rub>
3. `GitHub-Release-Downloader-Rubika` (حساب شخصی + Saved Messages) — <https://github.com/imhamiddev/GitHub-Release-Downloader-Rubika>
4. MAXRubika روی PyPI — <https://pypi.org/project/maxrubika/>
5. Context7 / نمایهٔ مستندات — <https://context7.com/meh2rab/maxrubika>
6. صفحهٔ PyPI نسخهٔ ۱.۱۵.۰ (تگهای `userbot`/`self-bot`) — <https://pypi.org/project/maxrubika/1.15.0/>
7. مستندات رسمی: ارسال پیام و مدیا (`chat="me"`) — <https://meh2rab.github.io/maxrubika/client-messages-send/>
8. مستندات رسمی: دریافت و جستجوی پیام — <https://meh2rab.github.io/maxrubika/client-messages-fetch/>
9. مستندات رسمی: مثالها (`with Messenger("mySession") as app`) — <https://meh2rab.github.io/maxrubika/client-examples/>
10. مستندات رسمی: پراپرتیها — <https://meh2rab.github.io/maxrubika/client-properties/>
11. دستورالعمل رسمی «برای AI: هیچ متدی نساز» — <https://meh2rab.github.io/maxrubika/ai/>
12. FNC Rubika (کتابخانهٔ مشابه، تأیید نیاز به سشن حساب شخصی) — <https://hamidrezabakhshi8118.github.io/>
13. سند قبلی دیتابیس دوم — `docs/SECOND-DB-RUBIKA.md`

---

## ۹. پیشبرد «فایلهای دیتابیس رمزشده → سیو مسیج» (۰.۹.۰)

**درخواست:** «خب اون مکس روبیکا رو پیش ببریم که فایلای دیتا بیس رو رمز گزاری
بفرسته توی سیو مسیج / شمارم بدم؟»

### ۹.۱ «شمارم بدم؟» — خیر، الان لازم نیست و فایدهای هم ندارد

| پرسش | پاسخ |
|---|---|
| لاگین با شماره، «API» میدهد؟ | خیر. MAXRubika کتابخانهٔ غیررسمی/self-bot است؛ لاگین اولیه (شماره + کد تأیید + احتمالاً رمز دومرحلهای) **روی دستگاه خودتان** یک **فایل سشن محلی** میسازد. کانکتور فقط **نام** آن سشن را از `MC_MAXRUBIKA_SESSION` میخواند. |
| من اینجا میتوانم لاگین کنم؟ | خیر. این محیط فقط به `github.com` / `registry.npmjs.org` / `pypi.org` و توابع Git دسترسی شبکهای دارد؛ **هیچ تماسی با سرورهای روبیکا ممکن نیست**. حتی با شماره هم ارسال واقعی انجام نمیشود. |
| چرا کد تأیید را نگیریم؟ | کوتاهعمر و یک اعتبارنامهٔ زنده است؛ آمدنش تو چت یعنی ماندن یه راز تو لاگ، بدون اینکه هیچ قدمی جلو برود. شماره/OTP/private_key هرگز وارد چت، سورس، لاگ، فرانتاند یا مخزن نشد. |
| پس چه چیزی لازم است؟ | برای **آمادهسازی و تأیید**: هیچچیز. برای **ارسال واقعی**: فقط همان سشن محلی روی دستگاه صاحب پروژه — نه شماره تو چت. |
| ریسک؟ | self-bot روی حساب شخصی ممکن است خلاف شرایط سرویس روبیکا باشد؛ پروتکل خصوصی است و ممکن است بشکند. ادعای پایداری/تأیید رسمی نمیکنیم. |

### ۹.۲ چی اضافه شد (بدون دست زدن به معماری قبلی)

| مرحله | قبل | الان |
|---|---|---|
| ورودی | `randomBytes(4096)` | **فایلهای خروجی دیتابیس**: یک JSON بهازای هر جدول، با همان `TABLES` / فیلدها / ردیفهای `rubika/adapter.mjs` |
| رمزگذاری | همان `publishEncrypted` | همان AES-256-GCM، ولی **بهازای هر فایل جداگانه** با `aad` جدا (`memechat-db-files-saved-messages:<outbox>:<file>`) |
| خروجی | بستهها تو حافظه | **outbox ماندگار**: `saved-<id>.json` (منیفست + متنها) و `saved-<id>.txt` (`maxrubika/out/`، gitignored) |
| ارسال | فقط fixture درون Node | `saved_messages.py send-outbox` / `roundtrip-outbox` همان متنهای `MCR1` را تحویل `send_message(chat="me")` میدهد |
| برگشت | `verifySavedMessagesDelivery` | `verify --received` متنهای برگشتی را میگیرد، بستهها را join میکند، **رمزگشایی** میکند و SHA/بایت/تعداد ردیف هر فایل را مقایسه میکند |
| صداقت وضعیت | `status: confirmed` بلافاصله | outbox صریحاً `sent-pending-verification` + `deliveryVerified:false` + `verificationRequired:true` است؛ منیفست داخلی هم همین پرچمها را گرفت |

**قانون «هیچ دادهای حذف/ریست نشود» همچنان پابرجاست:** `delete()` همچنان خطا
میدهد، `delete_messages(` صدا زده نمیشود، `destructiveOperations: []`،
`retainedInPrimary: true`، و نسخهٔ محلی هر تکه هنگام `put` نگه داشته میشود
(`stage/...` و `blob/<sha>`). تأیید خراب → فقط `verified:false`، بدون پاک کردن.

### ۹.۳ اثبات اینکه روبیکا فقط ciphertext میبیند

متن هر پیام دقیقاً `MCR1.MCPK1.<base64url>.<base64url>` است. آلفابت
base64url فقط `A-Za-z0-9-_` است، بنابراین **هیچ** نویسهٔ JSON (`:`، `{`،
`}`، `"`, فاصله) و هیچ رشتهٔ ردیف جدول (`mimchat_staging_messages`،
`سلام`، `آرشیو`) داخل پیامها نیست. تست `assertCiphertextOnly` و تست نشت
ردیفها این را بهصورت خودکار چک میکنند. outbox خودش فقط متادیتا + ciphertext
دارد، plaintext ندارد.

### ۹.۴ حلقهٔ کاملی که **بدون شماره/لاگین** اجرا و سبز شد

```
export --fixture       → 2 فایل، 7 بسته MCR1، بررسی نشت plaintext: true
roundtrip-outbox       → {"ok":true,"sent":7,"received":7,"deleted":false}
verify --received      → برگشت SHA: true | هر دو فایل ✅ | نتیجهٔ کل: true
```

همچنین تست شد: کم شدن یک بسته → `ok:false` ولی `deleted:false`؛ کلید اشتباه
→ بستهها سالم برگشتند ولی رمزگشایی رد شد، باز هم صفر حذف.

### ۹.۵ چی انجام **نشد** (همچنان ادعا نمیشود)

- هیچ شماره، کد تأیید، OTP، لاگین، سشن واقعی، `auth`/`private_key` یا تماس
  شبکهای به روبیکا.
- هیچ SELECT/نوشتن/حذف روی Supabase زنده؛ جدولها ساختگیاند. لاگین، چت،
  تاریخچه، ظاهر، `MC_API`، Edge و CSP دستنخورده.
- هیچ جابهجایی مقصد دوم: Internet Archive (و `docs/READABLE-CODEBOOK.md` و
  تحقیق TeraBox) سر جایند؛ `maxrubika` یک مسیر اضافه است.
- هیچ استقرار، دیپلوی، مرج، ورسل، توکن بات یا API رسمی روبیکا.
- هیچ ادعای «روبیکا شد دیتابیس کوئریپذیر»؛ همچنان فقط حامل ciphertext است،
  مرجع منیفست محلی + Supabase است.

PR #1 همچنان **OPEN** و merge نشده.
