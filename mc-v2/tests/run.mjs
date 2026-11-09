/* MemeChat v2 — tests/run.mjs  (بدون وابستگی خارجی؛ node tests/run.mjs) */
import assert from "node:assert/strict";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { utf8, fromUtf8, b64e, b64d, sha256Hex, randomBytes, generateIdentity, exportPublicJwk,
  generateEphemeral, deriveSessionKey, encryptMessage, decryptMessage, encryptBlob, decryptBlob,
  generateRawKeyB64, importRawKeyB64, signBytes, verifyBytes } from "../src/crypto.js";
import { createZip, readZip, crc32 } from "../src/zip.js";
import { buildArchive, openArchive, historyKey, publicProfile, buildCurrent, buildIndex } from "../src/archive.js";
import { createHistoryCache, ArchiveUnavailable } from "../src/cache.js";
import { createMemoryKv, createBrowserKv } from "../src/kv.js";
import { createLoginBridge } from "../src/login.js";
import { createProfileReader } from "../src/profile.js";
import { createDeviceKeyProvider, createSessionKeyProvider, createStaticKeyProvider } from "../src/key.js";
import { createOutbox, createPagesSink } from "../src/offline.js";
import { assertConnectionOnly, createSignaling, signalingRoom } from "../src/signaling.js";
import { normalizeIceServers, createIceProvider, redactIceServers, DEFAULT_STUN_SERVERS } from "../src/ice.js";
import { resolvePeerIceServers } from "../src/rtc.js";
import { handleV2 } from "../edge/v2-handler.js";
import { installMemeChatV2 } from "../src/boot.js";
import { createBackup } from "../migration/backup.mjs";
import { exportArchives } from "../migration/export.mjs";
import { verifyMigration } from "../migration/verify.mjs";
import { makeFixture } from "../migration/fixture.mjs";

let passed = 0;
async function t(name, fn) { try { await fn(); passed++; console.log("  ok  " + name); } catch (e) { console.error("FAIL  " + name + "\n" + (e && e.stack || e)); process.exitCode = 1; } }

/* --- کش شبیهساز Cache API --- */
function mockCacheStorage() {
  const stores = new Map();
  return {
    async open(name) {
      if (!stores.has(name)) {
        const m = new Map();
        stores.set(name, { match: async u => m.get(String(u)) || undefined,
          put: async (u, r) => m.set(String(u), r), delete: async u => m.delete(String(u)),
          size: () => m.size });
      }
      return stores.get(name);
    },
    async delete(name) { const had = stores.has(name); stores.delete(name); return had; },
    count: () => stores.size, stores,
  };
}
function okFetch(map) {
  let calls = 0;
  const fn = async (url) => {
    calls++;
    const u = String(url).split("?")[0];
    const key = [...map.keys()].find(k => u.endsWith(k));
    if (!key) return { ok: false, status: 404 };
    const bytes = map.get(key);
    return { ok: true, status: 200, arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), text: async () => fromUtf8(bytes) };
  };
  fn.calls = () => calls;
  return fn;
}

await t("crypto: b64 / sha / random / ECDH / AES-GCM", async () => {
  const b = randomBytes(70000);
  assert.equal(b.length, 70000);
  assert.deepEqual([...b64d(b64e(b))], [...b]);
  assert.equal((await sha256Hex(utf8("abc"))).length, 64);
  const a = await generateEphemeral(), c = await generateEphemeral();
  const ja = await exportPublicJwk(a.publicKey), jc = await exportPublicJwk(c.publicKey);
  const k1 = await deriveSessionKey(a.privateKey, jc, "salt", "ctx");
  const k2 = await deriveSessionKey(c.privateKey, ja, "salt", "ctx");
  const env = await encryptMessage(k1, { text: "سلام پیامرسان" }, { conversationId: "t1", senderId: "u1", seq: 1 });
  const out = await decryptMessage(k2, env, { expectedConversationId: "t1", expectedSenderId: "u1" });
  assert.equal(out.payload.text, "سلام پیامرسان");
  assert.equal(out.seq, 1);
  await assert.rejects(() => decryptMessage(k2, env, { expectedConversationId: "t1", expectedSenderId: "u1", minSeq: 1 }), /REPLAY_OR_BAD_SEQ/);
  const bad = { ...env, ct: b64e(utf8("tampered")) };
  await assert.rejects(() => decryptMessage(k2, bad), /.*/);
  const id = await generateIdentity(), jwk = await exportPublicJwk(id.publicKey);
  const sig = await signBytes(id.privateKey, utf8("hello"));
  assert.equal(await verifyBytes(jwk, sig, utf8("hello")), true);
  assert.equal(await verifyBytes(jwk, sig, utf8("other")), false);
});

