/* MemeChat v2 — crypto.js
 * فقط Web Crypto API. هیچ کلیدی تو کد، تو GitHub یا تو Pages نیست.
 * - پیام زنده: ECDH موقت بین دو دستگاه + HKDF + AES-256-GCM (سرتاسری).
 * - آرشیو: کلید مخصوص هر حساب، از طریق همان توکن ورود فعلی تحویل دستگاه میشه.
 * - امضا: ECDSA P-256 برای اینکه کلید موقت وسط راه عوض نشه.
 */
const enc = new TextEncoder();
const dec = new TextDecoder();

function subtle() {
  const c = globalThis.crypto;
  if (!c || !c.subtle) throw new Error("WEB_CRYPTO_UNAVAILABLE");
  return c.subtle;
}
export function utf8(s) { return enc.encode(String(s)); }
export function fromUtf8(b) { return dec.decode(b); }

export function toBytes(x) {
  if (x instanceof Uint8Array) return x;
  if (x instanceof ArrayBuffer) return new Uint8Array(x);
  if (typeof x === "string") return utf8(x);
  throw new TypeError("toBytes: unsupported input");
}

export function b64e(x) {
  const b = toBytes(x);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
  if (typeof btoa === "function") return btoa(s);
  return Buffer.from(s, "binary").toString("base64");
}
export function b64d(s) {
  let bin;
  if (typeof atob === "function") bin = atob(String(s));
  else bin = Buffer.from(String(s), "base64").toString("binary");
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i) & 255;
  return out;
}
export function hex(bytes) { return [...toBytes(bytes)].map(v => v.toString(16).padStart(2, "0")).join(""); }

export function randomBytes(n) {
  if (!Number.isInteger(n) || n < 0) throw new RangeError("randomBytes: bad length");
  const out = new Uint8Array(n);
  const c = globalThis.crypto;
  if (!c || !c.getRandomValues) throw new Error("WEB_CRYPTO_UNAVAILABLE");
  for (let i = 0; i < n; i += 65536) c.getRandomValues(out.subarray(i, Math.min(n, i + 65536)));
  return out;
}
export function randomId(prefix = "") { return prefix + hex(randomBytes(16)); }

export async function sha256(x) { return new Uint8Array(await subtle().digest("SHA-256", toBytes(x))); }
export async function sha256Hex(x) { return hex(await sha256(x)); }

export function constantTimeEqual(a, b) {
  const x = toBytes(a), y = toBytes(b);
  if (x.length !== y.length) return false;
  let d = 0;
  for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

/* ---------- کلید هویت (امضا) — فقط کلید عمومی قابل خروجه ---------- */
export async function generateIdentity() {
  return subtle().generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"]);
}
export async function exportPublicJwk(publicKey) { return subtle().exportKey("jwk", publicKey); }
export async function importPublicJwk(jwk, usages = []) {
  const alg = jwk.alg || "ES256";
  const namedCurve = jwk.crv || "P-256";
  if (alg.startsWith("ES")) return subtle().importKey("jwk", jwk, { name: "ECDSA", namedCurve }, false, usages.length ? usages : ["verify"]);
  return subtle().importKey("jwk", jwk, { name: "ECDH", namedCurve }, false, usages.length ? usages : []);
}
export async function signBytes(privateKey, data) {
  const sig = await subtle().sign({ name: "ECDSA", hash: "SHA-256" }, privateKey, toBytes(data));
  return b64e(new Uint8Array(sig));
}
export async function verifyBytes(publicJwk, signatureB64, data) {
  const key = await importPublicJwk(publicJwk, ["verify"]);
  return subtle().verify({ name: "ECDSA", hash: "SHA-256" }, key, toBytes(b64d(signatureB64)), toBytes(data));
}

/* ---------- کلید موقت برای هر گفتگو ---------- */
export async function generateEphemeral() {
  return subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, false, ["deriveBits"]);
}
export async function deriveSessionKey(myEphemeralPrivate, peerEphemeralPublicJwk, salt, context) {
  const peer = await subtle().importKey("jwk", peerEphemeralPublicJwk, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const bits = await subtle().deriveBits({ name: "ECDH", public: peer }, myEphemeralPrivate, 256);
  const ikm = await subtle().importKey("raw", bits, "HKDF", false, ["deriveKey"]);
  return subtle().deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: toBytes(salt), info: toBytes(context) },
    ikm,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

/* ---------- پیام زنده ---------- */
function aadFor(conversationId, senderId, seq) {
  return utf8(`memechat-v2|${conversationId}|${senderId}|${seq}`);
}
export async function encryptMessage(key, payload, { conversationId, senderId, seq }) {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: aadFor(conversationId, senderId, seq), tagLength: 128 }, key, utf8(JSON.stringify(payload)));
  return { v: 2, alg: "AES-256-GCM", iv: b64e(iv), ct: b64e(new Uint8Array(ct)), seq, senderId, conversationId };
}
export async function decryptMessage(key, envelope, { expectedConversationId, expectedSenderId, minSeq = 0 } = {}) {
  if (!envelope || envelope.v !== 2 || envelope.alg !== "AES-256-GCM") throw new Error("BAD_ENVELOPE");
  if (expectedConversationId && envelope.conversationId !== expectedConversationId) throw new Error("CONVERSATION_MISMATCH");
  if (expectedSenderId && envelope.senderId !== expectedSenderId) throw new Error("SENDER_MISMATCH");
  if (!Number.isSafeInteger(envelope.seq) || envelope.seq <= minSeq) throw new Error("REPLAY_OR_BAD_SEQ");
  const plain = await subtle().decrypt(
    { name: "AES-GCM", iv: toBytes(b64d(envelope.iv)), additionalData: aadFor(envelope.conversationId, envelope.senderId, envelope.seq), tagLength: 128 },
    key, toBytes(b64d(envelope.ct))
  );
  return { payload: JSON.parse(fromUtf8(plain)), seq: envelope.seq };
}

/* ---------- فایل آرشیو (همون الگوریتم، کلید جدا) ---------- */
export async function generateRawKeyB64() { return b64e(randomBytes(32)); }
export async function importRawKeyB64(b64) {
  const raw = toBytes(b64d(b64));
  if (raw.length !== 32) throw new Error("ARCHIVE_KEY_MUST_BE_32_BYTES");
  return subtle().importKey("raw", raw, { name: "AES-GCM" }, false, ["encrypt", "decrypt"]);
}
export async function encryptBlob(key, bytes, aadString = "memechat-archive-v2") {
  const iv = randomBytes(12);
  const ct = await subtle().encrypt({ name: "AES-GCM", iv, additionalData: utf8(aadString), tagLength: 128 }, key, toBytes(bytes));
  return { v: 2, alg: "AES-256-GCM", iv: b64e(iv), ct: b64e(new Uint8Array(ct)), aad: aadString };
}
export async function decryptBlob(key, envelope) {
  if (!envelope || envelope.v !== 2 || envelope.alg !== "AES-256-GCM") throw new Error("BAD_ENVELOPE");
  const plain = await subtle().decrypt(
    { name: "AES-GCM", iv: toBytes(b64d(envelope.iv)), additionalData: utf8(envelope.aad || "memechat-archive-v2"), tagLength: 128 },
    key, toBytes(b64d(envelope.ct))
  );
  return new Uint8Array(plain);
}
