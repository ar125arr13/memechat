#!/usr/bin/env bash
# بهروزشده: روی کامپیوتر خودتان اجرا کنید.
# دیگر gh / git / curl / GitHub / ورسل / توکن لازم ندارد.
# فقط بستههای رمزشدهٔ دیتابیس دوم برای روبیکا ساخته میشوند.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CLI="$HERE/../r2-relay/rubika/cli.mjs"
MODE="${1:-fixture}"

command -v node >/dev/null 2>&1 || { echo "node نصب نیست → نسخهٔ ۲۰ به بالا کافی است."; exit 1; }
[ -f "$CLI" ] || { echo "ابزار پیدا نشد: $CLI"; exit 1; }

echo "مقصد دوم: روبیکا (کوریر دستی) | API رسمی: خیر | ورسل: خیر | GitHub: خیر | حذف: صفر"

if [ "$MODE" = "fixture" ]; then
  node "$CLI" export --fixture
  node "$CLI" verify --fixture
  node "$CLI" status
  echo "✅ تست آفلاین سبز شد. هیچ رمزی لازم نبود."
  exit 0
fi

if [ "$MODE" = "real" ]; then
  : "${SUPABASE_URL:?SUPABASE_URL تو محیط امن تنظیم نشده}"
  : "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY تو محیط امن تنظیم نشده}"
  : "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY تو محیط امن تنظیم نشده}"
  node "$CLI" export
  echo "✅ فایل r2-relay/rubika/out/packets-*.txt را خطبهخط کپی کنید توی پیامهای ذخیرهشدهٔ روبیکا."
  exit 0
fi

echo "حالت نامعتبر. استفاده: bash one-shot.sh [fixture|real]"
exit 2
