/* MemeChat v2 — boot-inline.js
 * تنها خطی که به index.html اضافه میشود به این فایل اشاره میکند:
 *   <script src="./mc-v2/boot-inline.js"></script>
 * چرا فایل جدا؟ چون CSP فعلی script-src 'self' 'unsafe-inline' است و اسکریپت
 * ماژول درونخطی در بعضی مرورگرها با 'unsafe-inline' باز هم رد میشود. فایلِ
 * هممبدأ ('self') بدون تغییر CSP و بدون nonce/hash کار میکند.
 * هیچ تابع فعلی پاک نمیشود؛ boot.js اصل api() را نگه میدارد و قابل برگشت است.
 */
(function () {
  var url = new URL("mc-v2/src/boot.js", location.href).href;
  import(url).then(function (mod) {
    /* بدون آرگومان: window.MC_V2_CONFIG (اگر باشد) حرف آخر را میزند،
       وگرنه همان پیشفرض امن mirror اعمال میشود */
    mod.installMemeChatV2();
  }).catch(function (e) {
    /* اگر ماژول بار نشد، سایت دقیقاً مثل قبل کار میکند؛ خطا فقط ثبت میشود */
    try { console.warn("[mc-v2] boot skipped:", e && e.message); } catch (_) {}
  });
})();