await t("zip: فشرده، CRC، نام فارسی، خرابکاری شناسایی شود", async () => {
  /* دادهٔ فشردهنشدنی: بخش اعظم فایل همان محتواست، پس دستکاری حتماً تو داده میافتد */
  const entries = [{ name: "manifest.json", data: JSON.stringify({ v: 2 }) }, { name: "پیامها.jsonl", data: "سلام\nدنیا\n" }, { name: "big.bin", data: randomBytes(50000) }];
  const z = await createZip(entries);
  const out = await readZip(z);
  assert.equal(out.length, 3);
  assert.equal(out[1].name, "پیامها.jsonl");
  assert.equal(fromUtf8(out[1].data), "سلام\nدنیا\n");
  assert.equal(out[2].data.length, 50000);
  assert.equal(crc32(out[1].data) > 0, true);
  const broken = new Uint8Array(z); broken[Math.floor(z.length * 0.2)] ^= 0x55;
  await assert.rejects(() => readZip(broken));
});

await t("archive: ساخت/باز کردن، هش، جلوگیری از دستکاری و کلید اشتباه", async () => {
  const raw = await generateRawKeyB64(), key = await importRawKeyB64(raw);
  const msgs = makeFixture().tables.mimchat_staging_messages.slice(0, 40);
  const b = await buildArchive(key, { conversationId: "chat-mcc-kowa-v1", version: 1, messages: msgs, profiles: [publicProfile(makeFixture().tables.mimchat_users[0])] });
  const o = await openArchive(key, b.bytes, { expectedHistoryKey: b.historyKey, expectedVersion: 1 });
  assert.equal(o.messages.length, 40);
  assert.equal(o.messages[7].id, msgs[7].id);
  assert.equal(JSON.stringify(o.messages[7]), JSON.stringify(msgs[7]));
  const wrong = await importRawKeyB64(await generateRawKeyB64());
  await assert.rejects(() => openArchive(wrong, b.bytes));
  const broken = utf8(fromUtf8(b.bytes).replace('"ct":"', '"ct":"A'));
  await assert.rejects(() => openArchive(key, broken));
  assert.equal((await historyKey("x")).length, 64);
  assert.equal(publicProfile({ id: "1", username: "a", email: "SECRET", password_hash: "SECRET" }).email, undefined);
});

await t("cache: بار دوم دانلود نمیشود، نسخهٔ جدید میآید، خراب/کهنه نشان داده نمیشود", async () => {
  const raw = await generateRawKeyB64(), key = await importRawKeyB64(raw);
  const topic = "pv-u1001-u1002";
  const hKey = await historyKey(topic);
  const b1 = await buildArchive(key, { conversationId: topic, version: 1, messages: [{ id: "m1", text: "قدیمی" }] });
  const sha1 = await sha256Hex(b1.bytes);
  const cur1 = buildCurrent({ historyKey: hKey, version: 1, path: b1.path, sha256: sha1 });
  const map = new Map([[b1.path, b1.bytes], [`data/history/${hKey.slice(0, 2)}/${hKey}/current.json`, cur1]]);
  const fetchFn = okFetch(map);
  const cs = mockCacheStorage();
  const c = createHistoryCache({ scope: "u:1001", key, fetchFn, cacheStorage: cs });
  const r1 = await c.load(topic);
  assert.equal(r1.cached, false); assert.equal(r1.messages[0].text, "قدیمی");
  const callsAfterFirst = fetchFn.calls();
  const r2 = await c.load(topic);
  assert.equal(r2.cached, true);
  assert.equal(fetchFn.calls() - callsAfterFirst, 1, "فقط current.json چک شد، فایل تاریخچه دوباره دانلود نشد");
  const b2 = await buildArchive(key, { conversationId: topic, version: 2, messages: [{ id: "m1", text: "قدیمی" }, { id: "m2", text: "جدید" }] });
  const sha2 = await sha256Hex(b2.bytes);
  map.set(b2.path, b2.bytes);
  map.set(`data/history/${hKey.slice(0, 2)}/${hKey}/current.json`, buildCurrent({ historyKey: hKey, version: 2, path: b2.path, sha256: sha2 }));
  const r3 = await c.load(topic);
  assert.equal(r3.version, 2); assert.equal(r3.messages.length, 2); assert.equal(r3.cached, false);
  /* هش اشتباه → استثناء، نه تاریخچهٔ کهنه */
  map.set(`data/history/${hKey.slice(0, 2)}/${hKey}/current.json`, buildCurrent({ historyKey: hKey, version: 2, path: b2.path, sha256: "0".repeat(64) }));
  await assert.rejects(() => c.load(topic), e => e instanceof ArchiveUnavailable);
  /* حساب دوم کش جدا دارد */
  const c2 = createHistoryCache({ scope: "u:1002", key, fetchFn, cacheStorage: cs });
  assert.notEqual(c.cacheName, c2.cacheName);
});

