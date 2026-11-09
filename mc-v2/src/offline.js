/* MemeChat v2 — offline.js
 * پیام آفلاین → مسیر ذخیرهسازی پشتیبان، جدا از WebRTC.
 * صف تو IndexedDB خود دستگاه است (بهازای هر حساب جدا).
 * قانون قدیمی میمچت اینجا هم رعایت میشود: «اول مطمئن شو رسید، بعد پاک کن».
 * یعنی رکورد فقط بعد از تأیید هش مقصد از صف بیرون میرود، و هیچ دادهٔ قدیمی
 * Supabase هرگز پاک نمیشود.
 */
import { utf8, fromUtf8, b64e, toBytes, sha256Hex, randomId, encryptBlob } from "./crypto.js";
import { createMemoryKv, createBrowserKv } from "./kv.js";
import { buildArchive, archivePath, historyKey, buildIndex, buildCurrent } from "./archive.js";

export function createOutbox({ kv = null, scope = "anon", batchSize = 20, flushEveryMs = 8000, now = () => Date.now() } = {}) {
  const store = kv || (typeof indexedDB !== "undefined" ? createBrowserKv() : createMemoryKv());
  const key = `offline-outbox:${scope}`;
  async function all() { return (await store.get(key)) || []; }
  async function save(list) { await store.put(key, list); }
  async function enqueue(message) {
    const list = await all();
    const item = { clientId: message.clientId || randomId("c-"), ts: now(), attempts: 0, message };
    if (list.some(x => x.clientId === item.clientId)) return item;
    list.push(item); await save(list);
    return item;
  }
  async function pending() { return (await all()).filter(x => x.status !== "confirmed"); }
  async function markConfirmed(ids) {
    const set = new Set(ids);
    const list = await all();
    /* نسخهٔ قابل بازیابی باقی میماند: فقط علامت میخورَد، پاک نمیشود. */
    await save(list.map(x => set.has(x.clientId) ? { ...x, status: "confirmed", confirmedAt: now() } : x));
  }
  async function bumpAttempts(ids) {
    const set = new Set(ids);
    const list = await all();
    await save(list.map(x => set.has(x.clientId) ? { ...x, attempts: (x.attempts || 0) + 1, status: "pending" } : x));
  }
  return { enqueue, pending, all, markConfirmed, bumpAttempts, batchSize, flushEveryMs, key };
}

/** نوشتن بستهٔ رمزشدۀ آفلاین روی Pages، از طریق نویسندۀ سمتسرور (هیچ توکنی تو مرورگر نیست). */
export function createPagesSink({ api, keyProvider, pagesBase = "", fetchFn = null } = {}) {
  if (typeof api !== "function") throw new Error("SINK_API_REQUIRED");
  return {
    name: "pages",
    async append({ conversationId, version, messages, profiles = [], mode = "legacy" }) {
      const key = await keyProvider.key();
      const built = await buildArchive(key, { conversationId, version, messages, profiles, source: "offline" });
      const sha256 = await sha256Hex(built.bytes);
      const hKey = built.historyKey;
      const idxBytes = buildIndex({ historyKey: hKey, version, path: built.path, sha256 });
      const curBytes = buildCurrent({ historyKey: hKey, version, path: built.path, sha256, mode });
      const r = await api("/api/v2?action=append", {
        method: "POST",
        body: {
          conversationId: String(conversationId),
          files: [
            { path: built.path, content: b64e(built.bytes), sha256 },
            { path: `data/history/${hKey.slice(0, 2)}/${hKey}/index-v${version}.json`, content: b64e(idxBytes) },
            { path: `data/history/${hKey.slice(0, 2)}/${hKey}/current.json`, content: b64e(curBytes) },
          ],
        },
      });
      if (!r || !r.ok || !r.data || !r.data.success) throw new Error("SINK_APPEND_FAILED:" + (r && r.status));
      if (r.data.sha256 && r.data.sha256 !== sha256) throw new Error("SINK_HASH_MISMATCH");
      if (!r.data.commitSha) throw new Error("SINK_NO_COMMIT_CONFIRMATION");
      return { sha256, commitSha: r.data.commitSha, path: built.path, version };
    },
  };
}

/** مسیر فعلی (همان /api/chat?action=send) دستنخورده باقی میماند و همیشه بهعنوان پشتیبان هست. */
export function createLegacySink({ api } = {}) {
  return {
    name: "legacy",
    async send(message) {
      const r = await api("/api/chat?action=send", { method: "POST", body: message });
      if (!r || !r.ok) throw new Error("LEGACY_SEND_FAILED:" + (r && r.status));
      return { ok: true, data: r.data };
    },
  };
}
