#!/usr/bin/env bash
# MemeChat — «تست واقعی» بله، فقط تو ترمینال امن خودتان.
#
#   export BALE_BOT_TOKEN='...'     # فقط اینجا، نه چت/مخزن/فرانتاند
#   export BALE_CHAT_ID='...'
#   ./r2-relay/primary/real-test.sh
#
# این اسکریپت هیچ توکنی چاپ نمیکند، نمیپرسد، ذخیره نمیکند و به جایی
# نمیفرستد؛ فقط آن را از process.env میخواند. بدون آن دو متغیر، هیچ تماسی
# به بله زده نمیشود و خروجی صادقانه میگوید انجام نشد.

set -euo pipefail

: "${BALE_BOT_TOKEN:?❌ BALE_BOT_TOKEN تنظیم نشده. تو محیط امن سرور export کنید؛ هرگز تو چت نفرستید.}"
: "${BALE_CHAT_ID:?❌ BALE_CHAT_ID تنظیم نشده. تو محیط امن سرور export کنید.}"

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE/.."

echo "→ پیشچک اتصال رسمی بله (بدون چاپ هیچ راز)…"
node primary/cli.mjs preflight

echo ""
echo "→ تست محدودزمانی: فایل رمزشده میرود، برمیگردد، SHA تأیید میشود…"
node primary/cli.mjs trial --duration-ms "${MC_TRIAL_MS:-30000}"

echo ""
echo "✅ تمام شد. بله فقط چند ثانیه فعال بود؛ سوپا خودکار برگشت، هیچ ردیفی پاک نشد."
