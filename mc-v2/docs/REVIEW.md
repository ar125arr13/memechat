# بررسی پروژهٔ فعلی، قبل از هر تغییری

**وضعیت:** فقط بررسی و مستندسازی. هیچ فایل زندهای تغییر نکرده، هیچ **ردیف یا مقدار
کاربری** خوانده، کپی، جابهجا یا پاک نشده است؛ فقط نام جدولها و ستونها از
`information_schema` پروژهٔ زنده خوانده شد. تمام کدهای v2 تو پوشهٔ جدای `mc-v2/`
هستن، بدون دست زدن به `index.html`، `api/*`، `edge/*`، `lib/core.js`، `MC_API`،
CSP، Storage یا secretها.

## منبع بررسی

سورس واقعی میمچت، همان ۶۸ فایل ضمیمهٔ خصوصی، با فهرست SHA-256 تکتک بازبینی شد
(همه مطابقت داشتند). این فایلها تو مخزن این شاخه نیستن؛ تو پوشهٔ موقتی و خصوصی
بررسی شدن و **منتشر نشدن**. اعداد زیر از روی همان سورس خونده شدن، نه حدس.

علاوه بر سورس، **ساختار زندهٔ دیتابیس** هم با یک کوئری فقطخواندنی روی
`information_schema.tables` / `information_schema.columns` تأیید شد (پروژهٔ
`teylquevemmkrgswnwtx`): **۴۴ جدول `public`** وجود دارد و ستونهای پنج جدول کلیدی
موارد زیراند. هیچ `SELECT *` روی دادهٔ کاربران اجرا نشد.

| نتیجهٔ زنده | عدد / توضیح |
|---|---|
| تعداد جدولهای `public` | ۴۴ |
| `mimchat_users` | `id` (text)، `username`، `email`، `phone_hash`، `password_hash`، `password_salt`، `role`، `theme`، `bio`، `session_epoch` … |
| `mimchat_staging_messages` | `id`، `topic`، `from_id`، `sender_username`، `text`، `file` (jsonb)، `reactions`، `seen_by`، `ts` (bigint)، `client_id`، `sync_status` … |
| `mimchat_rooms` | `id`، `topic`، `room_type`، `creator_username`، `admins`، `muted`، `banned` … |
| `mimchat_assets` | `path`، `content`، `updated_at` → همان جای سیگنالینگ `rt/<room>/` |
| `mimchat_staging_outbox` | `id`، `event_type`، `payload`، `status`، `attempts` … |

چهار جدول قدیمی **`conversations` / `conversation_members` / `messages` / `profile`**
هم تو دیتابیس زنده هستند. ممکنه مال نسخههای قبلتر باشن، ولی چون قانون «هیچ دادهٔ
موجودی نباید جا بماند» است، عمداً تو فهرست بکاپ `migration/backup.mjs` آمدند و
تست هش تکتکشان را چک میکند.

## نقشهٔ فایلها و ارتباطشان

| فایل | نقش | ارتباط |
|---|---|---|
| `mimchat/index.html` (۵۱۲٬۳۹۳ بایت) | تمام رابط کاربری، RTL نارنجیمشکی، شش بخش، تمام ~۱۰۰ اکشن چت | `MC_API` → `/api/auth`, `/api/chat`, `/api/sync`, `/api/health` |
| `mimchat/api/auth.js` | ثبتنام، کد ایمیل، ورود، خروج، نشست ۷روزه | `mimchat_users`, `mimchat_sessions`, توکن `mc_token` |
| `mimchat/api/chat.js` (۱۶۵٬۱۶۳ بایت) | پیام، تاریخچه، گروه، کانال، پیوی، استوری، تماس، پروفایل، ادمین… | `mimchat_staging_messages`, `mimchat_assets` و… |
| `mimchat/api/sync.js` | بکاپ رمزشده به مخزن خصوصی GitHub، حذف فقط بعد از تأیید کامیت | `mimchat_staging_outbox` |
| `mimchat/lib/core.js` | توکن نشست HMAC، رمز عبور، REST سوپا بیس، AES-GCM بکاپ | `BACKUP_ENCRYPTION_KEY`, `GITHUB_TOKEN`, `GITHUB_REPO` |
| `mimchat/edge/entry.js` + `bootstrap.js` + `dist.cjs` | روتر مستقر: فقط `/api/auth`, `/api/chat`, `/api/health` | باندل خصوصی تو Storage با قفل SHA-256 |
| `mimchat/supabase/migrations/001_*.sql` | جدولهای پایه | `mimchat_users`, `mimchat_rooms`, `mimchat_staging_messages`, `mimchat_staging_outbox`… |
| `mimchat/mimchat-schema-*.sql` | اسکیمای ۱.۰.۷ / ۱.۲.۰ / ۱.۴.۰ (افزودنی، بدون حذف) | **فایل اسکیما = بکاپ زنده نیست** |

## محل دقیق اطلاعات فعلی

