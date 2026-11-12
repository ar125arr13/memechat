# «پابلیش» قدیمی حذف شد — دستور تازه برای دیتابیس دوم

**این فایل کاملاً بهروزشده است.** متن قدیمی دربارهٔ ساختن مخزن خصوصی GitHub،
`gh repo create`، پوش `main`، `curl | bash`، Termux و ۴۰۳های `ar125arr13`
دیگر **دستور کار نیست**. آن سابقه حذف نشد، ولی اجرا نمیشود چون:

1. صاحب پروژه گفت «دیتابیس دوم دیگر روی سرویس قبلی نباشد» → مقصد GitHub کنار رفت.
2. صاحب پروژه گفت «از ورسل استفاده نکن» → هیچ لامبدا/کران/متغیر ورسلی در کار نیست.
3. صاحب پروژه گفت «هیچ دادهای حذف یا ریست نشود» → `DELETE` قدیمی منتفی شد.
4. مخزن قدیمی `zahradavoodi69-code/memechat-data` همانجوریکه هست **دستنخورده**
   میماند؛ فقط چیز تازهای توی آن نوشته نمیشود.

## تنها دستور معتبر الان

همه تو ترمینال امن خودتان، بدون هیچ توکن/رمز تو چت:

```bash
cd /home/user/memechat

# تست آفلاین، بدون کلید و بدون اتصال به هیچ سرویسی
node r2-relay/rubika/cli.mjs export --fixture
node r2-relay/rubika/cli.mjs verify --fixture
node r2-relay/rubika/cli.mjs status

# اجرای واقعی (فقط متغیرهای محیط امن)
export SUPABASE_URL='https://teylquevemmkrgswnwtx.supabase.co'
export SUPABASE_SERVICE_ROLE_KEY='...'
export BACKUP_ENCRYPTION_KEY='...'
node r2-relay/rubika/cli.mjs export
```

سپس فایل `r2-relay/rubika/out/packets-*.txt` را خطبهخط کپی کنید توی
**پیامهای ذخیرهشدهٔ روبیکای خودتان**. همین. هیچ API رسمی، ربات، توکن،
حساب جدید، GitHub، ورسل یا تغییر سایت زنده لازم نیست.

## چی عمداً انجام نمیشود

- `git push` به هیچ مخزن داده.
- `gh repo create` / تغییر visibility / rename.
- `curl … | bash` و لاگین `gh` در Termux.
- ساخت/تغییر Edge Function یا `dist.cjs`.
- پاک کردن ردیف، outbox، TTL یا بچ قدیمی.

فایلهای `publish.sh` و `one-shot.sh` هم بهروزشدهاند و فقط همان ابزار بالا را
صدا میزنند؛ دیگر پوشی انجام نمیدهند.

جزئیات: `../docs/SECOND-DB-RUBIKA.md` و `../r2-relay/README.md`.
