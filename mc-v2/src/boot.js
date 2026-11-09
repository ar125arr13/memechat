/* MemeChat v2 — boot.js
 * «یک خط به سایت اضافه میشود، هیچ تابع قدیمی پاک یا بازنویسی نمیشود.»
 * این فایل فقط دور توابع موجود یک لایهٔ نازک میپیچد و همیشه اصل تابع را نگه میدارد
 * (MemeChatV2.restore() همهچی را برمیگرداند). تا وقتی تأیید migration نیامده،
 * حالت پیشفرض mirror است: رفتار کاربر دقیقاً مثل قبل.
 *
 * حالتها:
 *   off    → هیچ کاری نمیکند
 *   mirror → فقط تاریخچه را، در صورت سالم بودن، از فایل فشرده میخواند؛ ارسال دستنخورده
 *   active → آنلاین WebRTC / آفلاین انبار پشتیبان / تاریخچه ZIP + Cache
 * در هر سه حالت، هر خطا → بازگشت خودکار به مسیر فعلی (هیچ پیامی گم نمیشود).
 */
import { createHistoryCache, ArchiveUnavailable } from "./cache.js";
import { createLoginBridge } from "./login.js";
import { createProfileReader } from "./profile.js";
import { createDeviceKeyProvider, createSessionKeyProvider } from "./key.js";
import { createOutbox, createPagesSink, createLegacySink } from "./offline.js";
import { createPeerLink, rtcSupported } from "./rtc.js";
import { createIceProvider, redactIceServers } from "./ice.js";
import { createSignaling, signalingRoom } from "./signaling.js";
import { createControlApi, describeSupabaseRole } from "./plane.js";

