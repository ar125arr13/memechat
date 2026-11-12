/* MemeChat v2 — signaling.js
 * فقط «راه انداختن اتصال»: از همان مسیرهای rt-post / rt-get / rt-clear موجود در /api/chat
 * استفاده میکند (هیچ Edge Function تازهای لازم نیست، هیچ جدول تازهای لازم نیست).
 * متن پیام، فایل، توکن یا کلید خصوصی هرگز از این مسیر رد نمیشود.
 */
import { utf8, sha256Hex, randomId, signBytes, verifyBytes, exportPublicJwk } from "./crypto.js";

const ALLOWED_KEYS = ["v", "kind", "n", "t", "sdp", "candidate", "eph", "id", "sig", "ack"];
const FORBIDDEN_KEYS = [
  "text", "body", "message", "msg", "file", "media", "token", "password",
  "password_hash", "email", "phone", "privateKey", "d",
  /* رمز/پیکربندی TURN نباید حتی اشتباهی وارد سیگنالینگ عمومی شود */
  "credential", "iceServers", "apiKey", "username", "secret",
];

export function assertConnectionOnly(data) {
  const o = data && typeof data === "object" ? data : {};
  for (const k of Object.keys(o)) {
    if (FORBIDDEN_KEYS.includes(k)) throw new Error("SIGNALING_PLAINTEXT_FORBIDDEN:" + k);
    if (!ALLOWED_KEYS.includes(k)) throw new Error("SIGNALING_UNKNOWN_FIELD:" + k);
  }
  if (typeof o.sdp === "string" && o.sdp.length > 20000) throw new Error("SIGNALING_SDP_TOO_LARGE");
  const s = JSON.stringify(o);
  if (s.length > 18000) throw new Error("SIGNALING_PAYLOAD_TOO_LARGE");
  return o;
}

export function createSignaling({ api, room, selfId, ttlMs = 90000, now = () => Date.now(), pollMs = 1200, sleep = ms => new Promise(r => setTimeout(r, ms)) }) {
  if (typeof api !== "function") throw new Error("SIGNALING_API_REQUIRED");
  if (!/^[a-z0-9_-]{6,64}$/.test(String(room || ""))) throw new Error("SIGNALING_BAD_ROOM");
  const seen = new Set();
  let stopped = false;

  async function post(kind, payload = {}, signWith = null, idJwk = null) {
    const base = { v: 2, kind: String(kind).slice(0, 16), n: randomId("n-"), t: now() };
    let data = assertConnectionOnly({ ...base, ...payload });
    if (signWith) {
      const bytes = utf8(JSON.stringify({ n: data.n, eph: data.eph, kind: data.kind, t: data.t, room }));
      data = assertConnectionOnly({ ...data, sig: await signBytes(signWith, bytes), id: idJwk || null });
    }
    const r = await api("/api/chat?action=rt-post", { method: "POST", body: { room, kind: data.kind, data } });
    if (!r || !r.ok) throw new Error("SIGNALING_POST_FAILED:" + (r && r.status));
    return data.n;
  }
  async function poll() {
    const r = await api(`/api/chat?action=rt-get&room=${encodeURIComponent(room)}`, { noCache: true });
    const list = (r && r.data && Array.isArray(r.data.events)) ? r.data.events : [];
    const fresh = [];
    for (const e of list) {
      if (!e || !e.seq || seen.has(e.seq)) continue;
      if (e.from && selfId && String(e.from) === String(selfId)) continue;
      /* rt-get قدیمی timestamp را لایهٔ بیرونی میفرستد؛ بستهٔ جدید داخل d هم دارد */
      const ts = Number(e.t != null ? e.t : (e.d && e.d.t)) || 0;
      if (ts && now() - ts > ttlMs) continue;                                  // خیلی قدیمی
      if (ts && ts > now() + 60000) continue;                                   // آینده / ساعت ناجور
      let d = e.d;
      try { d = typeof d === "string" ? JSON.parse(d) : d; assertConnectionOnly(d); } catch (err) { continue; }
      seen.add(e.seq);
      fresh.push({ seq: e.seq, from: e.from, kind: e.k, data: d });
    }
    return fresh;
  }
  async function verifySignal(sig, identityJwk) {
    if (!sig || !identityJwk) return false;
    const bytes = utf8(JSON.stringify({ n: sig.n, eph: sig.eph, kind: sig.kind, t: sig.t, room }));
    try { return await verifyBytes(identityJwk, sig.sig, bytes); } catch (e) { return false; }
  }
  async function clear() {
    const r = await api("/api/chat?action=rt-clear", { method: "POST", body: { room } });
    return !!(r && r.ok);
  }
  async function waitFor(kind, timeoutMs = 30000) {
    const until = now() + timeoutMs;
    while (!stopped && now() < until) {
      const events = await poll();
      const hit = events.find(e => e.kind === kind || e.data.kind === kind);
      if (hit) return hit;
      await sleep(Math.min(pollMs, Math.max(50, until - now())));
    }
    throw new Error("SIGNALING_TIMEOUT:" + kind);
  }
  return { post, poll, clear, waitFor, verifySignal, assertConnectionOnly, room, stop: () => { stopped = true; }, isStopped: () => stopped };
}

/** نام اتاق از روی موضوع گفتگو: فقط حروف مجاز، قابل تکرار، بدون فاش کردن اسم گفتگو. */
export async function signalingRoom(conversationId, prefix = "mcv2") {
  const h = await sha256Hex(utf8("memechat-signal|" + String(conversationId || "")));
  return (prefix + h.slice(0, 40)).toLowerCase();
}
export async function selfPublicJwk(identity) { return exportPublicJwk(identity.publicKey); }
