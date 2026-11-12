/* MemeChat — کاتالوگ «فقطالحاقی» و زنجیر هش (tamper-evident).
 *
 * «دیتابیس قوی» یعنی هیچ نوشتهای بیدردسر پاک یا بازنویسی نشود و دستکاری
 * هر رکورد قدیمی قابلتشخیص باشد. این کاتالوگ:
 *   - فقط append میکند (هیچ delete / overwrite / truncate ندارد)،
 *   - هر رکورد هش رکورد قبلی را حمل میکند،
 *   - هش خودش = SHA-256(prevHash + canonical-JSON)،
 *   - هنگام خواندن، زنجیر از اول تأیید میشود؛ شکست → علامت، نه پاک کردن.
 *
 * فایلش JSONL است (یک رکورد هر خط) تا حتی با ویرایش دستی هم قابلخواندن
 * باشد. هیچ راز، کلید یا توکنی داخل رکوردها نیست.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

export const CATALOG_KIND = 'MCDB1';
export const CATALOG_VERSION = 1;
export const GENESIS_HASH = '0'.repeat(64);

const RESERVED_FIELDS = new Set(['v', 'kind', 'seq', 'prevHash', 'hash', 'createdAt']);
const sha = (s) => createHash('sha256').update(Buffer.from(s, 'utf8')).digest('hex');

/* JSON پایدار: کلیدها مرتب میشوند تا جابهجایی ترتیب نوشتن، هش را عوض نکند. */
function canonical(value) {
  if (value === null || typeof value !== 'object') {
    const j = JSON.stringify(value);
    return j === undefined ? 'null' : j;
  }
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  return `{${Object.keys(value).sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
}

export function recordHash(record, prevHash = GENESIS_HASH) {
  const { hash: _ignored, ...rest } = record;
  return sha(`${prevHash}|${canonical(rest)}`);
}

export class Catalog {
  constructor({ filePath = null, now = () => new Date().toISOString() } = {}) {
    this.filePath = filePath;
    this.now = now;
    this.records = [];
    this.lastHash = GENESIS_HASH;
    this.loaded = false;
  }

  async load() {
    this.records = [];
    this.lastHash = GENESIS_HASH;
    if (this.filePath) {
      let text = '';
      try { text = await fs.readFile(this.filePath, 'utf8'); }
      catch (e) { if (e?.code !== 'ENOENT') throw e; }
      const lines = text.split('\n');
      for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        try {
          this.records.push(JSON.parse(lines[i]));
        } catch (err) {
          /* خط ناقص/دستکاریشده → علامت زنجیر شکسته، نه پاک کردن فایل. */
          this.records.push({
            v: -1, kind: 'PARSE_ERROR', seq: i + 1, prevHash: '',
            line: i + 1, message: err?.message || 'INVALID_JSON',
          });
        }
      }
    }
    this.loaded = true;
    return this.verifyChain();
  }

  verifyChain() {
    let prev = GENESIS_HASH;
    for (let i = 0; i < this.records.length; i++) {
      const r = this.records[i];
      if (r.v !== CATALOG_VERSION || r.kind !== CATALOG_KIND) {
        return { ok: false, length: this.records.length, brokenAt: i, reason: 'BAD_HEADER' };
      }
      if (r.seq !== i + 1 || r.prevHash !== prev || recordHash(r, prev) !== r.hash) {
        return { ok: false, length: this.records.length, brokenAt: i, reason: 'CHAIN_MISMATCH' };
      }
      prev = r.hash;
    }
    this.lastHash = prev;
    return { ok: true, length: this.records.length, brokenAt: null };
  }

  async append(entry) {
    if (!this.loaded) await this.load();
    if (!this.verifyChain().ok) throw new Error('CATALOG_CHAIN_BROKEN');
    for (const key of Object.keys(entry)) {
      if (RESERVED_FIELDS.has(key)) throw new Error(`CATALOG_RESERVED_FIELD:${key}`);
    }
    const prevHash = this.lastHash;
    const record = {
      v: CATALOG_VERSION,
      kind: CATALOG_KIND,
      seq: this.records.length + 1,
      prevHash,
      ...entry,
      createdAt: this.now(),
    };
    record.hash = recordHash(record, prevHash);
    this.records.push(record);
    this.lastHash = record.hash;
    if (this.filePath) {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      await fs.appendFile(this.filePath, `${JSON.stringify(record)}\n`, 'utf8');
    }
    return record;
  }

  /* ایندکس درونحافظهای برای بازیابی؛ چیزی پاک نمیشود. */
  index() {
    const puts = new Map();
    const repairs = [];
    const writeFailures = [];
    for (const r of this.records) {
      if (r.event === 'put') puts.set(r.id, r);
      else if (r.event === 'repair') repairs.push(r);
      else if (r.event === 'write-failed') writeFailures.push(r);
    }
    return { puts, repairs, writeFailures };
  }

  describe() {
    const chain = this.verifyChain();
    const idx = this.index();
    return {
      kind: CATALOG_KIND,
      version: CATALOG_VERSION,
      appendOnly: true,
      records: this.records.length,
      puts: idx.puts.size,
      repairs: idx.repairs.length,
      writeFailures: idx.writeFailures.length,
      chainOk: chain.ok,
      chainBrokenAt: chain.brokenAt,
      lastHash: this.lastHash,
      filePath: this.filePath,
      deleted: false,
      destructiveOperations: [],
    };
  }
}

export default Catalog;