| اطلاعات | کجاست | نکتهٔ مهم |
|---|---|---|
| حسابها، username، user ID، نقشها، بایو، آواتار، تم، تنظیمات حریم خصوصی | `public.mimchat_users` (`id` متنی، `username` یکتا، `password_hash`, `password_salt`, `email`, `phone_hash`) | `id` و `username` کلید هویتاند؛ نباید عوض شوند |
| اطلاعات Login / نشستها | `mc_token` تو localStorage + `mimchat_sessions` + HMAC با `SESSION_SECRET` | سیستم ورود مستقل و دستنخورده میماند |
| پیامها، متن، فایل، ریپلای، ریاکشن، seen، ویرایش، `ts` | `public.mimchat_staging_messages` | **`history` و `poll` مستقیم از همین جدول میخوانند**؛ پاک کردنش = پاک شدن تاریخچهٔ قابل رؤیت |
| گروهها / کانالها / پیوی | `public.mimchat_rooms` + `mimchat_room_members` | `topic` همان شناسهٔ گفتگوی تو آدرس `action=history&topic=...` |
| تنظیمات و دادههای کاربر | `mimchat_settings`, `mimchat_code`, `mimchat_media`, `mimchat_boosts`، NFTها، هدیهها، تیکتها، استوریها، تایپینگ، بنها… | **۴۴ جدول**؛ فهرست دقیق و راستیآزماییشده تو `migration/backup.mjs` |
| جدولهای قدیمی/کماستفاده | `conversations`, `conversation_members`, `messages`, `profile` | تو بکاپ و تست هش آمدند؛ بدون قضاوت دربارهٔ محتوا، دستنخورده میمانند |
| فایلها / رسانه | `mimchat_media`, `mimchat_assets`، فیلد `file` تو پیام (base64 inline)، `message-file` | فایلها داخل رکورد پیامان، نه جای جدا |
| صف انتقال و بکاپ | `mimchat_staging_outbox` → بستهٔ AES-GCM تو مخزن **خصوصی** GitHub | الگوی «اول تأیید، بعد حذف» از قبل وجود داشته |
| سیگنالینگ تماس | `mimchat_assets` با پیشوند `rt/<room>/` + اکشنهای `rt-post` / `rt-get` / `rt-clear` | **همین مسیرها برای WebRTC پیام هم کافیان**؛ نیازی به جدول یا Edge تازه نیست |
| کش کوتاه سمت کلاینت | `MH.cache` تو `index.html` (۳۰ ثانیه، بهازای توکن جدا) | v2 کش بادوامتر را جدا اضافه میکند، این را پاک نمیکند |

## محدودیتهای واقعی که تو طراحی لحاظ شدن

- **CSP فعلی:** `default-src 'none'; script-src 'self' 'unsafe-inline'; …; connect-src 'self' https://teylquevemmkrgswnwtx.supabase.co`.
  یعنی فایلهای `data/...` فقط اگه **رو همان Pages** باشن خوانده میشن (همان `'self'`).
  v2 هیچ آدرس تازهای به CSP اضافه نمیکند؛ آدرس Pages همان مبدأ سایت است.
  برای همین لایهٔ بوت بهجای `<script type="module">` درونخطی، یه فایل هممبدأ
  (`mc-v2/boot-inline.js`) شد تا `'self'` کافی باشد و CSP دست نخورد
  (`docs/ADD-ONE-LINE.md`).
- **WebRTC و STUN:** `connect-src` فقط `fetch` / XHR / WebSocket / EventSource و
  امثالش رو پوشش میده، نه `RTCPeerConnection` رو
  ([MDN](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src)،
  [W3C](https://lists.w3.org/Archives/Public/public-webrtc/2018Jan/0072.html)).
  پس اضافه کردن ۵ STUN رایگان **نیازی به تغییر CSP نداره**. v2 الان همونارو
  پیشفرض میذاره؛ TURN واقعی اختیاریه و فقط از `/api/v2?action=ice` سمتسرور میاد
  (`docs/STUN-TURN.md`). اگه هیچکدوم وصل نشد، **خودکار برمیگرده** به مسیر
  آفلاین/فعلی. محدودیت آیپی دستگاه همچنان صادقانه سر جاشه.
- **Pages رایگان:** ۱ گیگ فضا، ۱۰۰ گیگ ترافیک نرم در ماه، ۱۰ بیلد در ساعت.
  ZIP فشرده + رمزشده، تعداد فایلها و حجم را کم نگه میدارد. هیچ سرویس پولی اضافه نشد.
- **Pages عمومی است:** فقط متنِ رمزشده و پروفایل عمومی (بدون ایمیل/تلفن/هش رمز/توکن)
  آنجا میرود. کلیدها تو دستگاه / سرور میمانند، هرگز تو Pages یا مخزن عمومی نیستند.
- **`/api/v2` مستقر نشده:** نوشتن روی Pages نیاز به `GITHUB_TOKEN` سمتسرور دارد.
  کدش کامل نوشته شده، ولی تا اجازهٔ صاحب پروژه، هیچ Edge Function، secret یا
  تنظیماتی عوض نمیشود. حالت پیشفرض `mirror` است: رفتار کاربر دقیقاً مثل قبل.

## چیزهایی که عمداً «تأییدنشده» اعلام میشوند

- **ردیفها/مقادیر واقعی جدولها خوانده نشدند**؛ فقط ساختار از سورس، فایلهای
  اسکیما، و `information_schema` زنده تأیید شد. بکاپ واقعی از دادهٔ کاربران
  گرفته نشده (اسکریپت آماده است، ولی اجرا نشد تا اطلاعات حساس وارد workspace نشود).
- باندل درحالاجرای Edge، آبجکت Storage، بایتهای Pages و آخرین Actions ریلیز
  مستقلاً از محیط زنده واکشی نشدن؛ اظهارنظرها بر اساس سورس و مشاهدات قبلی است.
- هیچ پیام آزمایشی به کاربر واقعی فرستاده نشد.
- هیچ سرور TURNـی ساخته/مستقر نشد و هیچ حساب رایگان یا کلیدی گرفته نشد؛
  فقط ۵ STUN عمومی بهعنوان پیشفرض تو کد قرار گرفت (`docs/STUN-TURN.md`).
- جداسازی نقش سوپا فقط **تو کد و گزارش** انجام شد (`src/plane.js`،
  `migration/decouple.mjs`)؛ سوپای زنده خاموش نشد، هیچ ردیفی پاک نشد، و بکاپ
  واقعی ردیفها گرفته نشد (`docs/DECOUPLE.md`).
