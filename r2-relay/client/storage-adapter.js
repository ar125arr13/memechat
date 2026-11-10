// Pluggable storage drivers + «دیتابیس دوم» روی روبیکا.
// قانون تازه: روبیکا مسیر کوریر دستی است؛ هیچ بچهای بعد از تأیید پاک نمیشود.
// «اول تأیید، بعد حذف» قدیمی فقط برای درایورهای آزمایشی Memory/R2 باقی ماند؛
// مسیر روبیکا عمداً مرحلهٔ حذف را ندارد (درخواست صاحب پروژه: هیچ دادهای پاک نشود).

import {
  utf8, fromUtf8, sha256Hex, randomBytes, hex, b64url, unb64url,
  encryptChunk, decryptChunk, chunkBytes, concatBytes,
} from '../worker/src/crypto.js';
import { makePackets, joinPackets, RUBIKA_MANUAL_COURIER } from './courier.js';

export class StorageDriver {
  constructor(name) { this.name = name; }
  async put(_key, _bytes) { throw new Error(`${this.name}: put() not implemented`); }
  async get(_key) { throw new Error(`${this.name}: get() not implemented`); }
  async delete(_key) { throw new Error(`${this.name}: delete() not implemented`); }
}

export class MemoryDriver extends StorageDriver {
  constructor() { super('memory'); this.store = new Map(); }
  async put(k, b) { this.store.set(k, new Uint8Array(b)); }
  async get(k) { const v = this.store.get(k); if (!v) throw new Error(`missing ${k}`); return new Uint8Array(v); }
  async delete(k) { this.store.delete(k); }
  async has(k) { return this.store.has(k); }
}

