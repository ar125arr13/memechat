# `strong-db` — لایهٔ محکم دیتابیس دوم

اضافهای، آفلاین، بدون سرویس تازه. همان `MCIA1` (ChaCha20-Poly1305 + AAD)
را روی **۳ حامل** مینویسد، هر نوشتن را بلافاصله هش/تأیید میکند، رکوردها
را به یک کاتالوگ **فقطالحاقی `MCDB1` با زنجیر SHA-256** میسپارد، و اگر
نسخهای خراب شد از نسخهٔ سالم میخواند (`repair` الحاق میکند، چیزی پاک
نمیکند).

```text
trial    نوشتن ۳ رکورد + تأیید ۳ نسخه + خرابکردن عمدی + خودترمیمی + تأیید دوباره
verify   سلامت زنجیر هش و تکتک نسخهها
status   وضعیت صادقانه
help     راهنما
```

اجرا توسط عامل (همه محلی/آفلاین):

```bash
node strong-db/cli.mjs trial
node strong-db/cli.mjs verify
node strong-db/cli.mjs status
node strong-db/tests/run.mjs       # ۱۶ تست
```

از ریشهٔ `r2-relay`:

```bash
npm run strong-db:trial
npm run strong-db:verify
npm run strong-db:status
npm run test:strong-db
npm run test:all                   # شامل strong-db
```

**محدودیت صادقانه:** محرمانگی ادعا نمیشود (مخزن public + آیتمهای IA
World readable) و کوئریپذیر نیست (SQL/تراکنش/OTP/realtime ندارد). Supabase
همچنان دیتابیس اصلی است و دستنخورده میماند. تمام حاملها fixtureاند؛
بدون IAS3 واقعی، لاگین روبیکا، شماره/OTP، ورسل، استقرار یا مرج.
`delete()` عمداً خطا میدهد. خروجیها در `out/` و gitignoredاند.

سند کامل: [`../../docs/STRONG-DB.md`](../../docs/STRONG-DB.md).
