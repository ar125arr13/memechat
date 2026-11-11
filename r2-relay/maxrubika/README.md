# `maxrubika/` — پیامهای ذخیرهشدهٔ روبیکا بهعنوان مقصد دیتابیس دوم

جایگزین مسیر بله. صاحب پروژه گفت «فایلای بله رو پاک کن / بریم یه پیامرسان
دیگه / مثلا با maxrubika و سیو مسیج روبیکا اوکیش کن».

## فایلها

| فایل | کار |
|---|---|
| `adapter.mjs` | `SavedMessagesDriver` + `MCR1` codec + `publishForSavedMessages` + `verifySavedMessagesDelivery` |
| `saved_messages.py` | کانکتور پایتونی واقعی با متدهای مستند `Messenger` / `send_message(chat="me")` / `send_file` / `get_last_messages` |
| `cli.mjs` | `status` / `trial --fixture` / `help` |
| `tests/run.mjs` | ۸ تست Node |
| `tests/test_saved_messages.py` | ۹ تست Python |

سند تصمیم و منابع: `../../docs/SECOND-DB-MAXRUBIKA.md`.

## اجرا

```bash
node maxrubika/cli.mjs status
node maxrubika/cli.mjs trial --fixture

python3 maxrubika/saved_messages.py status
python3 -m unittest discover -s maxrubika/tests -v
```

واقعی (روی دستگاه خودتان، بدون اینکه چیزی تو چت/سورس بیاید):

```bash
pip install maxrubika
export MC_MAXRUBIKA_SESSION="mySession"
python3 maxrubika/saved_messages.py status
```

## صداقت

- MAXRubika **غیررسمی / self-bot** است، نه API رسمی روبیکا. پروتکل خصوصی،
  ممکن است بشکند، و self-bot میتواند خلاف شرایط سرویس باشد.
- **توکن بات لازم نیست**؛ ولی یکبار لاگین شماره + کد تأیید روی دستگاه خودتان
  لازم است و فایل سشن محلی ساخته میشود. اینجا هیچ راز/OTPـای نپرسیدیم.
- پایتون است → تو مرورگر اجرا نمیشود؛ بدون ورسل، بدون دیپلوی، بدون بکاند عمومی.
- صفر حذف: `delete_messages` صدا زده نمیشود.
- دیتابیس اصلی Supabase دستنخورده؛ Saved Messages فقط حامل بستههای ciphertext
  است، نه دیتابیس کوئریپذیر.

## نکتهٔ فنی تأییدشده از سورس پکیج

`send_message("me")` داخل خودش به `self.guid` تبدیل میشود، ولی متدهای خواندن
از `get_guid(chat)` رد میشوند و `get_guid("me")` پشتیبانی نمیشود. پس برگشت با
`app.guid` خوانده میشود. متد خیالی نساختیم.
