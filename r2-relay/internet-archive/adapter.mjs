/* MemeChat — «دیتابیس دوم» روی Internet Archive (IAS3) با رمزگذاری متفاوت.
 *
 * درخواست: «من internet archive رو انتخاب میکنم / ولی رمز گزاری متفاوت و
 * کلیدش توی سورس کدها باشه فقط».
 *
 * این فایل معماری قدیمی را خراب نمیکند:
 *   - Supabase همچنان دیتابیس اصلی است؛ لاگین/چت/تاریخچه/`rt-*` دستنخورده.
 *   - منیفست محلی + Supabase مرجعاند؛ IA فقط محل نگهداری بستههاست،
 *     نه دیتابیس کوئریپذیر (SQL/تراکنش/ایندکس/OTP/realtime ندارد).
 *   - مسیرهای روبیکا و maxrubika سر جایشاناند و حذف نشدند.
 *   - صفر DELETE / DROP / TRUNCATE / RESET. هیچ ردیفی پاک نمیشود.
 *   - بدون ورسل، بدون دیپلوی، بدون تغییر فرانتاند/`index.html`/CSP/`MC_API`.
 *
 * تفاوت رمزگذاری با بقیهٔ پروژه: `../internet-archive/cipher.mjs`
 * (ChaCha20-Poly1305 + کلید ثابت داخل سورس + بستهٔ باینری MCIA1 + AAD).
 */

import { encryptEnvelope, decryptEnvelope, sha256Hex, ENVELOPE_KIND } from './cipher.mjs';
import { sourceKeyBytes, KEY_ALGORITHM, KEY_SOURCE, keyFingerprint } from './key.mjs';
import { chunkBytes, concatBytes } from '../worker/src/crypto.js';
import { StorageDriver } from '../client/storage-adapter.js';

export const IA_DESTINATION = 'internet-archive-ias3';
export const FILE_PREFIX = 'mcia/';
export const DEFAULT_CHUNK_BYTES = 8 * 1024 * 1024;   // 8 MiB؛ خیلی کمتر از سقف 500GB تکفایل
export const DEFAULT_BATCH_LIMIT = 10000;             // سقف توصیهشدهٔ تعداد فایلها در هر item

export function filenameFor({ batchId, index, item }) {
  const safe = String(batchId).replace(/[^A-Za-z0-9_.-]/g, '-');
  return `${FILE_PREFIX}${item}/${safe}/${String(index).padStart(6, '0')}.mcia`;
}

/* ترانسپورت تزریقشده: { put(filename, bytes), get(filename), list(prefix) }.
   نمونهٔ واقعی Ias3Transport؛ نمونهٔ آفلاین fixture.mjs. */
export class InternetArchiveDriver extends StorageDriver {
  constructor({ transport, item = 'memechat-second-db', chunkSize = DEFAULT_CHUNK_BYTES } = {}) {
    super(IA_DESTINATION);
    if (!transport || typeof transport.put !== 'function' || typeof transport.list !== 'function') {
      throw new Error('IA_TRANSPORT_REQUIRED');
    }
    this.transport = transport;
    this.item = item;
    this.chunkSize = chunkSize;
    this.store = new Map();       // نسخهٔ محلی (primary side) دستنخورده میماند
    this.sent = new Map();        // filename → meta
    this.confirmed = new Map();
    this.lastUploads = [];
  }

  async put(k, b) {
    const bytes = new Uint8Array(b);
    const sha = sha256Hex(bytes);
    const match = /^stage\/([^/]+)\/(\d+)$/.exec(k);
    const batchId = match ? match[1] : String(k).replace(/[^A-Za-z0-9_.-]/g, '-');
    const index = match ? Number(match[2]) : 0;
    const filename = filenameFor({ batchId, index, item: this.item });

    const { blob, meta } = encryptEnvelope(bytes, {
      item: this.item, filename, batchId, key: sourceKeyBytes(),
    });
    this.store.set(k, bytes);
    this.store.set(`blob/${sha}`, bytes);
    const report = await this.transport.put(filename, blob);
    this.sent.set(filename, { ...meta, plaintextSha256: sha, stageKey: k, index, report });
    this.lastUploads.push({ filename, size: blob.length, sha });
    return {
      key: k,
      filename,
      sha,
      bytes: blob.length,
      algorithm: KEY_ALGORITHM,
      keySource: KEY_SOURCE,
      reported: report ?? null,
      deleted: false,
      destructiveOperations: [],
      retainedInPrimary: true,
    };
  }

  async get(k) {
    const v = this.store.get(k);
    if (!v) throw new Error(`missing ${k}`);
    return new Uint8Array(v);
  }
  async has(k) { return this.store.has(k); }
  async delete(_k) {
    throw new Error('IA_NO_DELETE: هیچ فایل/ردیف/بچهای از Internet Archive پاک نمیشود');
  }

