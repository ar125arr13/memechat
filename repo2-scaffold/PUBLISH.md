# فقط یک قدم مانده تا ریپوی دوم روی GitHub باشد

ریپوی دوم **همینجا بهصورت کامل ساخته شده** (git init + کامیت روی `main`، `origin` تنظیمشده، بدون secret و بدون دادهٔ کاربر):

`/home/user/memechat-data-repo/`

تنها چیزی که کم است، **ساختن مخزن خالی روی GitHub** است. اتصال GitHubـه این محیط از نوع
**GitHub App / installation token** است و فقط اجازهٔ خواندن/نوشتن محتوای ریپوهای موجود را دارد؛
ساخت مخزن، تغییر تنظیمات ریپو و fork کردن همگی `403 Resource not accessible by integration`
میدهند. آزمایششده: `POST /user/repos`، `gh repo create`، `POST .../forks`،
`POST .../generate`، `PATCH /repos/...` — با **هر دو** متغیر محیطی `GH_TOKEN` و `GITHUB_TOKEN`.

## راه ۱ (۱۰ ثانیه، پیشنهادی)
این لینک رو باز کن، فقط `Create repository` بزن:

**https://github.com/new?name=memechat-data&description=MemeChat%20second%20repo%20-%20encrypted%20cold%20archive&visibility=private**

- Owner: `ar125arr13`
- نام: `memechat-data`
- **Private**
- تیک `Add a README file` / `.gitignore` / `License` رو **نزن** (باید خالی باشد)

اگه اپ Arena فقط به «ریپوهای انتخابشده» دسترسی دارد، توی
`Repo settings → GitHub Apps → Arena` ریپوی جدید رو هم اضافه کن.

بعد فقط بگو «ساخته شد»؛ من اینو اجرا میکنم:

```bash
bash /home/user/memechat/repo2-scaffold/publish.sh
```

(یا خودتان: `cd /home/user/memechat-data-repo && git push -u origin main`)

## راه ۲
اتصال **GitHub** رو توی Arena دوباره وصل کن (از نوع کاربری، با مجوز ساخت ریپو)؛
همان لحظه خودم `gh repo create ar125arr13/memechat-data --private` رو میزنم و پوش میکنم.

## نکته
هیچ توکنی لازم نیست ردوبدل شود. دو توکنی که توی گفتگو فرستاده شدند استفاده نشدهاند —
لطفاً هر دو رو Revoke کنید. نشانی کاربران همچنان
`https://zahradavoodi69-code.github.io/memechat/` است و دستنخورده.

---

## بهروزرسانی بعد از «تایید شد» (۸ نوامبر ۲۰۲۶، ۱۱:۲۶ UTC)

ریپوی ساختهشده پیدا شد: **`zahradavoodi69-code/memechat-dataa`** — خالی، شاخهٔ `main`،
ساختهشده ۱۱:۲۶ امروز. سه نکته:

1. نام `memechat-dataa` است (یک `a` اضافه)؛ اسم موردنظر `memechat-data` بود.
2. **Public** ساخته شده (پارامتر `visibility=private` فرم GitHub نگرفت). چون قرار است آرشیو
   دادهها باشد، حتماً Settings → Change visibility → **Private** کنید. `README.md` هم
   هشدارش را گرفت.
3. مالک `zahradavoodi69-code` است، ولی اتصال این محیط `ar125arr13` است. پوش مستقیم زده شد:

```
remote: Permission to zahradavoodi69-code/memechat-dataa.git denied to ar125arr13.
fatal: ... 403
```

یعنی **محتوا آماده است ولی نوشتن به آن مخزن با این اتصال ممکن نیست.**

### دو راه تمامکردن
- **راه الف (بدون هیچ توکن):** فایل `one-shot.sh` همان پوشه را باز کنید، کلش را کپی کنید و
  در ترمینال خودتان (جایی که `gh` با `zahradavoodi69-code` لاگین است) اجرا کنید:
  `bash one-shot.sh` → ۳۰ ثانیه، ریپو پر میشود.
- **راه ب:** اتصال **GitHub** را در Arena دوباره وصل کنید (ترجیحاً همان حساب
  `zahradavoodi69-code`). خودم rename به `memechat-data`، Private کردن، و پوش را انجام میدهم.

### راه ج (کوتاهترین، ۴ خط)
چون `ar125arr13/memechat` عمومی است، محتوا همانجاست؛ کافی است در ترمینال خودتان:

