/* MemeChat — «دیتابیس دومِ محکم» (Strong DB).
 *
 * درخواست: «فقط یه کاری بکن که دیتابیس قوی داشته باشیم».
 *
 * کاری که اینجا **واقعاً** انجام شد (بدون سرویس/حساب/کلید تازه):
 *   لایهای روی همان حاملهای ازپیشتستشده (IA + سیو مسیج + نسخهٔ محلی)
 *   که چهار ضمانت قابلاندازهگیری میدهد:
 *
 *   1. تمامیت رمزی   → همان بستهٔ `MCIA1` با ChaCha20-Poly1305 + AAD
 *                       (`item|filename|batchId`) + SHA-256 متن و ciphertext.
 *                       هر دستکاری قبل از برگرداندن داده رد میشود.
 *   2. تکثیر         → همان blob روی ۳ حامل مستقل نوشته میشود و **هر نوشتن
 *                       بلافاصله خوانده و هش آن تأیید میشود**؛ اگر حتی یکی
 *                       تأیید نشد، رکورد ثبت نمیشود (ولی هیچی پاک نمیشود).
 *   3. کاتالوگ ضددستکاری → JSONL فقطالحاقی + زنجیر SHA-256. تغییر/حذف
 *                       رکورد قدیمی زنجیر را میشکند و `verifyAll` میفهمد.
 *   4. خودترمیمی     → اگر یک نسخه خراب/ناپدید شد، `get` از نسخهٔ سالم
 *                       میخواند و یک رکورد `repair` الحاق میکند؛ بدون پاک کردن
 *                       نسخهٔ خراب و بدون تغییر Supabase.
 *
 * صداقت (حتماً بخوانید):
 *   - این **دیتابیس کوئریپذیر نیست** (SQL/تراکنش/ایندکس/OTP/realtime ندارد).
 *     دیتابیس اصلی کماکان Supabase است و دستنخورده میماند.
 *   - مخزن عمومی است و آیتمهای IA «World readable»اند؛ کلید داخل سورس
 *     محرمانگی نمیدهد، فقط تمامیت. ادعای امنیت نمیشود.
 *   - تمام حاملها اینجا **آفلاین/fixture**اند: هیچ آپلود واقعی IA، هیچ
 *     لاگین/ارسال واقعی روبیکا، هیچ استقرار، مرج، ورسل یا بکاند عمومی.
 *   - صفر DELETE / DROP / TRUNCATE / RESET. `delete()` عمداً خطا میدهد.
 */

import {
  encryptEnvelope, decryptEnvelope, sha256Hex,
} from '../internet-archive/cipher.mjs';
import {
  sourceKeyBytes, KEY_ALGORITHM, KEY_SOURCE, keyFingerprint,
} from '../internet-archive/key.mjs';
import { Catalog, CATALOG_KIND } from './catalog.mjs';
import { normalizedGet } from './stores.mjs';

export const STRONG_DB_KIND = 'memechat-strong-second-db';
export const STRONG_DB_VERSION = 1;
export const FILE_PREFIX = 'mcdb/';
export const DEFAULT_ITEM = 'memechat-strong-db';

export function blobFilename({ item = DEFAULT_ITEM, id } = {}) {
  if (!id) throw new Error('STRONG_DB_ID_REQUIRED');
  const safe = String(id).replace(/[^A-Za-z0-9_.-]/g, '-');
  return `${FILE_PREFIX}${item}/${safe}/000000.mcia`;
}

const storeName = (s) => s?.name || s?.describe?.()?.name || 'store';

export class StrongDb {
  constructor({ stores, catalog, item = DEFAULT_ITEM, key = sourceKeyBytes() } = {}) {
    if (!Array.isArray(stores) || stores.length < 2) {
      throw new Error('STRONG_DB_AT_LEAST_TWO_STORES');
    }
    for (const s of stores) {
      if (typeof s.put !== 'function' || typeof s.get !== 'function') {
        throw new Error('STRONG_DB_BAD_STORE');
      }
    }
    this.stores = stores;
    this.catalog = catalog || new Catalog();
    this.item = item;
    this.key = key;
    this.ids = new Set();
    this.lastVerify = null;
    this.chainAtInit = null;
  }

