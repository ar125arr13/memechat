# پیامرسان انتخابشده برای اتصال راحت با API: «بله»

**درخواست:** «یه پیامرسان پیدا کن که با API راحت وصلت کنن» → «API ارسال پیام
مستقیم یکی از اونها رو بگیر».

**جواب کوتاه:** **بله** را انتخاب کردم، API رسمی `sendMessage`اش را گرفتم، و
کانکتور کامل و تستشدهاش را کنار بقیهٔ پروژه گذاشتم. بدون ورسل، بدون کارت،
بدون تغییر دیتابیس اصلی، بدون استقرار.

---

## ۱. چرا بله نه بقیه؟

| پیامرسان | API راحت؟ | وضعیت واقعی |
|---|---|---|
| **بله** ✅ | بله | مستندات رسمی دارد؛ دقیقاً همشکل Bot API تلگرام؛ `https://tapi.bale.ai/bot<token>/sendMessage`؛ سرورها داخل ایران [[1]](https://docs.bale.ai/) [[2]](https://barato.ir/bale-android/) |
| تلگرام | بله، سادهترین | رایگان و بدون OAuth [[3]](https://posteverywhere.ai/blog/post-to-telegram-api)، ولی گزارشهای ۲۰۲۶ میگویند داخل ایران فیلتر است [[4]](https://www.sayfone.com/does-telegram-work-in-iran) [[5]](https://natchecker.com/blog/vpn-for-telegram) |
| دیسکورد | وبحوک | نیازی به ساخت بات نیست، ولی خودِ آدرس وبحوک توکن دارد و فقط ارسال میکند، خواندن نه [[6]](https://docs.discord.food/resources/webhook) |
| ایتا | خیر | FAQ رسمی: «ارائهٔ دسترسی برای طراحی کلاینت جدید فعلاً جزو سیاستهای ایتا نیست»؛ فقط واسطهٔ شخص ثالث هست [[7]](https://my.eitaa.com/faq/29) |
| روبیکا | خیر | بدون توکن رسمی / نشست خصوصی، اتصال خودکار واقعی وجود ندارد؛ همان کوریر دستی قدیمی میماند |

صفحهٔ رسمی «بازوی بله» هم میگوید شروع ساخت بازو فقط «گرفتن توکن از
`@botfather`» است: <https://dev.bale.ai>. چیزی دربارهٔ کارت بانکی، اشتراک یا
پرداخت در آن مرحله ننوشته است.

---

## ۲. API دقیق ارسال پیام مستقیم

منبع: <https://docs.bale.ai/> (بخش «ایجاد درخواست»، «getMe»، «getUpdates»،
«sendMessage»)

```
Base URL   : https://tapi.bale.ai/bot<TOKEN>/METHOD_NAME

getMe      : {}                                  → اطلاعات بازو / تست توکن
getUpdates : { offset, limit, timeout }         → آرایهٔ Update (برای chat_id)
sendMessage: { chat_id, text }                  → پیام ارسالشده
```

نمونهٔ همان چیزی که تو `r2-relay/bale/api.mjs` پیاده شد:

```
POST https://tapi.bale.ai/bot<TOKEN>/sendMessage
Content-Type: application/json

{ "chat_id": 987654321, "text": "سلام" }
```

نکات راستیآزمایشده از مستندات رسمی:

- `text` بین **۱ تا ۴۰۹۶ کاراکتر**.
- `chat_id` برای «پیام مستقیم» = شناسهٔ چت خصوصی کاربری که به بازو `/start` داده.
- پاسخ همیشه یک شیء JSON با فیلد `ok` دارد؛ خطا `error_code` و گاهی
  `parameters.retry_after` (محدودیت نرخ) میدهد.
- `GET` و `POST` و `application/json` پشتیبانی میشوند (جز آپلود فایل).
- آپدیتها فقط **۲۰۰۰ پیام آخر / ۲۴ ساعت** نگه داشته میشوند؛ یعنی بله حامل
  پیام است، **دیتابیس / تراکنش / ایندکس نیست**.

---

## ۳. یه حرف راست دربارهٔ «نه توکن»

قبلاً گفتی «نه توکن». باید صادقانه بگم: **هیچ API پیامرسانی، ارسال پیام
مستقیم بدون یه جور اعتبارنامه نمیدهد.** بله هم یک «توکن بازو» میخواهد؛ مثل
`123456789:abcd...`. این توکن:

- رمز حساب شخصی تو نیست، OTP نیست، کارت بانکی نیست؛
- فقط **خودت** تو بله از `@botfather` میگیری؛
- فقط تو **محیط امن سرور** گذاشته میشود؛
- من نخواستمش، نساختمش، ندیدمش، و هیچ جایی ذخیرهاش نکردم؛
- هیچوقت تو چت، سورس، فرانتاند، لاگ، مانیفست یا پیام خطا نمیآید.

اگر همچنان «مطلقاً هیچ توکنی» مدنظرت باشد، این مسیر هم قابل اجرا نیست و
**کوریر دستی روبیکا بدون توکن سر جای خودش باقی میماند**؛ چیزی حذف یا عوض
نشد. API جعلی/بدون احراز هویت نساختیم.

---

## ۴. فایلهای کامل تحویلشده

| فایل | چیست |
|---|---|
| `docs/MESSENGER-API-BALE.md` | همین سند |
| `r2-relay/bale/api.mjs` | کانکتور کامل: config، getMe، getUpdates، sendDirectMessage، deliverBatch، receivePackets، کدگذاری امن بستهها |
| `r2-relay/bale/cli.mjs` | خطفرمان کامل: `status` / `chat-id` / `send` / `send-packets` / `receive` / `help` |
| `r2-relay/bale/mock.mjs` | شبیهساز آفلاین، بدون شبکه و بدون راز واقعی |
| `r2-relay/bale/tests/run.mjs` | ۱۳ تست آفلاین |
| `r2-relay/bale/README.md` | راهنمای کامل اجرا |
| `r2-relay/rubika/adapter.mjs` | فقط یک مقصد اختیاری `bale-bot-api` اضافه شد؛ پیشفرض همان کوریر دستی است |
| `r2-relay/rubika/cli.mjs` | `export --destination bale` اضافه شد؛ قدیمیها دستنخورده |
| `r2-relay/package.json`, `r2-relay/README.md`, `r2-relay/.gitignore` | اسکریپت تست، اشارهٔ کوتاه، ignore کردن `bale/out/` |

بستهها همان `MCPK1` رمزشدهٔ AES-256-GCM هستند؛ بله فقط ciphertext میبیند.
چون متن بله Markdown میشود، `_` داخل base64url به `%5F` تبدیل و موقع برگشت
برگردانده میشود تا بسته آسیب نبیند.

---

## ۵. تنها کارهایی که صاحب پروژه انجام میدهد (بدون نوشتن کد)

1. تو بله به `@botfather` پیام بده، یه بازو بساز، توکن را پیش خودت نگه دار.
2. به همان بازو `/start` بده.
3. تو محیط امن سرور دو متغیر بگذار: `BALE_BOT_TOKEN` و `BALE_CHAT_ID`.
4. `node r2-relay/bale/cli.mjs status` → اگر `آماده: true` شد، وصل است.
5. `node r2-relay/bale/cli.mjs chat-id` عدد چت را نشان میدهد (اگر لازم بود).
6. `node r2-relay/bale/cli.mjs send --text "سلام"` یک پیام مستقیم میرود.

برای بستههای دیتابیس دوم:

```bash
node r2-relay/rubika/cli.mjs export --destination bale
node r2-relay/bale/cli.mjs send-packets \
  --file r2-relay/rubika/out/packets-<batchId>.txt \
  --manifest r2-relay/rubika/out/manifest-<batchId>.json

# برگشت و تأیید (بدون پاک کردن هیچ ردیفی)
node r2-relay/bale/cli.mjs receive --out r2-relay/bale/out/received.txt
node r2-relay/rubika/cli.mjs verify \
  --file r2-relay/bale/out/received.txt \
  --manifest r2-relay/rubika/out/manifest-<batchId>.json
```

همهچیز با `--fixture` بدون هیچ توکن/شبکهای هم تست میشود؛ در حالت فیکستر
`receive --packets <همانفایل بستهها>` همان بچ را برمیگرداند تا `verify` سبز شود.

---

## ۶. قوانینی که رعایت شد

- ✅ فقط سرور؛ هیچ راز/کلیدی تو فرانتاند، `index.html`، CSP، چت یا لاگ.
- ✅ **بدون ورسل** (همان دستور قبلی همچنان پابرجاست).
- ✅ بدون GitHub API، بدون API خصوصی روبیکا، بدون scraping، بدون مهندسی معکوس.
- ✅ دیتابیس اصلی Supabase فقط `SELECT`؛ صفر `PATCH` / `DELETE` / `RESET`.
- ✅ نام جدولها، فیلدها و دادههای قدیمی دستنخورده؛ کوریر دستی روبیکا حذف نشد.
- ✅ لاگین، لینک، ظاهر سایت، پیامها و `MC_API` تغییر نکردند.
- ❌ هیچ استقرار، ادغام PR، تغییر زنده، بکآپ واقعی، خاموش کردن Supabase یا
  پاک کردن ردیفی انجام **نشد**.

---

## ۷. منابع

1. مستندات رسمی بازوی بله — <https://docs.bale.ai/>
2. معرفی بله بهعنوان پیامرسان داخلی (بدون فیلترشکن) — <https://barato.ir/bale-android/>
3. سادگی/رایگان بودن Bot API تلگرام — <https://posteverywhere.ai/blog/post-to-telegram-api>
4. گزارش فیلتر بودن تلگرام در ایران، ۲۰۲۶ — <https://www.sayfone.com/does-telegram-work-in-iran>
5. گزارش وضعیت تلگرام در ایران، اکتبر ۲۰۲۶ — <https://natchecker.com/blog/vpn-for-telegram>
6. وبحوک دیسکورد و توکن داخل URL — <https://docs.discord.food/resources/webhook>
7. FAQ رسمی ایتا دربارهٔ نداشتن API کلاینت — <https://my.eitaa.com/faq/29>
8. صفحهٔ رسمی ساخت بازو در بله — <https://dev.bale.ai>
