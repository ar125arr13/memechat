/* MemeChat v2 — rtc.js
 * پیام زنده، تا جای ممکن مستقیم بین دو دستگاه. محتوا قبل از send رمز میشود.
 * سیستم Login اینجا هیچ نقشی ندارد؛ فقط همان api() احرازشدهٔ موجود برای سیگنالینگ صدا زده میشود.
 * محدودیت صادقانه: WebRTC بدون STUN فقط تو شبکهٔ محلی وصل میشود؛ برای اینترنت باید
 * iceServers تزریق شود و CSP بررسی گردد (ما CSP را تغییر نمیدهیم).
 */
import {
  generateEphemeral, exportPublicJwk, deriveSessionKey, encryptMessage, decryptMessage,
  generateIdentity, importPublicJwk, sha256Hex, utf8, randomId,
} from "./crypto.js";
import { signalingRoom, createSignaling, selfPublicJwk } from "./signaling.js";
import { createBrowserKv, createMemoryKv } from "./kv.js";
import { normalizeIceServers } from "./ice.js";

export function rtcSupported() {
  return typeof RTCPeerConnection !== "undefined" || typeof globalThis.RTCPeerConnection !== "undefined";
}

/** آرایه یا تابع async → آرایهٔ تأییدشدهٔ ICE. برای تست و عیبیابی هم export شد. */
export async function resolvePeerIceServers(iceServers) {
  const raw = typeof iceServers === "function" ? await iceServers() : iceServers;
  return normalizeIceServers(raw, { allowCredentials: true });
}

