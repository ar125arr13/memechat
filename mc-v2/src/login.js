/* MemeChat v2 — login.js
 * «دست نزن»: سیستم ورود فعلی دقیقاً همونجوریه که بود.
 * این فایل فقط میخونه mc_token و me رو، تا بقیهٔ لایهها بدونن کش مال کدوم حسابه.
 * هیچ اتصال WebRTC، هیچ توکن تازه، هیچ تغییری تو /api/auth ایجاد نمیکنه.
 */
export function createLoginBridge({ storage = globalThis.localStorage, getMe = () => globalThis.me || null, onChange = null } = {}) {
  function token() { try { return String(storage.getItem("mc_token") || ""); } catch (e) { return ""; } }
  function me() { try { return getMe(); } catch (e) { return null; } }
  function userId() { const u = me(); return String((u && (u.id || u.user_id)) || token() || "anon"); }
  function scope() { return "u:" + userId().replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 80); }
  function isLoggedIn() { return !!token(); }
  let last = token();
  function check() {
    const t = token();
    if (t !== last) { last = t; if (typeof onChange === "function") onChange({ token: t, userId: userId() }); }
  }
  function startWatching(intervalMs = 1500) {
    check();
    let timer = null;
    const hasEvents = typeof globalThis.addEventListener === "function";
    if (hasEvents) globalThis.addEventListener("storage", check);
    if (typeof globalThis.setInterval === "function") timer = globalThis.setInterval(check, intervalMs);
    return function stopWatching() {
      if (timer !== null && typeof globalThis.clearInterval === "function") globalThis.clearInterval(timer);
      if (hasEvents && typeof globalThis.removeEventListener === "function") globalThis.removeEventListener("storage", check);
    };
  }
  return { token, me, userId, scope, isLoggedIn, check, startWatching };
}