await t("login: دستنخورده، فقط خواندن توکن؛ تفکیک حسابها", async () => {
  const store = { getItem: k => k === "mc_token" ? "tok-A" : null };
  const l = createLoginBridge({ storage: store, getMe: () => ({ id: "u-1001" }) });
  assert.equal(l.isLoggedIn(), true); assert.equal(l.scope(), "u:u-1001");
  assert.equal(l.token(), "tok-A");
  let changed = 0;
  const l2 = createLoginBridge({ storage: { getItem: () => "tok-B" }, getMe: () => ({ id: "u-1002" }), onChange: () => changed++ });
  assert.equal(l2.scope(), "u:u-1002");
});

await t("profile: فقط فیلدهای عمومی، مسیر فعلی بهعنوان پشتیبان", async () => {
  const u = { id: "1", username: "sepehr", display_name: "سپهر", email: "x@y.z", password_hash: "SECRET", avatar: "a", role: "admin" };
  const pub = publicProfile(u);
  assert.equal(pub.name, "سپهر"); assert.equal(pub.email, undefined); assert.equal(pub.password_hash, undefined);
  const r = createProfileReader({ pagesBase: "", fetchFn: async () => ({ ok: false, status: 404 }), legacyCard: async () => ({ user: u }) });
  const out = await r.load("sepehr");
  assert.equal(out.username, "sepehr"); assert.equal(out.email, undefined);
});

await t("key: کلید تو دستگاه ساخته میشود و قابل چرخش است", async () => {
  const kv = createMemoryKv();
  const p = createDeviceKeyProvider({ kv, scope: "u1" });
  const k1 = await p.key();
  const raw = await p.recoveryPhrase();
  const p2 = createDeviceKeyProvider({ kv, scope: "u1" });
  const k2 = await p2.key();
  const env1 = await encryptBlob(k1, utf8("x"));
  assert.equal(fromUtf8(await decryptBlob(k2, env1)), "x");
  await p.rotate();
  const k3 = await p.key();
  await assert.rejects(() => decryptBlob(k3, env1));
});

await t("outbox: صف آفلاین، تأیید قبل از علامت، هیچ پاککردنی", async () => {
  const o = createOutbox({ kv: createMemoryKv(), scope: "u1" });
  const a = await o.enqueue({ topic: "t", text: "آفلاین ۱" });
  await o.enqueue({ topic: "t", text: "آفلاین ۲" });
  assert.equal((await o.pending()).length, 2);
  await o.markConfirmed([a.clientId]);
  assert.equal((await o.pending()).length, 1);
  assert.equal((await o.all()).length, 2, "رکورد تأییدشده پاک نشد، فقط علامت خورد");
  const dup = await o.enqueue({ clientId: a.clientId, text: "تکراری" });
  assert.equal(dup.clientId, a.clientId);
  assert.equal((await o.all()).length, 2);
});