export async function createPeerLink({
  conversationId, selfId, peerId, api, iceServers = [], iceTransportPolicy = "all",
  RTCPeerConnectionCtor = globalThis.RTCPeerConnection,
  kv = null, onMessage = () => {}, onState = () => {}, now = () => Date.now(),
  handshakeTimeoutMs = 30000,
} = {}) {
  if (!conversationId || !selfId) throw new Error("RTC_IDENTITY_REQUIRED");
  if (!RTCPeerConnectionCtor) throw new Error("RTC_UNAVAILABLE");
  const store = kv || (typeof indexedDB !== "undefined" ? createBrowserKv() : createMemoryKv());
  const room = await signalingRoom(conversationId);
  const sig = createSignaling({ api, room, selfId, now });

  const idKeyName = `id:${selfId}`;
  let identity = await store.get(idKeyName);
  if (!identity) { identity = await generateIdentity(); await store.put(idKeyName, identity); }
  const myIdJwk = await selfPublicJwk(identity);
  const ephemeral = await generateEphemeral();
  const myEphJwk = await exportPublicJwk(ephemeral.publicKey);

  let pc = null, channel = null, sessionKey = null, seq = 0, lastRemoteSeq = 0;
  let peerOnline = false, closed = false, initiator = false, resolvedIce = [];

  const state = s => { try { onState(s); } catch (e) {} };

  function fingerprint(jwk) {
    return sha256Hex(utf8(JSON.stringify({ x: jwk.x, y: jwk.y, crv: jwk.crv })));
  }
  async function trustedPeer(jwk) {
    const name = `peer:${selfId}:${peerId || "unknown"}`;
    const pinned = await store.get(name);
    const fp = await fingerprint(jwk);
    if (pinned && pinned !== fp) throw new Error("RTC_IDENTITY_CHANGED");
    if (!pinned) await store.put(name, fp);
    return fp;
  }

  function makeChannel(label) {
    channel = pc.createDataChannel(label, { ordered: true });
    channel.onopen = () => { state("online"); peerOnline = true; };
    channel.onclose = () => { state("closed"); peerOnline = false; };
    channel.onmessage = async ev => {
      try {
        const env = JSON.parse(String(ev.data));
        const out = await decryptMessage(sessionKey, env, { expectedConversationId: conversationId, expectedSenderId: peerId, minSeq: lastRemoteSeq });
        lastRemoteSeq = out.seq;
        onMessage(out.payload, { seq: out.seq, live: true });
      } catch (e) { state("decrypt-error"); }
    };
  }
  function attachChannel() {
    pc.ondatachannel = ev => {
      channel = ev.channel;
      channel.onopen = () => { state("online"); peerOnline = true; };
      channel.onclose = () => { state("closed"); peerOnline = false; };
      channel.onmessage = async e2 => {
        try {
          const env = JSON.parse(String(e2.data));
          const out = await decryptMessage(sessionKey, env, { expectedConversationId: conversationId, expectedSenderId: peerId, minSeq: lastRemoteSeq });
          lastRemoteSeq = out.seq;
          onMessage(out.payload, { seq: out.seq, live: true });
        } catch (e) { state("decrypt-error"); }
      };
    };
  }

  function newPc() {
    pc = new RTCPeerConnectionCtor({ iceServers: resolvedIce, iceTransportPolicy });
    pc.onicecandidate = e => {
      if (e && e.candidate) sig.post("ice", { candidate: e.candidate.toJSON ? e.candidate.toJSON() : e.candidate }).catch(() => {});
    };
    pc.onconnectionstatechange = () => {
      const s = pc && pc.connectionState;
      if (s === "failed" || s === "disconnected" || s === "closed") { peerOnline = false; state(s); }
    };
    return pc;
  }

  async function handshake({ offer = false } = {}) {
    initiator = offer;
    resolvedIce = await resolvePeerIceServers(iceServers);
    newPc();
    if (offer) makeChannel("memechat-v2");
    else attachChannel();
    await sig.post("hello", { eph: myEphJwk }, identity.privateKey, myIdJwk);
    const peerHello = await sig.waitFor("hello", handshakeTimeoutMs);
    const d = peerHello.data;
    if (!(await sig.verifySignal(d, d.id))) throw new Error("RTC_BAD_SIGNATURE");
    await trustedPeer(d.id);
    const a = JSON.stringify(myEphJwk), b = JSON.stringify(d.eph);
    const salt = await sha256Hex(utf8([a, b].sort().join("|")));
    const ctx = `memechat-v2|${conversationId}|${[String(selfId), String(peerId || "")].sort().join("|")}`;
    sessionKey = await deriveSessionKey(ephemeral.privateKey, d.eph, salt, ctx);

    if (offer) {
      const sdp = await pc.createOffer();
      await pc.setLocalDescription(sdp);
      await sig.post("offer", { sdp });
      const answer = await sig.waitFor("answer", handshakeTimeoutMs);
      await pc.setRemoteDescription(answer.data.sdp);
    } else {
      const off = await sig.waitFor("offer", handshakeTimeoutMs);
      await pc.setRemoteDescription(off.data.sdp);
      const sdp = await pc.createAnswer();
      await pc.setLocalDescription(sdp);
      await sig.post("answer", { sdp });
    }
    // ICEهای ردوبدلشده تا اینجا + کمی بعد، بعدش پاکسازی
    let guard = 0;
    while (guard++ < 40 && (!channel || channel.readyState !== "open")) {
      const evs = await sig.poll();
      for (const e of evs) {
        if (e.data.candidate && pc.remoteDescription) {
          try { await pc.addIceCandidate(e.data.candidate); } catch (err) {}
        }
      }
      if (guard % 5 === 0 && offer === false && !peerOnline) break;
      await new Promise(r => setTimeout(r, 120));
    }
    await sig.clear(); // اطلاعات موقت اتصال بعد از استفاده پاک شود
    state(peerOnline ? "online" : "degraded");
    return peerOnline;
  }

  async function send(payload) {
    if (closed || !channel || channel.readyState !== "open" || !sessionKey) return false;
    const env = await encryptMessage(sessionKey, payload, { conversationId, senderId: selfId, seq: ++seq });
    try { channel.send(JSON.stringify(env)); return true; } catch (e) { return false; }
  }
  async function close() {
    closed = true; peerOnline = false;
    try { await sig.post("bye", {}); } catch (e) {}
    try { await sig.clear(); } catch (e) {}
    sig.stop();
    try { if (channel) channel.close(); } catch (e) {}
    try { if (pc) pc.close(); } catch (e) {}
    state("closed");
  }
  return {
    handshake, send, close, isOnline: () => peerOnline && !closed,
    fingerprint: () => fingerprint(myIdJwk), get room() { return room; },
    identityJwk: myIdJwk, signaling: sig,
    get iceServers() { return resolvedIce.map(s => ({ ...s, ...(s.credential ? { credential: "***" } : {}) })); },
  };
}
