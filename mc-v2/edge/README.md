# محل قرار گرفتن فایلهای Edge

این دو فایل **مستقر نشدهاند**؛ فقط کامل نوشته شدهاند تا هر وقت صاحب پروژه اجازه داد
بدون حدس و گمان وصل شوند.

ساختار باندل فعلی Edge Function (`mimchat-api`) اینجوریه:

```
mimchat/
├── api/
│   ├── auth.js
│   ├── chat.js
│   └── health.js
├── edge/
│   ├── entry.js          ← روتر فعلی
│   └── bootstrap.js
└── lib/
    └── core.js
```

برای اضافه شدن v2، **بدون حذف هیچ فایلی**، اینجوری کنارشون قرار میگیرن:

```
mimchat/
├── api/                  ← دستنخورده
├── edge/
│   ├── entry.js          ← دستنخورده (تا روز جابهجایی)
│   ├── bootstrap.js      ← دستنخورده
│   ├── entry.v2.js       ← از mc-v2/edge/ کپی شود
│   └── v2-handler.js     ← از mc-v2/edge/ کپی شود
├── src/
│   └── crypto.js         ← از mc-v2/src/crypto.js کپی شود
└── lib/
```

- `entry.v2.js` با `../api/auth.js` و `../api/chat.js` همان روترهای فعلی را صدا میزند؛
  برای همین باید کنار `api/` باشد، نه داخل `mc-v2/` تنها.
- `v2-handler.js` فقط به `../src/crypto.js` نیاز دارد؛ `src/` را هم کنار `api/` و
  `edge/` کپی کنید.
- `entry.v2.js` همان سه مسیر `/api/auth`، `/api/chat`، `/api/health` را نگه میدارد و
  فقط `/api/v2` را اضافه میکند. تا وقتی جایش عوض نشده، سایت هیچ تغییری نمیکند.
- متغیرهای سرور (`GITHUB_TOKEN`, `GITHUB_REPO`, `GITHUB_PAGES_BRANCH`,
  `BACKUP_ENCRYPTION_KEY`, `MIMCHAT_API_BASE`) فقط تو Supabase Secrets تنظیم میشوند؛
  مقدارشان هرگز تو مرورگر، Pages، لاگ یا این مخزن نیست.
- **ما هیچکدام از این جابهجاییها را انجام ندادیم.**
