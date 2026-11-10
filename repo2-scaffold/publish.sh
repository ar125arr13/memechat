#!/usr/bin/env bash
# بهروزشده: دیگر «پوش به ریپوی دوم GitHub» انجام نمیشود.
# فقط بستههای رمزشدهٔ دیتابیس دوم (روبیکا / کوریر دستی) ساخته میشوند.
# بدون ورسل، بدون GitHub API، بدون gh، بدون توکن، بدون حذف داده.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
CLI="$HERE/../r2-relay/rubika/cli.mjs"
MODE="${1:-fixture}"

command -v node >/dev/null 2>&1 || { echo "node نصب نیست."; exit 1; }
[ -f "$CLI" ] || { echo "ابزار پیدا نشد: $CLI"; exit 1; }

if [ "$MODE" = "fixture" ]; then
  node "$CLI" export --fixture
  node "$CLI" verify --fixture
  node "$CLI" status
  echo "تست آفلاین تمام شد. هیچ سرویس/کلید/توکن/ورسلی لمس نشد."
  exit 0
fi

if [ "$MODE" = "real" ]; then
  : "${SUPABASE_URL:?SUPABASE_URL تو محیط امن تنظیم نشده}"
  : "${SUPABASE_SERVICE_ROLE_KEY:?SUPABASE_SERVICE_ROLE_KEY تو محیط امن تنظیم نشده}"
  : "${BACKUP_ENCRYPTION_KEY:?BACKUP_ENCRYPTION_KEY تو محیط امن تنظیم نشده}"
  node "$CLI" export
  echo "بستهها آماده شدند؛ آنها را کپی کنید توی پیامهای ذخیرهشدهٔ روبیکای خودتان."
  echo "دیتابیس اصلی فقط خوانده شد؛ صفر حذف / صفر تغییر / صفر ورسل / صفر GitHub."
  exit 0
fi

echo "حالت نامعتبر. استفاده: bash publish.sh [fixture|real]"
exit 2
