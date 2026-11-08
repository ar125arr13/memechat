#!/usr/bin/env bash
# روی کامپیوتر خودتان اجرا کنید؛ همانجایی که `gh` با حساب zahradavoodi69-code لاگین است.
# هیچ توکنی لازم نیست. ریپو را پر میکند و main را پوش میدهد.
set -euo pipefail

# پیشنیازها (مخصوصاً Termux: gh بهصورت پیشفرض نصب نیست)
command -v git >/dev/null 2>&1 || { echo "git نصب نیست →  pkg install -y git"; exit 1; }
command -v gh  >/dev/null 2>&1 || { echo "gh نصب نیست →  pkg install -y gh  سپس  gh auth login"; exit 1; }
gh auth status >/dev/null 2>&1 || { echo "لاگین نیست →  gh auth login  (کد device را در github.com/login/device بزن)"; exit 1; }

REPO="${1:-zahradavoodi69-code/memechat-dataa}"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
gh repo clone "$REPO" "$WORK/repo" -- --depth=1
cd "$WORK/repo"
git checkout -q -B main   # تضمین شاخهٔ main حتی اگر HEAD مخزن خالی چیز دیگری باشد

cat > README.md <<'MEMECHAT_README_EOF'
# میم chat — ریپوی دوم (داده / آرشیو)

**وضعیت: اسکلت و سند طراحی.** محتوا فقط `README.md`، `.gitignore` و `docs/PLAN.md` است؛ هیچ استقرار، اتصال به بکاند یا جابهجایی کلیدی انجام نشده.
هیچ دادهٔ کاربر، رمز، توکن، کلید امضا یا سورس بکاندی در این ریپو قرار نگرفته است. ریپو **باید خصوصی باشد**؛ اگر هنگام ساخت بهصورت Public ایجاد شد، حتماً در Settings → Change visibility آن را Private کنید، چون محل آرشیو دادههاست.

## این چیست
مقصد دوم برای بلابهای immutable و رمزشدهٔ میم chat: بچهای آرشیو پیامها، رسانهها، فایلهای بخش «انتشار» و داراییهای سنگین. هدف، سبک کردن ترافیک خروجی (egress) Supabase است.

## این چی نیست
- **هاست اپ نیست.** کاربران همچنان همان نشانی `https://zahradavoodi69-code.github.io/memechat/` را باز میکنند؛ **لینک جدیدی به آنها داده نشد**.
- **جایگزین Supabase برای ورود/نشست/پیامرسانی زنده نیست.** GitHub Pages استاتیک است و نمیتواند `api/auth.js`، `api/chat.js`، `lib/core.js`، اعتبارسنجی نشست HMAC، rate limit، کوئریهای Postgres یا سیگنالینگ تماس WebRTC را اجرا کند.
- مخزن عمومی Pages فعلی (`zahradavoodi69-code/memechat`) نیست و محتوای آن تغییر نکرده است.

## چرا ساخته شد
امروز رسانهها بهصورت base64 تا حدود ۱٫۸MB داخل ردیف پیام و آواتار inline تا ۴۵KB همراه هر `poll` (هر ۳٫۵ ثانیه) به کلاینت برگردانده میشوند. بیرون بردن آنها به بلابهای immutable، بیشترین اثر را بر سهمیهٔ egress دارد — بیش از صرفاً پاک کردن ردیفهای قدیمی.

## قانون طلایی: «اول تأیید، بعد حذف»
همان الگوی `api/sync.js`: بچها با AES-256-GCM و `BACKUP_ENCRYPTION_KEY` رمز میشوند، در مخزن خصوصی کامیت میشوند، **commit SHA تأیید میشود**، سپس فقط ردیفهای outbox همان بچ حذف میگردند. در صورت شکست انتقال: `retainedInSupabase: true` و هیچ حذفی انجام نمیشود. حذف اصل پیامها مشروط به `sync_status=confirmed` و گذشتن TTL است.

## برای وصل کردن (انجام نشده؛ نیاز به اجازهٔ صریح و محیط امن)
1. `GITHUB_REPO` = `<owner>/<repo>`، `GITHUB_DATA_BRANCH` (پیشفرض `mimchat-data`؛ میتواند `main` باشد)، `GITHUB_TOKEN` و `BACKUP_ENCRYPTION_KEY` فقط در Supabase Secrets / متغیرهای محیط امن.
2. `/api/sync` به باندل Edge اضافه و زمانبندی شود. الان `edge/entry.js` و `dist.cjs` فقط `/api/auth`، `/api/chat`، `/api/health` را مسیردهی میکنند.
3. سمت کلاینت: خواندن بلابها + بهروزرسانی CSP در `index.html` زنده (`connect-src` / `img-src` / `media-src`) ← انتشار تأییدشده + بررسی هش فایل زنده.
4. اندروید: `AppConfig.isInternalHost` فقط هاستهای `BuildConfig` را میپذیرد ← بازسازی و تست APK لازم است.
5. تست رگرسیون، سپس بررسی جداگانهٔ Actions، Pages و بایتهای نسخهٔ زنده.

جزئیات در `docs/PLAN.md`.

