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
