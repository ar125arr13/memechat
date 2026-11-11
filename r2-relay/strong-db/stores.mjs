/* MemeChat — سه «محل نگهداری» مستقل برای یک blob واحد.
 *
 * هیچ سرویس تازهای ساخته نشد؛ همان دو حاملی که از قبل تست شدهاند دوباره
 * استفاده میشوند + یک نسخهٔ محلی:
 *   1. `ia`          ← همان ترانسپورت IAS3 (اینجا FixtureIas3 آفلاین)
 *   2. `saved`       ← همان پیامهای ذخیرهشدهٔ روبیکا (MCR1/MCPK1 آفلاین)
 *   3. `local`       ← نسخهٔ محلی سمت primary، همیشه نگه داشته میشود
 *
 * رابط یکسان: put(filename, bytes) / get(filename) → {ok, bytes} / list().
 * هیچ deleteـای وجود ندارد. خرابکردن عمدی یک نسخه فقط برای تست است و چیزی
 * پاک نمیکند؛ نسخهٔ سالم از حامل دیگر خوانده میشود.
 */

import { webcrypto } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

import { makePackets, joinPackets } from '../client/courier.js';
import {
  encodePacketForSavedMessages, decodePacketFromSavedMessages,
} from '../maxrubika/adapter.mjs';
import { FixtureIas3 } from '../internet-archive/fixture.mjs';

export class MemoryBlobStore {
  constructor({ name = 'local' } = {}) {
    this.name = name;
    this.files = new Map();
    this.writes = 0;
  }
  async put(filename, bytes) {
    this.files.set(filename, Buffer.from(bytes));
    this.writes++;
    return { ok: true, filename, bytes: this.files.get(filename).length };
  }
  async get(filename) {
    const b = this.files.get(filename);
    if (!b) return { ok: false, bytes: Buffer.alloc(0) };
    return { ok: true, bytes: Buffer.from(b) };
  }
  async list() { return [...this.files.keys()].map((name) => ({ name, size: String(this.files.get(name).length) })); }
  describe() { return { name: this.name, mode: 'memory', files: this.files.size, deleteCalled: false }; }
}

/* همان قالب متنی `MCR1.MCPK1...` که مسیر MAXRubika میفرستد. */
export class SavedMessagesStore {
  constructor({ name = 'saved-messages', chunkSize = 700 } = {}) {
    this.name = name;
    this.chunkSize = chunkSize;
    this.messages = new Map();   // filename → []text
    this.sentTexts = [];
  }
  async put(filename, bytes) {
    const packets = await makePackets(new Uint8Array(bytes), { id: filename, chunkSize: this.chunkSize });
    const texts = packets.map(encodePacketForSavedMessages);
    this.messages.set(filename, texts);
    this.sentTexts.push(...texts);
    return { ok: true, filename, packets: texts.length };
  }
  async get(filename) {
    const texts = this.messages.get(filename);
    if (!texts) return { ok: false, bytes: Buffer.alloc(0) };
    const packets = texts.map(decodePacketFromSavedMessages);
    const { bytes } = await joinPackets(packets);
    return { ok: true, bytes: Buffer.from(bytes) };
  }
  async list() {
    return [...this.messages.keys()].map((name) => ({ name, packets: this.messages.get(name).length }));
  }
  describe() {
    return { name: this.name, mode: 'fixture-saved-messages', files: this.messages.size,
      texts: this.sentTexts.length, deleteCalled: false };
  }
}

export async function normalizedGet(store, filename) {
  const r = await store.get(filename);
  if (!r?.ok) return null;
  return Buffer.from(r.bytes);
}

/* مجموعهٔ سه نسخه، با ماندگاری روی دیسک (همه داخل strong-db/out/، gitignored).
 * این فقط یک فایل JSON محلی است، نه سرویس/بکاند/دیتابیس جدید. */
export class ReplicaSet {
  constructor({ filePath, item = 'memechat-strong-db' } = {}) {
    if (!filePath) throw new Error('REPLICA_FILE_REQUIRED');
    this.filePath = filePath;
    this.ia = new FixtureIas3({ item });
    this.ia.name = 'internet-archive';
    /* describe() اصلی IAS3 شمارش فایل ندارد؛ فقط همان اطلاعات + تعداد اضافه
     * میشود. خود کلاس IAS3 دستنخورده میماند. */
    const iaDescribe = this.ia.describe.bind(this.ia);
    this.ia.describe = () => ({ ...iaDescribe(), files: this.ia.files.size });
    this.saved = new SavedMessagesStore({ name: 'saved-messages' });
    this.local = new MemoryBlobStore({ name: 'local' });
  }

  async init() {
    let data = {};
    try { data = JSON.parse(await fs.readFile(this.filePath, 'utf8')); }
    catch (e) { if (e?.code !== 'ENOENT') throw e; }
    for (const [f, b64] of Object.entries(data.ia || {})) this.ia.files.set(f, Buffer.from(b64, 'base64'));
    for (const [f, texts] of Object.entries(data.saved || {})) {
      this.saved.messages.set(f, texts);
      this.saved.sentTexts.push(...texts);
    }
    for (const [f, b64] of Object.entries(data.local || {})) this.local.files.set(f, Buffer.from(b64, 'base64'));
    return this;
  }

  async save() {
    const dump = (m) => Object.fromEntries(
      [...m.entries()].map(([k, v]) => [k, Buffer.from(v).toString('base64')]),
    );
    const data = {
      ia: dump(this.ia.files),
      saved: Object.fromEntries(this.saved.messages),
      local: dump(this.local.files),
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(data), 'utf8');
  }

  stores() { return [this.ia, this.saved, this.local]; }

  /* فقط برای تست/نمایش: بایتهای یک نسخهٔ fixture را عوض میکند.
   * کاتالوگ، رکوردها و Supabase دستنخورده میمانند؛ چیزی حذف نمیشود. */
  corrupt(name, filename, bytes) {
    if (name === 'internet-archive') this.ia.files.set(filename, Buffer.from(bytes));
    else if (name === 'local') this.local.files.set(filename, Buffer.from(bytes));
    else if (name === 'saved-messages') this.saved.messages.set(filename, ['MCR1.MCPK1.broken.body']);
    else throw new Error('UNKNOWN_REPLICA');
    return this;
  }

  describe() {
    return this.stores().map((s) => ({ name: s.name, ...(s.describe?.() || {}) }));
  }
}

export default MemoryBlobStore;