## محدودیتها (واقعی، نه «نامحدود»)
- GitHub Pages: سقف نرم **۱۰۰GB/ماه**، سایت منتشرشده ≤ **1GB**، ریپوی توصیهشده <1GB، ۱۰ بیلد/ساعت، امکان `429` و «ایمیل مؤدبانه» در صورت عبور. روی Free فقط از ریپوی عمومی منتشر میشود.
- REST API: **۵٬۰۰۰ req/h** احرازشده، **۶۰ req/h** ناشناس، ۱۰۰ درخواست همزمان، ۹۰۰ امتیاز/دقیقه. پس «کامیت بهازای هر پیام» شدنی نیست.
- فایلهای ریپو: >۵۰MiB هشدار، >۱۰۰MiB بلاک (باید LFS/Releases استفاده شود).
- سند رسمی GitHub: «Git برای بکاپ طراحی نشده است».

تا دستور صریح، هیچ استقرار، تغییر URL، جابهجایی کلید، تغییر Edge Function یا حذف دادهٔ کاربری انجام نشده است.
MEMECHAT_README_EOF

cat > .gitignore <<'MEMECHAT_GITIGNORE_EOF'
.env
.env.*
!.env.example
*.key
*.pem
*.p12
*.jks
keystore.properties
SIGNING-CREDENTIALS.txt
local.properties

data/
backups/
users/
*.dump
*.sql.gz
*.onnx
*.gguf
*.safetensors
*.apk

node_modules/
dist/
build/
*.log
.DS_Store
MEMECHAT_GITIGNORE_EOF

mkdir -p docs
cat > docs/PLAN.md <<'MEMECHAT_PLAN_EOF'
# نقشهٔ مهاجرت به ریپوی دوم (پیشنهاد، اجرا نشده)

## اصل ثابت
نشانی کاربران تغییر نمیکند: `https://zahradavoodi69-code.github.io/memechat/`.
ریپوی دوم فقط در پسزمینه بهعنوان مقصد بلابها دیده میشود؛ کاربر به لینک تازهای هدایت نمیشود.

## چرا «انتقال هاست» بهصورت لفظی شدنی نیست
`index.html` یک صفحهٔ ایستا است. تمام قابلیتهای زنده از `MC_API` =
`https://teylquevemmkrgswnwtx.supabase.co/functions/v1/mimchat-api` میآیند:
ورود/OTP، توکن نشست، ارسال و تاریخچه پیام، جستجو، استوری، گیفت، تیکت،
نقشها، rate limit و `rt-post`/`rt-get` برای تماس. یک ریپوی git نمیتواند
کد سمت سرور اجرا کند، نشست بسازد، کوئری بزند یا بنویسد. حذف کامل Supabase
یعنی اپ به یک پوستهٴ استاتیک بدون ورود و چت تبدیل میشود.

## معماری پیشنهادی (Supabase نازک)
| لایه | نقش |
|---|---|
| Pages فعلی (همان URL) | `index.html`، بدون لینک جدید برای کاربر |
| Supabase | فقط حالت داغ: users/sessions/rate_limits/rooms، شناسهها، JSON سبک `poll` |
| ریپوی دوم | بلابهای immutable و رمزشده + بچهای آرشیو؛ تحویل در پسزمینه |

## فازها
1. **اندازهگیری**: خواندن Usage Dashboard بهتفکیک سرویس (عدد GB در دسترس Agent نیست).
2. **کمحجم کردن پاسخ `poll`** (بیشترین اثر، بدون مهاجرت): خروج base64 مدیا و آواتار inline، poll افزایشی، کش/ETag.
3. **آرشیو**: تنظیم `GITHUB_REPO`/`GITHUB_TOKEN`/`BACKUP_ENCRYPTION_KEY` در Supabase Secrets؛ اضافه کردن `/api/sync` به `edge/entry.js` و بازسازی `dist.cjs`؛ زمانبند امن؛ تست «تأیید قبل از حذف».
4. **تحویل بلاب**: مسیرهای غیرقابل حدس + ciphertext؛ بهروزرسانی CSP در `index.html` زنده؛ انتشار تأییدشده و مقایسهٔ هش HTML.
5. **اندروید**: `AppConfig` و تست APK.
6. **راستیآزمایی**: تست رگرسیون، سپس بررسی جداگانهٔ Actions/Pages/محتوای زنده؛ تا آن لحظه چیزی «تمامشده» اعلام نشود.

## گیرها
- Pages Free فقط از ریپوی عمومی منتشر میشود؛ دادهٔ شخصی نباید عمومی باشد ← حتماً رمزشده و با مسیر غیرقابل حدس، یا از طریق لایهٔ احرازشده.
- پروکسی کردن بلابها از داخل Edge Function دوباره egress را به Supabase برمیگرداند.
- توکنها فقط در محیط امن؛ هیچ مقداری در کد، چت، لاگ یا مخزن عمومی.
- سند تحویل: بدون اجازه دادهٔ کاربر پاک نشود، URL جابهجا نشود، Vercel استفاده نشود، `Sepehr` ادمین است نه مالک.
MEMECHAT_PLAN_EOF

git add -A
git -c user.name="MemeChat" -c user.email="memechat@users.noreply.github.com" \
  commit -q -m "MemeChat second repo: encrypted archive / static blob destination (no secrets, no user data)"
git push -u origin main
echo "تمام شد: https://github.com/$REPO"
