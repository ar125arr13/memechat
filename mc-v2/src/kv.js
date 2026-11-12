/* MemeChat v2 — kv.js
 * یک لایهٔ خیلی نازک روی IndexedDB. مقدارها میتونن CryptoKey باشن (بدون export کردن).
 * هیچ چیزی از سیستم ورود فعلی رو عوض نمیکنه؛ فقط یه جای امن تو خود دستگاه میسازه.
 */
export function createMemoryKv() {
  const m = new Map();
  return {
    async get(k) { return m.has(k) ? m.get(k) : undefined; },
    async put(k, v) { m.set(k, v); },
    async del(k) { m.delete(k); },
    async keys() { return [...m.keys()]; },
  };
}

export function createBrowserKv(dbName = "memechat-v2", storeName = "kv") {
  function open() {
    return new Promise((resolve, reject) => {
      if (typeof indexedDB === "undefined") { reject(new Error("INDEXEDDB_UNAVAILABLE")); return; }
      const r = indexedDB.open(dbName, 1);
      r.onupgradeneeded = () => { if (!r.result.objectStoreNames.contains(storeName)) r.result.createObjectStore(storeName); };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error("INDEXEDDB_OPEN_FAILED"));
    });
  }
  async function tx(mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(storeName, mode);
      const s = t.objectStore(storeName);
      const req = fn(s);
      let out;
      if (req && typeof req === "object" && "onsuccess" in req) req.onsuccess = () => { out = req.result; };
      t.oncomplete = () => { db.close(); resolve(out); };
      t.onerror = () => { db.close(); reject(t.error || new Error("INDEXEDDB_TX_FAILED")); };
      t.onabort = () => { db.close(); reject(t.error || new Error("INDEXEDDB_TX_ABORTED")); };
    });
  }
  return {
    async get(k) { return tx("readonly", s => s.get(k)); },
    async put(k, v) { return tx("readwrite", s => s.put(v, k)); },
    async del(k) { return tx("readwrite", s => s.delete(k)); },
    async keys() { return tx("readonly", s => s.getAllKeys()); },
  };
}