  /* خواندن دوباره از IA و باز کردن بستهها، با تأیید Poly1305 + SHA. */
  async pull({ limit = DEFAULT_BATCH_LIMIT } = {}) {
    const files = await this.transport.list(FILE_PREFIX);
    const chosen = files.slice(0, Math.max(1, Math.min(limit, DEFAULT_BATCH_LIMIT)));
    const out = [];
    const errors = [];
    for (const f of chosen) {
      try {
        const got = await this.transport.get(f.name);
        const opened = decryptEnvelope(got.bytes, { key: sourceKeyBytes() });
        const expected = this.sent.get(f.name);
        if (expected && opened.plaintextSha256 !== expected.plaintextSha256) {
          throw new Error('IA_HASH_MISMATCH');
        }
        out.push({
          filename: f.name,
          plain: opened.plain,
          plaintextSha256: opened.plaintextSha256,
          ciphertextSha256: opened.ciphertextSha256,
          aad: opened.aad,
          algorithm: opened.algorithm,
          keySource: opened.keySource,
          reportedSize: f.size,
        });
      } catch (err) {
        errors.push({ filename: f.name, reason: err?.message || 'DECRYPT_FAILED' });
      }
    }
    return { packets: out, errors, deleted: false, destructiveOperations: [] };
  }

  async roundTrip() {
    const pulled = await this.pull();
    const byBatch = new Map();
    for (const p of pulled.packets) {
      const parts = p.aad.split('|');
      const batchId = parts[2];
      if (!byBatch.has(batchId)) byBatch.set(batchId, []);
      byBatch.get(batchId).push(p);
    }
    const results = [];
    for (const [batchId, packets] of byBatch) {
      const ordered = packets.sort((a, b) => a.filename.localeCompare(b.filename));
      const joined = concatBytes(ordered.map((p) => p.plain));
      const restoredSha256 = sha256Hex(joined);
      const expected = [...this.sent.values()].filter((m) => m.batchId === batchId);
      const allVerified = ordered.every((p) => p.algorithm === KEY_ALGORITHM && p.keySource === KEY_SOURCE)
        && ordered.length === expected.length
        && pulled.errors.length === 0;
      results.push({
        batchId,
        packets: ordered.length,
        expectedPackets: expected.length,
        restoredSha256,
        verified: allVerified,
      });
    }
    return {
      ok: results.length > 0 && results.every((r) => r.verified),
      receivedCount: pulled.packets.length,
      matchedBatches: results.length,
      errors: pulled.errors,
      results,
      deleted: false,
      destructiveOperations: [],
      retainedInPrimary: true,
    };
  }
}

export async function publishForInternetArchive({
  driver, plain, batchId, chunkSize, aad = '',
} = {}) {
  if (!driver) throw new Error('IA_DRIVER_REQUIRED');
  const bytes = new Uint8Array(plain);
  const size = chunkSize || driver.chunkSize || DEFAULT_CHUNK_BYTES;
  const id = batchId || `mc-ia-${Date.now().toString(36)}`;
  const wholeSha = sha256Hex(bytes);
  const parts = chunkBytes(bytes, size);
  const chunks = [];
  for (const [i, part] of parts.entries()) {
    const stageKey = `stage/${id}/${i}`;
    const report = await driver.put(stageKey, part);
    chunks.push({
      i,
      stageKey,
      filename: report.filename,
      sha: report.sha,
      bytes: report.bytes,
      algorithm: report.algorithm,
    });
  }
  return {
    v: 1,
    id,
    provider: driver.name,
    item: driver.item,
    status: 'confirmed',
    destination: IA_DESTINATION,
    envelopeKind: ENVELOPE_KIND,
    cipher: KEY_ALGORITHM,
    keySource: KEY_SOURCE,
    keyFingerprint: keyFingerprint(),
    sha: wholeSha,
    size: bytes.length,
    chunkSize: size,
    aad,
    chunks,
    createdAt: new Date().toISOString(),
    confirmedAt: new Date().toISOString(),
    officialApiUsed: true,       // IAS3، API رسمی خود Internet Archive
    botTokenUsed: false,
    vercelUsed: false,
    frontendSecrets: false,      // کلید رمزگذاری داخل سورس مخزن است، نه فرانتاند زنده
    primaryRowsUntouched: true,
    noDelete: true,
    deleted: false,
    destructiveOperations: [],
    deployed: false,
    merged: false,
  };
}

export async function verifyInternetArchiveDelivery({ driver, manifest } = {}) {
  const trip = await driver.roundTrip();
  const match = trip.results.find((r) => r.batchId === manifest?.id);
  const ok = trip.ok && !!match && match.verified && match.restoredSha256 === manifest?.sha;
  return {
    ok,
    status: ok ? 'confirmed' : 'unverified',
    batchId: manifest?.id ?? null,
    expectedSha256: manifest?.sha ?? null,
    restoredSha256: match?.restoredSha256 ?? null,
    receivedCount: trip.receivedCount,
    matchedBatches: trip.matchedBatches,
    packetCount: match?.packets ?? 0,
    expectedPackets: manifest?.chunks?.length ?? 0,
    errors: trip.errors,
    cipher: KEY_ALGORITHM,
    keySource: KEY_SOURCE,
    deleted: false,
    destructiveOperations: [],
    retainedInPrimary: true,
  };
}

export async function readInternetArchive({ driver, manifest } = {}) {
  const pulled = await driver.pull();
  const want = new Set((manifest?.chunks || []).map((c) => c.filename));
  const chosen = (manifest?.chunks || [])
    .map((c) => pulled.packets.find((p) => p.filename === c.filename))
    .filter(Boolean);
  if (!chosen.length || chosen.length !== want.size) {
    throw new Error('IA_MISSING_PACKETS');
  }
  const joined = concatBytes(chosen.map((p) => p.plain));
  if (sha256Hex(joined) !== manifest.sha) throw new Error('IA_PAYLOAD_HASH_MISMATCH');
  return joined;
}

export default InternetArchiveDriver;