export function installMemeChatV2(config = {}) {
  const g = globalThis;
  const cfg = Object.assign({
    mode: "mirror",                 // off | mirror | active
    pagesBase: "",                  // همان آدرس Pages؛ پیشفرض همان مبدأ سایت
    keyMode: "session",             // session | device
    iceMode: "stun",                // off | stun | custom | server | function
    iceServers: null,               // فقط آرایهٔ بدون رمز؛ رمز TURN هرگز اینجا نباشد
    iceProvider: null,              // تابع async اختیاری، بدون رمز عمومی
    iceTransportPolicy: "all",      // یا relay اگه بخواهی حتماً از TURN رد شود
    iceCacheTtlMs: 300000,
    writerReady: false,             // تا نویسندۀ سمتسرور وصل نشده false بماند
    decouple: false,                // true → دادهٔ اصلی دیگر به Supabase نمیرود (بدون حذف چیزی)
    flushEveryMs: 8000,
  }, g.MC_V2_CONFIG || {}, config);

  const originals = {
    api: typeof g.api === "function" ? g.api : null,
    loadOlder: typeof g.loadOlder === "function" ? g.loadOlder : null,
    sendMsg: typeof g.sendMsg === "function" ? g.sendMsg : null,
  };
  if (!originals.api) throw new Error("V2_BOOT_NEEDS_ORIGINAL_API");
  const noSupabaseData = !!cfg.decouple;
  /* در حالت جداسازی، حتی مسیر پشتیبان داده هم بسته میشود؛ پیام تو صف دستگاه میماند. */
  const controlApi = createControlApi(originals.api, { decouple: noSupabaseData });

  const login = createLoginBridge({
    getMe: () => g.me || null,
    onChange: () => {
      try {
        if (typeof g.dispatchEvent === "function" && typeof g.CustomEvent === "function") {
          g.dispatchEvent(new g.CustomEvent("mc-v2-account-changed"));
        }
      } catch (e) {}
    },
  });
  const scope = login.scope();
  const keyProvider = cfg.keyMode === "device"
    ? createDeviceKeyProvider({ scope })
    : createSessionKeyProvider({ api: controlApi, scope });

  let cache = null;
  async function getCache() {
    if (cache) return cache;
    const key = await keyProvider.key();
    cache = createHistoryCache({ scope, pagesBase: cfg.pagesBase || "", key });
    return cache;
  }
  const profiles = createProfileReader({
    pagesBase: cfg.pagesBase || "",
    legacyCard: noSupabaseData ? null : async username => {
      const r = await controlApi("/api/chat?action=user-card&username=" + encodeURIComponent(username), { noCache: true });
      return r && r.data ? r.data : null;
    },
  });
  const outbox = createOutbox({ scope, flushEveryMs: cfg.flushEveryMs });
  const pagesSink = cfg.writerReady ? createPagesSink({ api: controlApi, keyProvider }) : null;
  const legacySink = createLegacySink({ api: controlApi });
  const ice = createIceProvider({
    api: controlApi, mode: cfg.iceMode, servers: cfg.iceServers,
    custom: cfg.iceProvider, cacheTtlMs: cfg.iceCacheTtlMs,
  });
  const peers = new Map();

  let installed = false, restoreFns = [], flushTimer = null;

  function wrapGlobal(name, replacement) {
    const before = g[name];
    g[name] = replacement;
    restoreFns.push(() => { g[name] = before; });
  }

  /* ---- history: بستهٔ تأییدشده، وگرنه همان مسیر فعلی ---- */
  async function readHistory(topic, query, opts) {
    try {
      const c = await getCache();
      const out = await c.load(topic);
      return { ok: true, status: 200, data: { success: true, messages: out.messages, hasMore: false, serverTime: Date.now(), v2: true, version: out.version, cached: out.cached } };
    } catch (e) {
      if (cfg.mode !== "off") { try { console.warn("[mc-v2] history fallback:", e && e.message); } catch (_) {} }
      if (noSupabaseData) {
        /* جداسازی: به جای خواندن دوباره از Supabase، صادقانه بگوییم بسته در دسترس نیست.
           هیچ ردیفی پاک نشده؛ کش/نسخهٔ قدیمی همچنان سر جاست. */
        return { ok: false, status: 503, data: { success: false, messages: [], v2: "pages-unavailable", error: "بستهٔ تاریخچه روی Pages در دسترس نیست؛ هیچ داده‌ای پاک نشد." } };
      }
      return controlApi(query, opts || {});
    }
  }

  async function queueOnly(body) {
    try {
      await outbox.enqueue(body);
      return { ok: true, status: 200, data: { success: true, v2: "offline-queued-decoupled" } };
    } catch (e) {
      return { ok: false, status: 503, data: { success: false, v2: "outbox-unavailable", error: "صف دستگاه در دسترس نیست؛ پیام به هیچ سرور قدیمی فرستاده نشد." } };
    }
  }

  /* ---- online: WebRTC، وگرنه آفلاین، وگرنه همان مسیر فعلی ---- */
  async function routeSend(body, path) {
    if (cfg.mode !== "active" || !rtcSupported()) {
      if (noSupabaseData) return queueOnly(body);
      return controlApi(path, { method: "POST", body });
    }
    const topic = String(body && body.topic || "");
    try {
      if (!peers.has(topic)) {
        const link = await createPeerLink({
          conversationId: topic, selfId: login.userId(), peerId: (g.chat && g.chat.peerId) || null,
          api: controlApi, iceServers: await ice(), iceTransportPolicy: cfg.iceTransportPolicy,
          onMessage: payload => { if (typeof g.mcV2OnLiveMessage === "function") g.mcV2OnLiveMessage(payload); },
        });
        peers.set(topic, link);
        await link.handshake({ offer: true });
      }
      const link = peers.get(topic);
      if (link && link.isOnline()) {
        const sent = await link.send({ type: "chat", body });
        if (sent) return { ok: true, status: 200, data: { success: true, v2: "webrtc" } };
      }
    } catch (e) {
      try { console.warn("[mc-v2] webrtc fallback:", e && e.message); } catch (_) {}
      peers.delete(topic);
    }
    if (pagesSink) {
      /* وقتی نویسندهٔ Pages آماده است، صف امن جای مسیر فعلی را میگیرد؛
         در غیر این صورت همان send فعلی منبع حقیقت است و نباید رکورد دوباره ساخته شود. */
      try {
        await outbox.enqueue(body);
        return { ok: true, status: 200, data: { success: true, v2: "offline-queued" } };
      } catch (e) {
        try { console.warn("[mc-v2] outbox fallback:", e && e.message); } catch (_) {}
      }
    }
    if (noSupabaseData) return queueOnly(body);
    return controlApi(path, { method: "POST", body });
  }

  function install() {
    if (installed) return g.MemeChatV2;
    installed = true;
    wrapGlobal("api", async function v2api(path, opts) {
      const p = String(path || "");
      const o = opts || {};
      if (cfg.mode === "off") return controlApi(path, o);
      if (p.indexOf("action=history") >= 0) {
        const m = /[?&]topic=([^&]+)/.exec(p);
        const topic = m ? decodeURIComponent(m[1]) : "";
        if (topic) return readHistory(topic, p, o);
      }
      if (cfg.mode === "active" && p.indexOf("action=send") >= 0 && (o.method || "").toUpperCase() === "POST") {
        return routeSend(o.body, p);
      }
      return controlApi(path, o);
    });

    /* جابهجایی حساب → کش همان حساب پاک میشود (قانون تفکیک دادههای محلی) */
    const stopWatch = login.startWatching();
    restoreFns.push(() => { if (typeof stopWatch === "function") stopWatch(); });
    if (typeof g.addEventListener === "function") {
      const onChange = async () => { try { const c = await getCache(); await c.purge(); cache = null; } catch (e) {} };
      g.addEventListener("mc-v2-account-changed", onChange);
      restoreFns.push(() => { if (typeof g.removeEventListener === "function") g.removeEventListener("mc-v2-account-changed", onChange); });
    }

    if (typeof g.setInterval === "function" && cfg.mode === "active" && pagesSink) {
      flushTimer = g.setInterval(async () => {
        const list = await outbox.pending();
        if (!list.length) return;
        try { await flush(); } catch (e) {}
      }, cfg.flushEveryMs);
      restoreFns.push(() => { if (flushTimer) clearInterval(flushTimer); });
    }
    return g.MemeChatV2;
  }

  async function flush() {
    const list = await outbox.pending();
    const batch = list.slice(0, outbox.batchSize);
    if (!batch.length) return { flushed: 0 };
    const byTopic = new Map();
    for (const it of batch) {
      const t = String(it.message && it.message.topic || "main");
      if (!byTopic.has(t)) byTopic.set(t, []);
      byTopic.get(t).push(it);
    }
    let done = 0;
    for (const [topic, items] of byTopic) {
      try {
        const c = await getCache();
        let prior = [];
        let version = 1;
        try { const cur = await c.readCurrent(topic); version = (Number(cur.version) || 0) + 1; } catch (e) {}
        const sink = pagesSink || { append: async () => { throw new Error("WRITER_NOT_READY"); } };
        await sink.append({ conversationId: topic, version, messages: items.map(x => ({ ...x.message, clientId: x.clientId, offline: true })), mode: cfg.mode });
        await outbox.markConfirmed(items.map(x => x.clientId)); // فقط بعد از تأیید مقصد
        done += items.length;
      } catch (e) {
        await outbox.bumpAttempts(items.map(x => x.clientId));
        /* جداسازی: شکست یعنی پیام تو صف میماند، نه اینکه برگردد به Supabase.
           در حالت عادی، همان مسیر فعلی پشتیبان است؛ هیچ دادهٔ قدیمی پاک نمیشود. */
        if (!noSupabaseData) {
          for (const it of items) { try { await legacySink.send(it.message); } catch (_) {} }
        }
      }
    }
    return { flushed: done };
  }

  function restore() {
    for (const fn of restoreFns.splice(0).reverse()) { try { fn(); } catch (e) {} }
    installed = false; cache = null; peers.clear();
    if (g.MemeChatV2) delete g.MemeChatV2;
  }
  function api() {
    return Object.freeze({
      version: 2, mode: cfg.mode, scope, install, restore, flush,
      history: readHistory, profile: profiles.load, keyMode: keyProvider.mode,
      outbox, cache: getCache, login, rtcSupported: rtcSupported(),
      ice, iceServers: async () => redactIceServers(await ice()),
      decouple: noSupabaseData, supabaseRole: describeSupabaseRole(noSupabaseData),
      originals, config: cfg,
    });
  }
  g.MemeChatV2 = api();
  install();
  return g.MemeChatV2;
}

if (typeof globalThis !== "undefined" && globalThis.MC_V2_AUTOBOOT === true) installMemeChatV2();
