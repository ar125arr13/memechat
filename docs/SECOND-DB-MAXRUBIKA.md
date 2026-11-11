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

بعد از پاکسازی `grep -rni bale` روی کل مخزن **صفر نتیجه** داد. تستهای
قدیمی دوباره سبز شدند: `13 + 7`.

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
| `r2-relay/maxrubika/saved_messages.py` | کانکتور واقعی پایتون: `Messenger` / `send_message(chat="me")` / `send_file` / `get_last_messages`، حالت آفلاین `FixtureMessenger`، فقط نام سشن از env |
| `r2-relay/maxrubika/cli.mjs` | `status` / `trial --fixture` / `help` — تست کامل رمز → ارسال → برگشت → تأیید |
| `r2-relay/maxrubika/tests/run.mjs` | ۸ تست Node آفلاین |
| `r2-relay/maxrubika/tests/test_saved_messages.py` | ۹ تست Python آفلاین |
| `docs/SECOND-DB-MAXRUBIKA.md` | همین سند |

نمونهٔ اجرای آفلاینی که همین الان انجام شد:

```text
مقصد: rubika-saved-messages | چت: me | حالت: fixture
تکهها: 4 | پیام فرستادهشده: 8
برگشت و تأیید SHA: true | بچهای تأییدشده: 4
فایل رمزشده موبرهمو: true
حذف/ریست: false | عملیات مخرب: 0
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
node r2-relay/maxrubika/tests/run.mjs                         #  8 tests passed
python3 -m unittest discover -s r2-relay/maxrubika/tests -v   #  9 tests passed
npm --prefix r2-relay run test:all                            # 28 تست JS سبز
```

---

## ۷. چی انجام **نشد** (ادعا نمیشود)

- ❌ هیچ استقرار، ادغام PR، تغییر `index.html`/CSP/`MC_API`/Edge زنده.
- ❌ هیچ لاگین واقعی، شماره، کد تأیید، سشن واقعی یا تماس به روبیکا.
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