  async init() {
    const chain = await this.catalog.load();
    this.chainAtInit = chain;
    const { puts } = this.catalog.index();
    this.ids = new Set(puts.keys());
    return chain;
  }

  /* قبل از هر نوشتن/خواندن دوباره زنجیر چک میشود، نهفقط هنگام init. */
  _chain() {
    const chain = this.catalog.verifyChain();
    if (!chain.ok) throw new Error('STRONG_DB_CATALOG_CHAIN_BROKEN');
    return chain;
  }

  async put({ id, plain } = {}) {
    if (!this.catalog.loaded) await this.init();
    this._chain();
    if (!id) throw new Error('STRONG_DB_ID_REQUIRED');
    if (this.ids.has(id)) throw new Error('STRONG_DB_DUPLICATE_ID');

    const bytes = Buffer.from(plain ?? new Uint8Array(0));
    const filename = blobFilename({ item: this.item, id });
    const { blob, meta } = encryptEnvelope(bytes, {
      item: this.item, filename, batchId: id, key: this.key,
    });
    const sha = sha256Hex(blob);

    const replicas = [];
    for (const store of this.stores) {
      const name = storeName(store);
      let writeOk = false;
      let got = null;
      let reason = null;
      try {
        const write = await store.put(filename, blob);
        writeOk = Boolean(write?.ok);
        got = await normalizedGet(store, filename);
      } catch (err) {
        reason = err?.message || 'STORE_READ_FAILED';
      }
      const ok = writeOk && Boolean(got) && sha256Hex(got) === sha;
      replicas.push({
        name, ok, bytes: got ? got.length : 0, writeOk,
        ...(reason ? { reason } : {}),
      });
      if (!ok) {
        /* رکورد شکست هم الحاق میشود؛ چیزی پاک نمیشود. */
        await this.catalog.append({
          event: 'write-failed', id, filename, sha,
          failedStore: name, reason, replicas, deleted: false,
        });
        throw Object.assign(new Error(`STRONG_DB_REPLICA_VERIFY_FAILED:${name}`), {
          deleted: false, retainedInPrimary: true, replicas,
        });
      }
    }

    const record = await this.catalog.append({
      event: 'put', id, filename, sha,
      plaintextSha256: meta.plaintextSha256,
      ciphertextSha256: meta.ciphertextSha256,
      algorithm: KEY_ALGORITHM,
      keySource: KEY_SOURCE,
      bytes: blob.length,
      plainBytes: bytes.length,
      aad: `${this.item}|${filename}|${id}`,
      replicas,
      deleted: false,
    });
    this.ids.add(id);
    return {
      id, filename, sha,
      plaintextSha256: meta.plaintextSha256,
      ciphertextSha256: meta.ciphertextSha256,
      algorithm: KEY_ALGORITHM,
      keySource: KEY_SOURCE,
      bytes: blob.length,
      plainBytes: bytes.length,
      replicas,
      chainSeq: record.seq,
      verified: true,
      deleted: false,
      destructiveOperations: [],
      retainedInPrimary: true,
    };
  }