// R2 فقط از پشت Worker، هرگز مستقیم از مرورگر (توکن سمتسرور میماند).
export class R2Driver extends StorageDriver {
  constructor({ baseUrl, token }) {
    super('r2-worker');
    if (!baseUrl) throw new Error('baseUrl required');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.token = token;
  }
  _headers(extra = {}) {
    return { ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}), ...extra };
  }
  async put(k, b) {
    const r = await fetch(`${this.baseUrl}/v1/blob`, {
      method: 'POST',
      headers: this._headers({ 'Content-Type': 'application/octet-stream', 'X-MC-KEY': k }),
      body: b,
    });
    if (!r.ok) throw new Error(`put failed ${r.status}`);
    return r.json();
  }
  async get(k) {
    const r = await fetch(`${this.baseUrl}/v1/object/${encodeURIComponent(k)}`, { headers: this._headers() });
    if (!r.ok) throw new Error(`get failed ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  async delete(k) {
    const r = await fetch(`${this.baseUrl}/v1/object/${encodeURIComponent(k)}`, {
      method: 'DELETE', headers: this._headers(),
    });
    if (!r.ok) throw new Error(`delete failed ${r.status}`);
  }
}

// «سایت استوریج با API» — نیاز به CORS؛ بدون آن حتماً Worker proxy، نه توکن تو مرورگر.
export class HttpStorageDriver extends StorageDriver {
  constructor({ name, putUrl, getUrl, headers = {}, cors = false }) {
    super(name); this.putUrl = putUrl; this.getUrl = getUrl; this.headers = headers; this.cors = cors;
  }
  async put(k, b) {
    if (!this.cors) throw new Error(`${this.name}: no CORS -> use a Worker proxy, never a browser token`);
    const r = await fetch(this.putUrl(k), { method: 'PUT', headers: this.headers, body: b });
    if (!r.ok) throw new Error(`put failed ${r.status}`);
    return { key: k };
  }
  async get(k) {
    const r = await fetch(this.getUrl(k), { headers: this.headers });
    if (!r.ok) throw new Error(`get failed ${r.status}`);
    return new Uint8Array(await r.arrayBuffer());
  }
  async delete(k) { throw new Error(`${this.name}: delete requires provider-specific endpoint`); }
}

// درایور فعال دیتابیس دوم: بستههای متنی MCPK1 → انسان → روبیکا.
// بدون API رسمی، بدون توکن، بدون ورسل، بدون حذف.
export class RubikaCourierDriver extends StorageDriver {
  constructor({ onExport, chunkSize = 900 } = {}) {
    super(RUBIKA_MANUAL_COURIER.destination);
    this.store = new Map();
    this.confirmed = new Map();
    this.onExport = onExport;
    this.chunkSize = chunkSize;
  }
  async put(k, b) {
    const packets = await makePackets(new Uint8Array(b), { id: k, chunkSize: this.chunkSize });
    this.store.set(k, new Uint8Array(b));
    if (this.onExport) this.onExport(k, packets);
    return { key: k, packets: packets.length };
  }
  async import(k, packets) {
    const { bytes } = await joinPackets(packets);
    this.store.set(k, bytes);
    return bytes;
  }
  async get(k) { const v = this.store.get(k); if (!v) throw new Error(`missing ${k}`); return new Uint8Array(v); }
  async delete(_k) {
    throw new Error('RUBIKA_NO_DELETE: هیچ ردیف/بچهای تو مسیر روبیکا پاک نمیشود');
  }
  async has(k) { return this.store.has(k); }
  async confirm(manifest, packets) {
    const { bytes, meta } = await joinPackets(packets);
    if ((await sha256Hex(bytes)) !== manifest.envelopeSha256) {
      throw Object.assign(new Error('RUBIKA_HASH_MISMATCH'), { retainedInPrimary: true, deleted: false });
    }
    const entry = {
      ok: true, batchId: manifest.batchId, verifiedSha: meta.sha,
      packetCount: packets.length, deleted: false, retainedInPrimary: true,
      officialApiUsed: false, vercelUsed: false,
    };
    this.confirmed.set(manifest.batchId, entry);
    return entry;
  }
}

// نام قدیمی برای سازگاری با تستها/کد قبلی؛ همان درایور روبیکاست.
export const ManualCourierDriver = RubikaCourierDriver;

export async function publishEncrypted({ driver, plain, key, chunkSize = 256 * 1024, batchId, aad = '' }) {
  const id = batchId || hex(randomBytes(12));
  const wholeSha = await sha256Hex(plain);
  const chunks = [];
  for (const [i, part] of chunkBytes(plain, chunkSize).entries()) {
    const packet = await encryptChunk(key, part, aad);
    const stageKey = `stage/${id}/${i}`;
    await driver.put(stageKey, unb64url(packet.ct));
    chunks.push({ i, stageKey, sha: packet.sha, iv: packet.iv, size: packet.size });
  }
  return {
    v: 1, id, provider: driver.name, status: 'pending',
    sha: wholeSha, size: plain.length, chunkSize, aad,
    chunks, createdAt: new Date().toISOString(),
  };
}

// مسیر قدیمی «تأیید → ارتقا → حذف staging». فقط برای درایورهای آزمایشی؛
// برای روبیکا از verifyRubikaDelivery استفاده کنید که حذف ندارد.
export async function verifyAndCommit({ driver, manifest }) {
  const staged = [];
  for (const c of manifest.chunks) {
    const data = await driver.get(c.stageKey);
    if ((await sha256Hex(data)) !== c.sha) {
      throw Object.assign(new Error(`verify failed for ${c.stageKey}`), { retainedInStaging: true });
    }
    staged.push({ c, data });
  }
  for (const { c, data } of staged) await driver.put(`blob/${c.sha}`, data);
  const deleted = [];
  for (const c of manifest.chunks) { await driver.delete(c.stageKey); deleted.push(c.stageKey); }
  return {
    ...manifest,
    status: 'confirmed',
    commit: await sha256Hex(utf8(JSON.stringify({ id: manifest.id, sha: manifest.sha, chunks: manifest.chunks }))),
    confirmedAt: new Date().toISOString(),
    deleted,
  };
}

/* ---------------- مسیر فعال دیتابیس دوم ---------------- */

export async function publishForRubika({ driver, plain, key, chunkSize = 256 * 1024, batchId, aad = '' }) {
  const manifest = await publishEncrypted({ driver, plain, key, chunkSize, batchId, aad });
  return {
    ...manifest,
    destination: RUBIKA_MANUAL_COURIER.destination,
    officialApiUsed: false,
    vercelUsed: false,
    frontendSecrets: false,
    primaryRowsUntouched: true,
    noDelete: true,
    deleted: false,
    destructiveOperations: [],
  };
}

// تأیید همهٔ بستهها → نگهداری هم staging و هم نسخهٔ canonical؛ صفر حذف.
export async function verifyRubikaDelivery({ driver, manifest }) {
  const staged = [];
  for (const c of manifest.chunks) {
    const data = await driver.get(c.stageKey);
    if ((await sha256Hex(data)) !== c.sha) {
      throw Object.assign(new Error(`verify failed for ${c.stageKey}`), {
        retainedInPrimary: true, deleted: false, destructiveOperations: [],
      });
    }
    staged.push({ c, data });
  }
  for (const { c, data } of staged) await driver.put(`rubika/${c.sha}`, data);
  return {
    ...manifest,
    status: 'confirmed',
    destination: RUBIKA_MANUAL_COURIER.destination,
    officialApiUsed: false,
    vercelUsed: false,
    frontendSecrets: false,
    primaryRowsUntouched: true,
    deleted: false,
    deletedKeys: [],
    destructiveOperations: [],
    commit: await sha256Hex(utf8(JSON.stringify({ id: manifest.id, sha: manifest.sha, chunks: manifest.chunks }))),
    confirmedAt: new Date().toISOString(),
  };
}

export async function readEncrypted({ driver, manifest, key, prefix = 'blob' }) {
  if (manifest.status !== 'confirmed') throw new Error('manifest is not confirmed');
  const parts = [];
  for (const c of manifest.chunks) {
    const data = await driver.get(`${prefix}/${c.sha}`);
    parts.push(await decryptChunk(key, { ct: b64url(data), iv: c.iv, sha: c.sha }, manifest.aad || ''));
  }
  const plain = concatBytes(parts);
  if ((await sha256Hex(plain)) !== manifest.sha) throw new Error('payload hash mismatch');
  return plain;
}
