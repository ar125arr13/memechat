/* MemeChat v2 — zip.js
 * نوشتن/خواندن ZIP استاندارد، بدون هیچ کتابخانهای.
 * از CompressionStream('deflate-raw') استفاده میشه؛ اگه نبود، بدون فشردهسازی (store) مینویسه.
 * هر فایل با CRC32 چک میشه تا تاریخچهٔ خراب هیچوقت تحویل داده نشه.
 */
import { utf8, fromUtf8, toBytes, sha256Hex } from "./crypto.js";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
export function crc32(bytes) {
  const b = toBytes(bytes);
  let c = 0xFFFFFFFF;
  for (let i = 0; i < b.length; i++) c = CRC_TABLE[(c ^ b[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

function w16(v, out, at) { out[at] = v & 255; out[at + 1] = (v >>> 8) & 255; }
function w32(v, out, at) { out[at] = v & 255; out[at + 1] = (v >>> 8) & 255; out[at + 2] = (v >>> 16) & 255; out[at + 3] = (v >>> 24) & 255; }
function r16(b, at) { return b[at] | (b[at + 1] << 8); }
function r32(b, at) { return (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16) | (b[at + 3] << 24)) >>> 0; }
function concat(parts) {
  const n = parts.reduce((a, p) => a + p.length, 0);
  const out = new Uint8Array(n);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
function dosTime(d) {
  return {
    time: ((d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1)) & 0xFFFF,
    date: (((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()) & 0xFFFF,
  };
}

let deflateSupported;
async function deflateRaw(bytes) {
  if (deflateSupported === false) return null;
  if (typeof CompressionStream === "undefined" || typeof Blob === "undefined" || typeof Response === "undefined") { deflateSupported = false; return null; }
  try {
    const cs = new CompressionStream("deflate-raw");
    const stream = new Blob([toBytes(bytes)]).stream().pipeThrough(cs);
    const buf = await new Response(stream).arrayBuffer();
    deflateSupported = true;
    return new Uint8Array(buf);
  } catch (e) {
    deflateSupported = false;
    return null;
  }
}
async function inflateRaw(bytes) {
  if (typeof DecompressionStream === "undefined") throw new Error("DEFLATE_RAW_UNSUPPORTED");
  const ds = new DecompressionStream("deflate-raw");
  const stream = new Blob([toBytes(bytes)]).stream().pipeThrough(ds);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** entries: [{ name: string, data: Uint8Array|string }] */
export async function createZip(entries, now = new Date()) {
  if (!Array.isArray(entries) || entries.length > 65534) throw new Error("ZIP_TOO_MANY_ENTRIES");
  const { time, date } = dosTime(now);
  const locals = [], centrals = [];
  let offset = 0;
  for (const e of entries) {
    const name = utf8(String(e.name || ""));
    if (!name.length) throw new Error("ZIP_EMPTY_NAME");
    const raw = toBytes(typeof e.data === "string" ? e.data : e.data);
    const compressed = await deflateRaw(raw);
    const method = compressed && compressed.length < raw.length ? 8 : 0;
    const body = method === 8 ? compressed : raw;
    const crc = crc32(raw);
    if (raw.length > 0xFFFFFFFF || body.length > 0xFFFFFFFF) throw new Error("ZIP64_REQUIRED");
    const lh = new Uint8Array(30 + name.length);
    w32(0x04034B50, lh, 0); w16(20, lh, 4); w16(0x0800, lh, 6); w16(method, lh, 8);
    w16(time, lh, 10); w16(date, lh, 12); w32(crc, lh, 14); w32(body.length, lh, 18); w32(raw.length, lh, 22);
    w16(name.length, lh, 26); w16(0, lh, 28); lh.set(name, 30);
    locals.push(lh, body);
    const ch = new Uint8Array(46 + name.length);
    w32(0x02014B50, ch, 0); w16(20, ch, 4); w16(20, ch, 6); w16(0x0800, ch, 8); w16(method, ch, 10);
    w16(time, ch, 12); w16(date, ch, 14); w32(crc, ch, 16); w32(body.length, ch, 20); w32(raw.length, ch, 24);
    w16(name.length, ch, 28); w16(0, ch, 30); w16(0, ch, 32); w16(0, ch, 34); w16(0, ch, 36);
    w32(0, ch, 38); w32(offset, ch, 42); ch.set(name, 46);
    centrals.push(ch);
    offset += lh.length + body.length;
  }
  const cd = concat(centrals);
  const eocd = new Uint8Array(22);
  w32(0x06054B50, eocd, 0); w16(0, eocd, 4); w16(0, eocd, 6);
  w16(entries.length, eocd, 8); w16(entries.length, eocd, 10); w32(cd.length, eocd, 12); w32(offset, eocd, 16);
  w16(0, eocd, 20);
  return concat([...locals, cd, eocd]);
}

export async function readZip(bytes) {
  const b = toBytes(bytes);
  if (b.length < 22) throw new Error("ZIP_TOO_SMALL");
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) {
    if (r32(b, i) === 0x06054B50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("ZIP_EOCD_NOT_FOUND");
  const count = r16(b, eocd + 10);
  let at = r32(b, eocd + 16);
  const out = [];
  for (let i = 0; i < count; i++) {
    if (r32(b, at) !== 0x02014B50) throw new Error("ZIP_BAD_CENTRAL_HEADER");
    const method = r16(b, at + 10), crc = r32(b, at + 16);
    const compSize = r32(b, at + 20), rawSize = r32(b, at + 24);
    const nameLen = r16(b, at + 28), extraLen = r16(b, at + 30), commentLen = r16(b, at + 32);
    const localOffset = r32(b, at + 42);
    const name = fromUtf8(b.subarray(at + 46, at + 46 + nameLen));
    if (r32(b, localOffset) !== 0x04034B50) throw new Error("ZIP_BAD_LOCAL_HEADER");
    /* سرآیند محلی و سرآیند مرکزی باید با هم جور باشند؛ دستکاری هیچکدام پذیرفته نشود. */
    if (r16(b, localOffset + 8) !== method) throw new Error("ZIP_LOCAL_METHOD_MISMATCH:" + name);
    if (r32(b, localOffset + 14) !== crc) throw new Error("ZIP_LOCAL_CRC_MISMATCH:" + name);
    if (r32(b, localOffset + 18) !== compSize || r32(b, localOffset + 22) !== rawSize) throw new Error("ZIP_LOCAL_SIZE_MISMATCH:" + name);
    const lNameLen = r16(b, localOffset + 26), lExtraLen = r16(b, localOffset + 28);
    if (fromUtf8(b.subarray(localOffset + 30, localOffset + 30 + lNameLen)) !== name) throw new Error("ZIP_LOCAL_NAME_MISMATCH");
    const dataAt = localOffset + 30 + lNameLen + lExtraLen;
    const body = b.subarray(dataAt, dataAt + compSize);
    const raw = method === 8 ? await inflateRaw(body) : body;
    if (method !== 8 && method !== 0) throw new Error("ZIP_UNSUPPORTED_METHOD");
    if (raw.length !== rawSize) throw new Error("ZIP_SIZE_MISMATCH");
    if (crc32(raw) !== crc) throw new Error("ZIP_CRC_MISMATCH:" + name);
    out.push({ name, data: raw });
    at += 46 + nameLen + extraLen + commentLen;
  }
  return out;
}

export async function zipJson(name, obj) { return createZip([{ name, data: JSON.stringify(obj) }]); }
export async function readZipJson(bytes, name) {
  const e = (await readZip(bytes)).find(x => x.name === name);
  if (!e) throw new Error("ZIP_ENTRY_NOT_FOUND:" + name);
  return JSON.parse(fromUtf8(e.data));
}
export { sha256Hex };
