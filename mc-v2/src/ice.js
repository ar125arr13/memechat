/* MemeChat v2 — ice.js
 * STUN/TURN یعنی «آینه» و «پُستچی» برای وصل شدن دو گوشی پشت اینترنت.
 * - STUN فقط آدرس بیرونی دستگاه را پیدا میکند؛ رایگان و بدون رمز است.
 * - TURN وقتی وصل مستقیم نشد، بستهها را رد میکند؛ اسم کاربری/رمز میخواهد.
 *
 * قانون امنیتی: هیچ رمز TURN در کد عمومی، Pages یا تنظیمات درونصفحه نیست.
 * رمز فقط میتواند از `/api/v2?action=ice` (سمت سرور، همان توکن ورود فعلی) بیاید.
 * هر خطا → فقط همان چند STUN رایگان میماند؛ پیام هرگز گم نمیشود و مسیر قدیمی
 * همچنان پشتیبان است.
 */
export const DEFAULT_STUN_SERVERS = Object.freeze([
  "stun:stun.l.google.com:19302",
  "stun:stun1.l.google.com:19302",
  "stun:stun.cloudflare.com:3478",
  "stun:stun.services.mozilla.com",
  "stun:openrelay.metered.ca:80",
]);

const ICE_URL = /^(stun|stuns|turn|turns):[^\s/?#]+(?::\d{1,5})?(?:\?transport=(udp|tcp))?$/i;

/** فقط شکل مجاز ICE قبول میشود؛ از ورود آدرس عجیب یا فایل/اسکریپت جلوگیری میکند. */
export function normalizeIceServers(input, { allowCredentials = false, max = 10 } = {}) {
  if (!input) return [];
  const list = Array.isArray(input) ? input : [input];
  const out = [];
  for (const item of list.slice(0, max)) {
    const entryIn = typeof item === "string" ? { urls: item } : item;
    if (!entryIn || typeof entryIn !== "object") throw new Error("ICE_BAD_ENTRY");
    const rawUrls = entryIn.urls !== undefined ? entryIn.urls : entryIn.url;
    const urls = (Array.isArray(rawUrls) ? rawUrls : [rawUrls])
      .map(u => String(u || "").trim()).filter(Boolean);
    if (!urls.length) throw new Error("ICE_NO_URL");
    for (const u of urls) if (!ICE_URL.test(u)) throw new Error("ICE_BAD_URL:" + u.slice(0, 80));
    const isTurn = urls.some(u => /^turns?:/i.test(u));
    const entry = { urls: urls.length === 1 ? urls[0] : urls };
    if (entryIn.username !== undefined || entryIn.credential !== undefined) {
      if (!allowCredentials) throw new Error("ICE_PUBLIC_CREDENTIAL_FORBIDDEN");
      if (!isTurn) throw new Error("ICE_STUN_CREDENTIAL_FORBIDDEN");
      if (entryIn.username !== undefined) entry.username = String(entryIn.username);
      if (entryIn.credential !== undefined) entry.credential = String(entryIn.credential);
    }
    if (entryIn.credentialType !== undefined) entry.credentialType = String(entryIn.credentialType);
    out.push(entry);
  }
  return out;
}

/** برای لاگ/نمایش: رمزها هرگز چاپ نمیشوند. */
export function redactIceServers(servers) {
  return normalizeIceServers(servers, { allowCredentials: true }).map(s => {
    const o = { ...s };
    if (o.credential !== undefined) o.credential = "***";
    return o;
  });
}

/**
 * حالتها:
 *   off      → [] (فقط شبکهٔ محلی)
 *   stun     → پیشفرض رایگان (بدون هیچ درخواست اضافهای)
 *   custom   → آرایهٔ بدون رمز که صاحب پروژه داده (باز هم عمومی است)
 *   server   → `/api/v2?action=ice`؛ رمز TURN فقط آنجا، پشت همان ورود فعلی
 *   function → تابع async صاحب پروژه (بدون رمز عمومی)
 */
export function createIceProvider({
  api = null, mode = "stun", servers = null, custom = null,
  cacheTtlMs = 300000, now = () => Date.now(),
} = {}) {
  const defaults = normalizeIceServers(DEFAULT_STUN_SERVERS);
  let cached = null, cachedAt = 0;

  async function fromServer() {
    if (typeof api !== "function") throw new Error("ICE_API_REQUIRED");
    const r = await api("/api/v2?action=ice", { method: "GET", noCache: true });
    if (!r || !r.ok || !r.data || r.data.success !== true || !Array.isArray(r.data.iceServers)) {
      throw new Error("ICE_SERVER_FETCH_FAILED:" + (r && r.status));
    }
    return normalizeIceServers(r.data.iceServers, { allowCredentials: true });
  }

  return async function iceProvider() {
    if (cached && now() - cachedAt < cacheTtlMs) return cached;
    let out;
    try {
      if (servers) out = normalizeIceServers(servers, { allowCredentials: false });
      else if (mode === "off") out = [];
      else if (mode === "custom") out = normalizeIceServers([], { allowCredentials: false });
      else if (mode === "server") out = await fromServer();
      else if (mode === "function" && typeof custom === "function") {
        out = normalizeIceServers(await custom(), { allowCredentials: false });
      } else out = defaults;
    } catch (e) {
      /* شکست TURN/پیکربندی نباید پیامرسان را بشکند: همان STUN رایگان میماند */
      out = defaults;
    }
    cached = out; cachedAt = now();
    return out;
  };
}
