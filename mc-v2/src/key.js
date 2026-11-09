/* MemeChat v2 — key.js
 * کلید آرشیو هیچوقت تو GitHub / Pages / سورس کد نیست.
 * دو حالت کامل و قابل اجرا:
 *   device  → کلید تو خود دستگاه ساخته میشود؛ خود CryptoKey غیرقابل خروج است،
 *             ولی مادهٔ خام کلید تو IndexedDB همان دستگاه ذخیره میشود تا قابل
 *             پشتیبانگیری باشد (recoveryPhrase). این عبارت یک راز حساس است و
 *             نباید تو چت، مخزن یا Pages گذاشته شود.
 *             (محدودیت صادقانه: فقط همان دستگاه/مرورگر، یا کسی که عبارت بازیابی
 *             را دارد، آرشیو را میخواند؛ سرور نمیتواند بازش کند)
 *   session → کلید مخصوص همان حساب، فقط از طریق همان api() احرازشدهٔ فعلی تحویل میشود.
 *             (سرور توان ریاضی باز کردن آرشیو را دارد = همان سطح اعتماد سیستم فعلی)
 * سیستم Login در هیچکدام تغییر نمیکند؛ فقط توکن موجود خوانده میشود.
 */
import { generateRawKeyB64, importRawKeyB64, randomId, b64e, utf8 } from "./crypto.js";
import { createMemoryKv, createBrowserKv } from "./kv.js";

export function createDeviceKeyProvider({ kv = null, scope = "anon", storageKey = null } = {}) {
  const store = kv || (typeof indexedDB !== "undefined" ? createBrowserKv() : createMemoryKv());
  const k = storageKey || `archive-key:${scope}`;
  return {
    mode: "device",
    async key() {
      let raw = await store.get(k);
      if (!raw) { raw = await generateRawKeyB64(); await store.put(k, raw); }
      return importRawKeyB64(raw);
    },
    /** راز حساس: فقط برای پشتیبانگیری آفلاین توسط صاحب حساب، نه برای چت/مخزن/ Pages. */
    async recoveryPhrase() { return String(await store.get(k) || ""); },
    async importRecovery(raw) { await store.put(k, String(raw)); },
    async rotate() { const raw = await generateRawKeyB64(); await store.put(k, raw); return raw; },
    kvName: k,
  };
}

export function createSessionKeyProvider({ api, kv = null, scope = "anon" } = {}) {
  if (typeof api !== "function") throw new Error("KEY_API_REQUIRED");
  const store = kv || (typeof indexedDB !== "undefined" ? createBrowserKv() : createMemoryKv());
  const k = `archive-key-session:${scope}`;
  return {
    mode: "session",
    async key() {
      const cached = await store.get(k);
      if (cached) return importRawKeyB64(cached);
      const r = await api("/api/v2?action=key", { method: "POST", body: { scope, nonce: randomId("k-") } });
      if (!r || !r.ok || !r.data || !r.data.key) throw new Error("KEY_FETCH_FAILED");
      await importRawKeyB64(r.data.key); // اعتبارسنجی قبل از ذخیره
      await store.put(k, r.data.key);
      return importRawKeyB64(r.data.key);
    },
    async clear() { await store.del(k); },
    kvName: k,
  };
}

/** کلید آزمایشی فقط برای تستها / مهاجرت آفلاین؛ هرگز تو مرورگر تولید نمیشود. */
export function createStaticKeyProvider(rawB64) {
  return { mode: "static", key: async () => importRawKeyB64(rawB64) };
}
