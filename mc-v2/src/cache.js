/* MemeChat v2 — cache.js
 * تاریخچه فقط بعد از «کامل و سالم بودن» تو Cache مرورگر گذاشته میشه.
 * نسخه + هش: اگه نسخه عوض شد، فایل جدید میاد؛ قدیمی هیچوقت جای جدید نشون داده نمیشه.
 * اگه دانلود نشد یا فایل خراب بود → استثناء میده تا لایهٔ بالا بره سراغ مسیر فعلی (هیچ پیامی گم نمیشه).
 * کش برای هر حساب جداست (همون تفکیک دادهٔ محلی میمچت).
 */
import { toBytes, utf8, sha256Hex } from "./crypto.js";
import { historyKey, currentPathFromKey, openArchive } from "./archive.js";

export class ArchiveUnavailable extends Error {
  constructor(message, cause) { super(message); this.name = "ArchiveUnavailable"; this.cause = cause; }
}
function cacheName(scope) { return `memechat-history-v2:${scope || "anon"}`; }

export function createHistoryCache({ scope = "anon", pagesBase = "", fetchFn = (...a) => globalThis.fetch(...a), cacheStorage = globalThis.caches, key, now = () => Date.now() } = {}) {
  if (!key) throw new Error("CACHE_ARCHIVE_KEY_REQUIRED");
  const cs = cacheStorage;
  const base = String(pagesBase || "").replace(/\/+$/, "");
  function url(path) {
    const rel = path.replace(/^\/+/, "");
    /* آدرس پایه چه مطلق باشد چه نسبی، URL API کوئری/هش و زیرمسیر /memechat/ را درست نگه میدارد */
    const here = new URL((globalThis.document && globalThis.document.baseURI) ||
      (globalThis.location && globalThis.location.href) || "https://memechat.local/");
    const root = new URL(base || ".", here);
    if (!root.pathname.endsWith("/")) root.pathname += "/";
    root.search = ""; root.hash = "";
    return new URL(rel, root).toString();
  }
  async function open() {
    if (!cs || typeof cs.open !== "function") throw new ArchiveUnavailable("CACHE_API_UNAVAILABLE");
    return cs.open(cacheName(scope));
  }
  async function readCurrent(conversationId) {
    const hKey = await historyKey(conversationId);
    const r = await fetchFn(url(currentPathFromKey(hKey)) + `?_=${now()}`, { cache: "no-store" });
    if (!r || !r.ok) throw new ArchiveUnavailable("CURRENT_FETCH_FAILED:" + (r && r.status));
    let cur;
    try { cur = JSON.parse(await r.text()); } catch (e) { throw new ArchiveUnavailable("CURRENT_BAD_JSON", e); }
    if (!cur || cur.historyKey !== hKey || !cur.path || !/^[0-9a-f]{64}$/.test(cur.sha256 || "")) {
      throw new ArchiveUnavailable("CURRENT_INVALID");
    }
    return cur;
  }
  async function load(conversationId) {
    const cur = await readCurrent(conversationId);
    const c = await open();
    const u = url(cur.path) + `?v=${encodeURIComponent(cur.sha256)}`;
    const hit = await c.match(u);
    if (hit) {
      const bytes = toBytes(await hit.arrayBuffer());
      if (await sha256Hex(bytes) === cur.sha256) {
        try {
          const parsed = await openArchive(key, bytes, { expectedHistoryKey: cur.historyKey, expectedVersion: cur.version });
          return { ...parsed, version: cur.version, cached: true, stale: false, mode: cur.mode || "legacy" };
        } catch (e) { await c.delete(u); throw new ArchiveUnavailable("CACHED_ARCHIVE_CORRUPT:" + e.message, e); }
      }
      await c.delete(u);
    }
    const r = await fetchFn(url(cur.path), { cache: "no-store" });
    if (!r || !r.ok) throw new ArchiveUnavailable("ARCHIVE_FETCH_FAILED:" + (r && r.status));
    const bytes = toBytes(await r.arrayBuffer());
    if (await sha256Hex(bytes) !== cur.sha256) throw new ArchiveUnavailable("ARCHIVE_HASH_MISMATCH");
    const parsed = await openArchive(key, bytes, { expectedHistoryKey: cur.historyKey, expectedVersion: cur.version });
    try { await c.put(u, new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } })); } catch (e) { /* جا کم بود: فقط کش نمیشه، داده سالمه */ }
    return { ...parsed, version: cur.version, cached: false, stale: false, mode: cur.mode || "legacy" };
  }
  async function purge() {
    if (!cs || typeof cs.delete !== "function") return false;
    return cs.delete(cacheName(scope));
  }
  return { load, readCurrent, purge, cacheName: cacheName(scope), url };
}
