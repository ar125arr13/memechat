# `internet-archive/` — دیتابیس دوم روی IAS3 با رمزگذاری متفاوت

انتخاب صاحب پروژه: «internet archive رو انتخاب میکنم / ولی رمز گزاری متفاوت
و کلیدش توی سورس کدها باشه فقط».

## فایلها

| فایل | کار |
|---|---|
| `key.mjs` | **کلید ۳۲ بایتی ثابت داخل سورس** (نه env، نه passphrase) + هشدار امنیتی |
| `cipher.mjs` | ChaCha20-Poly1305، بستهٔ باینری `MCIA1`، AAD، SHA-256 |
| `codebook.mjs` | **readable**: ۲۵۶ واژهٔ فارسی + جایگشت Sattolo (هر کلمه → کلمهٔ دیگر، بدون نقطهٔ ثابت) |
| `ias3.mjs` | کلاینت رسمی IAS3: `PUT`/`GET`/metadata/check_limit، هدرها، redaction، ممنوعیت DELETE |
| `adapter.mjs` | `InternetArchiveDriver` + `publishForInternetArchive` + `verify...` + `read...` |
| `fixture.mjs` | شبیهساز آفلاین با شکل واقعی metadata |
| `cli.mjs` | `status` / `trial --fixture` / `help` |
| `tests/run.mjs` | ۲۲ تست آفلاین |
| `tests/fixtures/metadata-stats.json` | نمونهٔ پاسخ واقعی `GET /metadata/stats` |

سند کامل: `../../docs/SECOND-DB-INTERNET-ARCHIVE.md` و
`../../docs/READABLE-CODEBOOK.md`.

## ⚠️ صداقت

مخزن **public** است و آیتمهای IA هم **World readable**اند. پس کلید داخل
سورس یک «راز» نیست و این رمزگذاری **محرمانگی نمیدهد**؛ تمامیت و ساختار
میدهد. کلید حساب IAS3 جدا است، داخل سورس نیست، و بدون آن هیچ آپلود واقعی
انجام نمیشود. صفر حذف، صفر ریست، Supabase دستنخورده، بدون ورسل.

## اجرا (توسط عامل، بدون دستوری به صاحب پروژه)

```bash
node internet-archive/cli.mjs status
node internet-archive/cli.mjs trial --fixture
node internet-archive/cli.mjs trial --fixture --readable
node internet-archive/cli.mjs words
node internet-archive/tests/run.mjs
```

**نظر صادقانه دربارهٔ readable:** کدبوک، خروجی را **قابلخواندن** میکند
(حروف فارسی، `آب → گچ`) ولی **امن** نمیکند و **معنیدار** هم نمیکند —
زیرش همچنان ciphertext است. این یک substitution cipher است، جایگزین
ChaCha20-Poly1305 نشد و تمامیت/AAD/Poly1305 پابرجا ماند. حجم حدود **۹ برابر**
میشود. پیشفرض همان باینری است؛ `--readable` اختیاری است.

واقعی (فقط موقع اجرا، هیچ رازی تو سورس/لاگ/چت نیست):

```bash
MC_IA_ACCESS_KEY=... MC_IA_SECRET_KEY=... MC_IA_ITEM=... node internet-archive/cli.mjs status
```

## نکتهای که از سند رسمی پیدا شد و رعایت شد

- `Authorization: LOW <access>:<secret>` فقط با HTTPS.
- `x-archive-auto-make-bucket:1` فقط روی اولین PUT؛ `x-archive-queue-derive:0`
  برای فایلهای باینری؛ `x-archive-size-hint`؛ `mediatype:data`؛
  `collection:opensource_media`.
- `x-archive-keep-old-version:1` → حتی PUT مجدد نسخهٔ قدیمی را پاک نمیکند
  (بهخاطر «هیچ دادهای حذف نشود»).
- 307 redirect و `503 SlowDown` رایجاند؛ `check_limit` تعبیه شد.
- شناسهٔ آیتم immutable و محدود به ASCII ≤۱۰۰ کاراکتر.
- `DELETE` / `x-archive-cascade-delete` / `test_collection` عمداً استفاده نشدند.