await t("signaling: متن پیام/توکن/فایل ممنوع، TTL، پاکسازی", async () => {
  assert.throws(() => assertConnectionOnly({ text: "سلام" }), /PLAINTEXT_FORBIDDEN/);
  assert.throws(() => assertConnectionOnly({ token: "x" }), /PLAINTEXT_FORBIDDEN/);
  assert.throws(() => assertConnectionOnly({ file: {} }), /PLAINTEXT_FORBIDDEN/);
  assert.throws(() => assertConnectionOnly({ credential: "turn-secret" }), /PLAINTEXT_FORBIDDEN/);
  assert.throws(() => assertConnectionOnly({ iceServers: [{ urls: "turn:x:443" }] }), /PLAINTEXT_FORBIDDEN/);
  assert.doesNotThrow(() => assertConnectionOnly({ sdp: { type: "offer", sdp: "v=0" }, eph: { kty: "EC" }, n: "n-1" }));
  const posted = [];
  const api = async (p, o) => {
    if (p.indexOf("rt-post") >= 0) { posted.push(o.body); return { ok: true, status: 200, data: { success: true } }; }
    if (p.indexOf("rt-clear") >= 0) { posted.push({ clear: true }); return { ok: true, status: 200, data: { success: true } }; }
    if (p.indexOf("rt-get") >= 0) return { ok: true, status: 200, data: { events: [
      { seq: "s1", from: "peer", k: "offer", d: { v: 2, kind: "offer", n: "n2", t: 1, sdp: { type: "offer" } } },
      { seq: "s2", from: "peer", k: "offer", d: { v: 2, kind: "offer", n: "n3", t: 9999999999999, sdp: {} } },
    ] } };
    return { ok: false, status: 404 };
  };
  const sig = createSignaling({ api, room: "mcv2abcdef", selfId: "me", now: () => 1000, ttlMs: 5000 });
  await sig.post("hello", { eph: { kty: "EC" } });
  const evs = await sig.poll();
  assert.equal(evs.length, 1, "سیگنال منقضیشده و سیگنال خودی رد شدند");
  assert.equal(evs[0].data.kind, "offer");
  await sig.clear();
  assert.equal(posted.some(x => x.clear), true, "اطلاعات موقت بعد از استفاده پاک شد");
  assert.equal((await signalingRoom("t")).length <= 64, true);
});

