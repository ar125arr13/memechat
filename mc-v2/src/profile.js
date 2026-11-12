/* MemeChat v2 — profile.js
 * پروفایل عمومی از همان GitHub Pages خونده میشه (همان آدرس سایت، بدون سرویس تازه).
 * اطلاعات خصوصی و احراز هویت همچنان از سیستم فعلی میان و هیچوقت عمومی نمیشن.
 */
import { publicProfilePath, publicProfile } from "./archive.js";

const PUBLIC_FIELDS = ["id", "username", "name", "avatar", "bio", "role", "blue_tick", "green_tick", "theme"];

export function createProfileReader({ pagesBase = "", fetchFn = (...a) => globalThis.fetch(...a), legacyCard = null, cacheTtlMs = 300000 } = {}) {
  const base = String(pagesBase || "").replace(/\/+$/, "");
  const mem = new Map();
  function urlFor(username) {
    const path = publicProfilePath(username);
    const here = new URL((globalThis.document && globalThis.document.baseURI) ||
      (globalThis.location && globalThis.location.href) || "https://memechat.local/");
    const root = new URL(base || ".", here);
    if (!root.pathname.endsWith("/")) root.pathname += "/";
    root.search = ""; root.hash = "";
    return new URL(path, root).toString();
  }
  function sanitize(raw) {
    if (!raw || typeof raw !== "object") return null;
    const out = {};
    for (const f of PUBLIC_FIELDS) if (Object.prototype.hasOwnProperty.call(raw, f)) out[f] = raw[f];
    return out.id || out.username ? out : null;
  }
  async function load(username) {
    const k = String(username || "").toLowerCase();
    if (!k) return null;
    const hit = mem.get(k);
    if (hit && Date.now() - hit.t < cacheTtlMs) return hit.v;
    try {
      const r = await fetchFn(urlFor(k), { cache: "no-store" });
      if (r && r.ok) {
        const v = sanitize(await r.json());
        if (v) { mem.set(k, { t: Date.now(), v }); return v; }
      }
    } catch (e) { /* مسیر فعلی همچنان هست */ }
    if (legacyCard) {
      try {
        const v = await legacyCard(k);
        const s = sanitize(publicProfile(v && (v.user || v.data || v)));
        if (s) { mem.set(k, { t: Date.now(), v: s }); return s; }
      } catch (e) {}
    }
    return null;
  }
  return { load, sanitize, urlFor, clear: () => mem.clear() };
}