  async get({ id } = {}) {
    if (!this.catalog.loaded) await this.init();
    this._chain();
    const record = this.catalog.index().puts.get(id);
    if (!record) throw new Error('STRONG_DB_UNKNOWN_ID');
    const failures = [];

    for (const store of this.stores) {
      const name = storeName(store);
      try {
        const got = await normalizedGet(store, record.filename);
        if (!got) { failures.push({ name, reason: 'MISSING' }); continue; }
        if (sha256Hex(got) !== record.sha) { failures.push({ name, reason: 'SHA_MISMATCH' }); continue; }
        const opened = decryptEnvelope(got, {
          key: this.key,
          expected: {
            plaintextSha256: record.plaintextSha256,
            item: this.item,
            filename: record.filename,
            batchId: record.id,
          },
        });
        if (opened.plaintextSha256 !== record.plaintextSha256) {
          failures.push({ name, reason: 'PLAINTEXT_HASH' }); continue;
        }
        if (failures.length) {
          await this.catalog.append({
            event: 'repair', id,
            recoveredFrom: name,
            failedStores: failures,
            deleted: false,
          });
        }
        return {
          id,
          plain: opened.plain,
          sha: record.sha,
          plaintextSha256: opened.plaintextSha256,
          algorithm: opened.algorithm,
          aad: opened.aad,
          from: name,
          verified: true,
          repaired: failures.length > 0,
          failedStores: failures,
          deleted: false,
          destructiveOperations: [],
          retainedInPrimary: true,
        };
      } catch (err) {
        failures.push({ name, reason: err?.message || 'DECRYPT_FAILED' });
      }
    }
    throw Object.assign(new Error('STRONG_DB_ALL_REPLICAS_FAILED'), {
      deleted: false, retainedInPrimary: true, failedStores: failures,
    });
  }

  async verifyAll() {
    if (!this.catalog.loaded) await this.init();
    const chain = this.catalog.verifyChain();
    const { puts, repairs } = this.catalog.index();
    const records = [...puts.values()];
    const corrupt = [];
    let replicasChecked = 0;

    for (const r of records) {
      for (const store of this.stores) {
        const name = storeName(store);
        replicasChecked++;
        try {
          const got = await normalizedGet(store, r.filename);
          if (!got) { corrupt.push({ id: r.id, store: name, reason: 'MISSING' }); continue; }
          if (sha256Hex(got) !== r.sha) { corrupt.push({ id: r.id, store: name, reason: 'SHA_MISMATCH' }); continue; }
          decryptEnvelope(got, {
            key: this.key,
            expected: {
              plaintextSha256: r.plaintextSha256,
              item: this.item,
              filename: r.filename,
              batchId: r.id,
            },
          });
        } catch (err) {
          corrupt.push({ id: r.id, store: name, reason: err?.message || 'TAG_OR_AAD' });
        }
      }
    }

    this.lastVerify = {
      healthy: chain.ok && records.length > 0 && corrupt.length === 0,
      chainOk: chain.ok,
      records: records.length,
      replicasChecked,
      corrupt,
      repairs: repairs.length,
      checkedAt: new Date().toISOString(),
      deleted: false,
      destructiveOperations: [],
      retainedInPrimary: true,
      primaryRowsUntouched: true,
    };
    return this.lastVerify;
  }

  async status() {
    if (!this.catalog.loaded) await this.init();
    return {
      kind: STRONG_DB_KIND,
      version: STRONG_DB_VERSION,
      algorithm: KEY_ALGORITHM,
      keySource: KEY_SOURCE,
      keyFingerprint: keyFingerprint(),
      integrity: 'ChaCha20-Poly1305 + AAD + SHA-256 + append-only hash chain',
      catalogKind: CATALOG_KIND,
      catalog: this.catalog.describe(),
      stores: this.stores.map((s) => ({ name: storeName(s), ...(s.describe?.() || {}) })),
      replicasPerRecord: this.stores.length,
      lastVerify: this.lastVerify,
      /* صداقت: محرمانگی و کوئریپذیری ادعا نمیشود */
      confidentiality: 'integrity-only (public repo + IA items World readable)',
      queryable: false,
      primary: 'Supabase unchanged',
      deleted: false,
      destructiveOperations: [],
      officialApiUsed: false,
      realUploadPerformed: false,
      realLoginPerformed: false,
      deployed: false,
      merged: false,
      vercelUsed: false,
    };
  }

  async delete(_id) {
    throw new Error('STRONG_DB_NO_DELETE: هیچ رکورد/blob/ردیفی پاک نمیشود');
  }
}

export default StrongDb;