await t("edge: متن خام/فیلد حساس/بازنویسی نسخهدار رد میشود", async () => {
  globalThis.__mcv2env = { GITHUB_TOKEN: "x", GITHUB_REPO: "o/r", BACKUP_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef" };
  const oldEnv = globalThis.process.env;
  globalThis.process.env = { ...oldEnv, ...globalThis.__mcv2env };
  const req = (action, body) => new Request("https://x/api/v2?action=" + action, { method: "POST", headers: { Authorization: "Bearer tok", "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const deps = { authenticate: async () => ({ id: "u-1", username: "a" }) };
  const keyRes = await handleV2(req("key", {}), deps);
  const keyData = await keyRes.json();
  assert.equal(keyRes.status, 200); assert.equal(keyData.key.length, 44);
  const bad = await handleV2(req("append", { files: [{ path: "data/history/ab/cd/v1.zip.enc", content: b64e(utf8("متن خام پیام")), sha256: "0".repeat(64) }] }), deps);
  assert.equal(bad.status, 502);
  assert.equal((await bad.json()).success, false);
  const noAuth = await handleV2(new Request("https://x/api/v2?action=key", { method: "POST", body: "{}" }), deps);
  assert.equal(noAuth.status, 401);
  /* شکل مسیردار هم پذیرفته میشود (پیشوند Supabase Function هم خرابش نمیکند) */
  const pathKey = await handleV2(new Request("https://x/functions/v1/mimchat-api/api/v2/key", {
    method: "POST", headers: { Authorization: "Bearer tok" }, body: "{}",
  }), deps);
  assert.equal(pathKey.status, 200); assert.equal((await pathKey.json()).key.length, 44);
  globalThis.process.env = oldEnv;
});

await t("edge/append: نوشتن تأییدشده، تکرار بیدردسر، بازنویسی ممنوع، متن خام رد", async () => {
  const oldEnv = globalThis.process.env;
  globalThis.process.env = { ...oldEnv, GITHUB_TOKEN: "fake", GITHUB_REPO: "owner/repo", BACKUP_ENCRYPTION_KEY: "0123456789abcdef0123456789abcdef" };
  const db = new Map(); let commitNo = 0;
  const fakeFetch = async (url, opts = {}) => {
    const u = String(url);
    if (u.includes("/git/commits/")) return { ok: true, status: 200, json: async () => ({ sha: u.split("/").pop() }) };
    if (u.includes("/contents/") && (!opts.method || opts.method === "GET")) {
      const key = decodeURIComponent(u.split("/contents/")[1].split("?")[0]);
      if (!db.has(key)) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => ({ sha: "blob-" + commitNo, content: db.get(key) }) };
    }
    if (u.includes("/contents/") && opts.method === "PUT") {
      const key = decodeURIComponent(u.split("/contents/")[1]);
      const body = JSON.parse(opts.body);
      db.set(key, body.content); commitNo++;
      return { ok: true, status: 201, json: async () => ({ commit: { sha: "commit-" + commitNo }, content: { sha: "blob-" + commitNo } }) };
    }
    return { ok: false, status: 404, json: async () => ({}) };
  };
  const deps = { authenticate: async () => ({ id: "u-1" }), fetchFn: fakeFetch };
  const raw = await generateRawKeyB64(), key = await importRawKeyB64(raw);
  const b = await buildArchive(key, { conversationId: "t1", version: 1, messages: [{ id: "m1", text: "سلام" }] });
  const sha = await sha256Hex(b.bytes);
  const path = b.path;
  const curPath = `data/history/${b.historyKey.slice(0, 2)}/${b.historyKey}/current.json`;
  const req = files => new Request("https://x/api/v2?action=append", { method: "POST", headers: { Authorization: "Bearer t" }, body: JSON.stringify({ files }) });
  const good = [{ path, content: b64e(b.bytes), sha256: sha }, { path: curPath, content: b64e(buildCurrent({ historyKey: b.historyKey, version: 1, path, sha256: sha })) }];
  const r1 = await handleV2(req(good), deps);
  const d1 = await r1.json();
  assert.equal(r1.status, 200); assert.equal(d1.success, true); assert.equal(d1.sha256, sha); assert.equal(d1.commitSha.startsWith("commit-"), true);
  /* همان محتوا دوباره → بیدردسر، بدون خطا (قابل اجرای دوباره) */
  const r2 = await handleV2(req(good), deps); const d2 = await r2.json();
  assert.equal(r2.status, 200); assert.equal(d2.success, true); assert.equal(d2.written[0].alreadyPresent, true);
  /* همان مسیر با محتوای متفاوت → بازنویسی ممنوع */
  const other = await buildArchive(key, { conversationId: "t1", version: 1, messages: [{ id: "m2", text: "دیگر" }] });
  const r3 = await handleV2(req([{ path, content: b64e(other.bytes), sha256: await sha256Hex(other.bytes) }]), deps);
  assert.equal(r3.status, 502); assert.equal((await r3.json()).success, false);
  /* متن خام → رد */
  const r4 = await handleV2(req([{ path: "data/history/aa/bb/v9.zip.enc", content: b64e(utf8("پیام خام")), sha256: "0".repeat(64) }]), deps);
  assert.equal(r4.status, 502);
  /* فایل حاوی ایمیل/توکن → رد */
  const r5 = await handleV2(req([{ path: "data/profiles/se/sepehr.json", content: b64e(utf8(JSON.stringify({ username: "sepehr", email: "x@y.z" }))) }]), deps);
  assert.equal(r5.status, 502);
  /* فیلد حساس حتی لابلای شیء تودرتو هم رد میشود */
  const r6 = await handleV2(req([{ path: "data/profiles/se/sepehr.json", content: b64e(utf8(JSON.stringify({ username: "sepehr", private: { contact: { email: "x@y.z" } } }))) }]), deps);
  assert.equal(r6.status, 502);
  globalThis.process.env = oldEnv;
});

await t("migration: backup → export → verify PASS، تکتک رکوردها یکیباشد", async () => {
  const dir = await mkdtemp(join(tmpdir(), "mcv2-"));
  try {
    const bDir = join(dir, "backup"), oDir = join(dir, "out");
    const b = await createBackup({ fixture: true, outDir: bDir });
    assert.equal(b.totalRows > 140, true);
    assert.equal(b.manifest.tableCount, 44, "همهٔ ۴۴ جدول زنده تو بکاپ هستند");
    const e = await exportArchives({ backupDir: bDir, outDir: oDir });
    assert.equal(e.totalMessages, 137);
    assert.equal(e.written.length, 2);
    assert.equal(e.users, 3);
    const v = await verifyMigration({ backupDir: bDir, outDir: oDir, keyB64: e.keyRaw });
    assert.equal(v.status, "PASS", JSON.stringify(v.errors));
    assert.equal(v.verifiedMessages, 137);
    assert.equal(v.checks.some(c => c.name === "backup_table_hashes_preserved" && c.ok), true);
    /* دستکاری یک رکورد → FAIL */
    const em = JSON.parse(fromUtf8(new Uint8Array(await readFile(join(oDir, "export-manifest.json")))));
    await writeFile(join(oDir, "export-manifest.json"), utf8(JSON.stringify({ ...em, totalMessages: 136 })));
    const v2 = await verifyMigration({ backupDir: bDir, outDir: oDir, keyB64: e.keyRaw });
    assert.equal(v2.status, "FAIL");
    /* تمام جدولهای کپی، از جمله حسابها و تنظیمات، سر جاشوندهستن */
    const m = JSON.parse(fromUtf8(new Uint8Array(await readFile(join(bDir, "manifest.json")))));
    assert.equal(m.tables.mimchat_users.rows, 3);
    assert.equal(m.tables.mimchat_settings.rows, 2);
    assert.equal(m.tables.conversations.rows, 1);
    assert.equal(m.tables.messages.rows, 1);
    assert.equal(m.tables.profile.rows, 1);
  } finally { await rm(dir, { recursive: true, force: true }); }
});


/* ---------- شبیهساز کوچک مرورگر: IndexedDB / Cache / Pages ---------- */
function fakeReq(result) {
  const r = { result, onsuccess: null, onerror: null };
  queueMicrotask(() => { if (r.onsuccess) r.onsuccess(); });
  return r;
}
function fakeIndexedDB() {
  const dbs = new Map();
  return {
    open(name) {
      const req = { result: null, error: null, onupgradeneeded: null, onsuccess: null, onerror: null };
      queueMicrotask(() => {
        let db = dbs.get(name);
        if (!db) {
          const data = new Map();
          const store = {
            get: k => fakeReq(data.get(k)),
            put: (v, k) => { data.set(k, v); return fakeReq(k); },
            delete: k => { data.delete(k); return fakeReq(undefined); },
            getAllKeys: () => fakeReq([...data.keys()]),
          };
          db = {
            objectStoreNames: { contains: () => true },
            createObjectStore: () => store,
            transaction: () => {
              const tx = { objectStore: () => store, oncomplete: null, onerror: null, onabort: null, error: null };
              /* بعد از microtask مربوط به onsuccess درخواست اجرا شود */
              setTimeout(() => { if (tx.oncomplete) tx.oncomplete(); }, 0);
              return tx;
            },
            close: () => {},
          };
          dbs.set(name, db);
          req.result = db;
          if (req.onupgradeneeded) req.onupgradeneeded();
        } else req.result = db;
        if (req.onsuccess) req.onsuccess();
      });
      return req;
    },
  };
}
function withGlobals(values, fn) {
  const keys = Object.keys(values), saved = {};
  for (const k of keys) saved[k] = globalThis[k];
  for (const k of keys) globalThis[k] = values[k];
  return Promise.resolve().then(fn).finally(() => {
    for (const k of keys) {
      if (saved[k] === undefined) delete globalThis[k];
      else globalThis[k] = saved[k];
    }
  });
}

await t("مرورگر: IndexedDB، کلید دستگاه و صف آفلاین با هم کار میکنند", async () => {
  await withGlobals({ indexedDB: fakeIndexedDB() }, async () => {
    const kv = createBrowserKv("mcv2-test", "kv");
    await kv.put("a", { x: 1 });
    assert.deepEqual(await kv.get("a"), { x: 1 });
    assert.deepEqual(await kv.keys(), ["a"]);
    await kv.del("a");
    assert.equal(await kv.get("a"), undefined);
    const provider = createDeviceKeyProvider({ kv, scope: "u-1001" });
    const k1 = await provider.key();
    assert.ok((await provider.recoveryPhrase()).length > 40);
    const provider2 = createDeviceKeyProvider({ kv, scope: "u-1001" });
    const k2 = await provider2.key();
    const env = await encryptBlob(k1, utf8("پیام"));
    assert.equal(fromUtf8(await decryptBlob(k2, env)), "پیام");
    const outbox = createOutbox({ kv, scope: "u-1001" });
    await outbox.enqueue({ clientId: "c-1", text: "آفلاین" });
    assert.equal((await outbox.pending()).length, 1);
    await outbox.markConfirmed(["c-1"]);
    assert.equal((await outbox.pending()).length, 0);
    assert.equal((await outbox.all()).length, 1, "رکورد تأییدشده پاک نشد");
  });
});

await t("Pages: زیرمسیر /memechat/، آدرس نسبی و مسیرهای /api/v2 درستند", async () => {
  const raw = await generateRawKeyB64(), key = await importRawKeyB64(raw);
  const here = "https://user.github.io/memechat/index.html?x=1";
  await withGlobals({ document: { baseURI: here }, location: { href: here } }, async () => {
    const cs = mockCacheStorage();
    const c = createHistoryCache({ scope: "u1", key, fetchFn: async () => ({ ok: false, status: 404 }), cacheStorage: cs });
    assert.equal(c.url("data/history/aa/bb/current.json"), "https://user.github.io/memechat/data/history/aa/bb/current.json");
    const c2 = createHistoryCache({ scope: "u1", key, pagesBase: "/memechat/", fetchFn: async () => ({ ok: false, status: 404 }), cacheStorage: cs });
    assert.equal(c2.url("data/history/aa/bb/current.json"), "https://user.github.io/memechat/data/history/aa/bb/current.json");
    const pr = createProfileReader({ pagesBase: "", fetchFn: async () => ({ ok: false, status: 404 }) });
    assert.equal(pr.urlFor("sepehr"), "https://user.github.io/memechat/data/profiles/se/sepehr.json");
  });
  /* کلید و نویسنده دقیقاً همان مسیری را صدا میزنند که Edge Function میشناسد */
  const calls = [];
  const api = async (p, o) => {
    calls.push(p);
    if (p.indexOf("action=key") >= 0) return { ok: true, status: 200, data: { key: raw } };
    const sha = o && o.body && o.body.files && o.body.files[0] ? o.body.files[0].sha256 : "0".repeat(64);
    return { ok: true, status: 200, data: { success: true, sha256: sha, commitSha: "commit-1" } };
  };
  const sp = createSessionKeyProvider({ api, kv: createMemoryKv(), scope: "u-1001" });
  await sp.key();
  assert.equal(calls[0], "/api/v2?action=key");
  const sink = createPagesSink({ api, keyProvider: createStaticKeyProvider(raw) });
  await sink.append({ conversationId: "pv-a-b", version: 1, messages: [{ id: "m1", text: "سلام" }] });
  assert.equal(calls[1], "/api/v2?action=append");
});

await t("boot: mirror هیچ تابعی رو خراب نمیکنه، خطا برمیگرده مسیر قدیمی، restore کامل", async () => {
  const originalApi = async (p, o) => ({ ok: true, status: 200, data: { success: true, from: "legacy", p, method: (o && o.method) || "GET" } });
  const calls = [];
  const wrappedApi = async (p, o) => { calls.push(p); return originalApi(p, o); };
  const listeners = new Map();
  const globals = {
    api: wrappedApi,
    me: { id: "u-1001" },
    localStorage: { getItem: k => k === "mc_token" ? "tok" : null },
    document: { baseURI: "https://user.github.io/memechat/" },
    location: { href: "https://user.github.io/memechat/" },
    caches: mockCacheStorage(),
    indexedDB: fakeIndexedDB(),
    fetch: async () => ({ ok: false, status: 404, text: async () => "", arrayBuffer: async () => new ArrayBuffer(0) }),
    addEventListener: (t, f) => { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t).add(f); },
    removeEventListener: (t, f) => { if (listeners.has(t)) listeners.get(t).delete(f); },
    dispatchEvent: e => { const set = listeners.get(e && e.type); if (set) for (const f of set) f(e); return true; },
    CustomEvent: class { constructor(type) { this.type = type; } },
  };
  await withGlobals(globals, async () => {
    const v2 = installMemeChatV2({ mode: "mirror", keyMode: "device", writerReady: false, pagesBase: "" });
    assert.equal(v2.mode, "mirror");
    assert.equal(v2.originals.api, wrappedApi);
    assert.notEqual(globalThis.api, wrappedApi, "لایه دور api() پیچیده شد");
    assert.equal((await v2.iceServers()).length, 5, "پیشفرض STUN رایگان وصل است، بدون TURN/رمز");
    const hist = await globalThis.api("/api/chat?action=history&topic=pv-a-b&limit=40", { noCache: true });
    assert.equal(hist.data.from, "legacy", "بستهٔ Pages نبود → همان مسیر فعلی");
    const sent = await globalThis.api("/api/chat?action=send", { method: "POST", body: { text: "x" } });
    assert.equal(sent.data.from, "legacy", "در mirror ارسال دستنخورده است");
    v2.restore();
    assert.equal(globalThis.api, wrappedApi, "restore تابع اصلی را برگرداند");
    assert.equal(globalThis.MemeChatV2, undefined);
    let left = 0; for (const set of listeners.values()) left += set.size;
    assert.equal(left, 0, "همهٔ شنوندهها و تایمرها جمع شدند");
  });
});


await t("STUN/TURN: پیشفرض رایگان، رمز عمومی ممنوع، خطا فقط STUN میماند", async () => {
  assert.equal(DEFAULT_STUN_SERVERS.length, 5);
  const stun = normalizeIceServers(DEFAULT_STUN_SERVERS);
  assert.equal(stun.length, 5);
  assert.equal(stun.every(s => /^stun:/.test(String(s.urls))), true);
  assert.throws(() => normalizeIceServers("javascript:alert(1)"), /ICE_BAD_URL/);
  assert.throws(() => normalizeIceServers({ urls: "turn:relay.example:443", credential: "secret" }), /ICE_PUBLIC_CREDENTIAL_FORBIDDEN/);
  const turn = normalizeIceServers({ urls: "turn:relay.example:443?transport=tcp", username: "u", credential: "p" }, { allowCredentials: true });
  assert.equal(turn[0].credential, "p");
  assert.equal(redactIceServers(turn)[0].credential, "***", "رمز تو لاگ چاپ نشد");
  const off = createIceProvider({ mode: "off" });
  assert.deepEqual(await off(), []);
  const fallback = createIceProvider({ mode: "server", api: async () => ({ ok: false, status: 500, data: {} }) });
  assert.equal((await fallback()).length, 5, "سرور TURN خراب شد → همان STUN رایگان");
  const calls = [];
  const server = createIceProvider({ mode: "server", api: async p => {
    calls.push(p);
    return { ok: true, status: 200, data: { success: true, iceServers: [
      ...DEFAULT_STUN_SERVERS,
      { urls: "turn:relay.example:443?transport=tcp", username: "u1", credential: "p1" },
    ] } };
  } });
  const got = await server();
  assert.equal(calls[0], "/api/v2?action=ice");
  assert.equal(got.length, 6);
  assert.equal(got[5].credential, "p1");
  const viaFn = await resolvePeerIceServers(async () => [{ urls: "stun:stun.l.google.com:19302" }]);
  assert.equal(viaFn.length, 1);
});

await t("edge/ice: STUN رایگان + TURN فقط از سرور، بدون لاگ رمز", async () => {
  const oldEnv = globalThis.process.env;
  const deps = { authenticate: async () => ({ id: "u-1", username: "a" }) };
  const req = () => new Request("https://x/api/v2?action=ice", { method: "GET", headers: { Authorization: "Bearer tok" } });
  globalThis.process.env = { ...oldEnv,
    MC_V2_TURN_URLS: "turn:relay.example:443?transport=tcp,turns:relay.example:5349",
    MC_V2_TURN_USERNAME: "u1", MC_V2_TURN_CREDENTIAL: "p1" };
  const r = await handleV2(req(), deps), d = await r.json();
  assert.equal(r.status, 200); assert.equal(d.success, true); assert.equal(d.turnConfigured, true);
  assert.equal(d.iceServers.length, 6, "۵ STUN + ۱ TURN با دو آدرس");
  const turn = d.iceServers[d.iceServers.length - 1];
  assert.equal(turn.username, "u1"); assert.equal(turn.credential, "p1");
  const noAuth = await handleV2(new Request("https://x/api/v2?action=ice", { method: "GET" }), deps);
  assert.equal(noAuth.status, 401);
  /* شکل مسیردار هم جواب میدهد */
  const pathRes = await handleV2(new Request("https://x/functions/v1/mimchat-api/api/v2/ice", {
    method: "GET", headers: { Authorization: "Bearer tok" },
  }), deps);
  assert.equal(pathRes.status, 200);
  /* پیکربندی JSON سمتسرور هم پذیرفته میشود */
  globalThis.process.env = { ...oldEnv, MC_V2_ICE_SERVERS_JSON: JSON.stringify([
    { urls: ["turn:relay2.example:443?transport=tcp"], username: "u2", credential: "p2" },
  ]) };
  const j = await handleV2(req(), deps), jd = await j.json();
  assert.equal(j.status, 200); assert.equal(jd.iceServers[jd.iceServers.length - 1].credential, "p2");
  /* ناقص → اعلام خطا، نه اینکه نصفه اجرا شود */
  globalThis.process.env = { ...oldEnv, MC_V2_TURN_URLS: "turn:relay.example:443", MC_V2_TURN_USERNAME: "u1" };
  const bad = await handleV2(req(), deps);
  assert.equal(bad.status, 503);
  globalThis.process.env = oldEnv;
});

console.log(`\n${passed} tests passed.`);