```bash
git clone -b arena/6b6dad2d-memechat https://github.com/ar125arr13/memechat.git /tmp/mc
git clone https://github.com/zahradavoodi69-code/memechat-dataa.git /tmp/mcd
cp -R /tmp/mc/repo2-scaffold/. /tmp/mcd/ && rm -f /tmp/mcd/one-shot.sh /tmp/mcd/publish.sh
cd /tmp/mcd && git add -A && git commit -m "MemeChat second repo: encrypted archive" && git push -u origin main
```

---

## دستور نهایی (انتخابشده: اجرا در ترمینال کاربر)

یک خط، بدون توکن، بدون کپی کردن فایل (اسکریپت از شاخهٔ عمومی خوانده میشود):

```bash
curl -fsSL https://raw.githubusercontent.com/ar125arr13/memechat/9a9c444aa9461fcc9101f38797148628e26cdd07/repo2-scaffold/one-shot.sh | bash
```

پیشنیاز: `gh` روی همان کامپیوتر با حساب `zahradavoodi69-code` لاگین باشد.
اسکریپت ریپو را کلون میکند، `README.md` / `.gitignore` / `docs/PLAN.md` را مینویسد،
کامیت میکند و `main` را پوش میدهد.

اختیاری (همان ترمینال، بعد از پوش):

```bash
gh api -X PATCH repos/zahradavoodi69-code/memechat-dataa -F private=true   # Private کردن آرشیو
gh api -X PATCH repos/zahradavoodi69-code/memechat-dataa -f name=memechat-data  # تصحیح نام
```

اگر ریپو Private شود، توکن `ar125arr13` بهطور طبیعی ۴۰۴ میبیند و Agent نمیتواند
محتوای آن را راستیآزمایی کند؛ در آن حالت تأیید نهایی با `gh repo view` خود کاربر است.


نسخهٔ بالا به **commit SHA مشخص** پین شده (نه نام شاخه) تا کش CDN نسخهٔ قدیمی را برنگرداند. همین اسکریپت بهصورت انتها‑به‑انتها روی یک مخزن خالی شبیهسازی و تست شد: شاخهٔ `main` ساخته شد، سه فایل `.gitignore` / `README.md` / `docs/PLAN.md` کامیت و پوش شدند، و اسکن الگویی secret تمیز بود.

---

## Termux / اندروید (خطاهای `gh: command not found` و `curl: (23)`)

`gh` بهصورت پیشفرض توی Termux نصب نیست. اسکریپت با `set -e` همان خط ۸ متوقف شد،
لولهٔ `curl | bash` بسته شد و برای همین `curl: (23) Failure writing output` هم آمد
(این دومی خطای شبکه نبود). ترتیب درست:

```bash
pkg install -y gh git
gh auth login          # GitHub.com → Login with a web browser → کد را در github.com/login/device بزن
gh auth setup-git
curl -fsSL -o ~/mc.sh https://raw.githubusercontent.com/ar125arr13/memechat/9a9c444aa9461fcc9101f38797148628e26cdd07/repo2-scaffold/one-shot.sh
bash ~/mc.sh
```

چهار نکته:
- **`curl -o` بهجای `| bash`** → خطای ۲۳ نمیآید و میتوانید اسکریپت را قبل از اجرا بخوانید.
- `gh auth login` از device flow استفاده میکند؛ هیچ توکنی توی چت/دستور فرستاده نمیشود.
- چون پوش با هویت **خود صاحب حساب** انجام میشود، دیگر `403 denied to ar125arr13` پیش نمیآید.
- اسکریپت نهایی چک میکند `git` / `gh` / لاگین موجود باشند وگرنه پیام فارسی میدهد.

## چرا ۴۰۳ میآمد و سه راه حذفش

علت، **هویت** است نه تنظیمات ریپو: توکن Sandbox = `ar125arr13`
(اپ `arena-ai-coding-agent`، installation `163714007`، `repository_selection: all`
فقط روی همان حساب)، درحالیکه مالک ریپو `zahradavoodi69-code` است.

1. **همین بالا** (ترمکس با لاگین صاحب حساب) → پوش با هویت درست، بدون ۴۰۳.
2. **اتصال GitHub توی Arena** را قطع/وصل کنید و حساب `zahradavoodi69-code` را انتخاب کنید تا توکن تازه صادر شود
   ← خودم rename / Private / پوش را انجام میدهم. نصب کردن اپ روی سایت GitHub بهتنهایی توکن Sandbox را عوض نمیکرد (چک شد).
3. **بدون تغییر اتصال**: یک ریپوی خالی و Private زیر **`ar125arr13`** بسازید؛ چون
   `repository_selection: all` است، توکن من بلافاصله به آن دسترسی نوشتن دارد و پوش میکنم.

اگر ریپو را Private کنید، توکن من `404` میبیند (طبق طراحی GitHub)، نه `403` — آن طبیعی است.
