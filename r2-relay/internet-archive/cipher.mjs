/* MemeChat — رمزگذاری «متفاوت» برای مسیر Internet Archive.
 *
 * متفاوت از مسیر فعلی پروژه:
 *   | | مسیر فعلی (rubika / maxrubika) | این مسیر |
 *   |---|---|---|
 *   | الگوریتم | AES-256-GCM (WebCrypto) | **ChaCha20-Poly1305** (node:crypto) |
 *   | کلید | deriveAesKey(passphrase/salt) | **ثابت داخل سورس** (`key.mjs`) |
 *   | بسته | متن `MCPK1.` / `MCR1.` | **باینری `MCIA1`** |
 *   | nonce/IV | ۱۲ بایت | ۱۲ بایت (تصادفی، هر بار تازه) |
 *   | tag | ۱۶ بایت | ۱۶ بایت Poly1305 |
 *   | AAD | رشتهٔ ساده | **item + filename + batchId** (جابهجایی بسته رد میشود) |
 *
 * چرا ChaCha20-Poly1305: الگوریتم AEAD استاندارد (RFC 8439)، در Node >= 20
 * بدون هیچ پکیج اضافهای موجود است، و واقعاً با AES-GCM فرق دارد — نه فقط
 * تغییر نام. اینجا عمداً از WebCrypto استفاده نشده و مستقیم `node:crypto`
 * بهکار رفته تا تفاوت واقعی باشد.
 *
 * ⚠️ صداقت: چون کلید داخل مخزن عمومی است، این لایه **محرمانگی** نمیدهد؛
 * تمامیت و ساختار میدهد. توضیح کامل در `key.mjs` و سند پروژه.
 *
 * قالب باینری (همه big-endian):
 *   [0..4]   magic  = 'MCIA1'  (5 بایت)
 *   [5]      version = 1
 *   [6]      alg     = 1      (ChaCha20-Poly1305)
 *   [7]      reserved = 0
 *   [8..19]  nonce   = 12 بایت
 *   [20..21] aadLen  = uint16
 *   [22..]   aad     = utf8(`item|filename|batchId`)
 *   [... ]   ciphertext || tag(16)
 */

import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { sourceKeyBytes, KEY_ALGORITHM, KEY_SOURCE } from './key.mjs';

export const MAGIC = Buffer.from('MCIA1', 'ascii');
export const VERSION = 1;
export const ALG_CHACHA20_POLY1305 = 1;
export const NONCE_BYTES = 12;
export const TAG_BYTES = 16;
export const HEADER_BYTES = MAGIC.length + 4 + NONCE_BYTES + 2; // 23

export const ENVELOPE_KIND = 'memechat-ia-chacha20-poly1305';

export function sha256(bytes) {
  return createHash('sha256').update(Buffer.from(bytes)).digest();
}
export function sha256Hex(bytes) {
  return sha256(bytes).toString('hex');
}

export function buildAad({ item, filename, batchId }) {
  if (!item || !filename || !batchId) throw new Error('IA_AAD_FIELDS_REQUIRED');
  return Buffer.from(`${item}|${filename}|${batchId}`, 'utf8');
}

/* رمز کردن یک تکه. خروجی Uint8Array خودکفاست (AAD داخل بسته ذخیره میشود). */
export function encryptEnvelope(plain, { item, filename, batchId, key = sourceKeyBytes() } = {}) {
  const aad = buildAad({ item, filename, batchId });
  if (aad.length > 65535) throw new Error('IA_AAD_TOO_LONG');
  const nonce = randomBytes(NONCE_BYTES);
  const cipher = createCipheriv('chacha20-poly1305', key, nonce, { authTagLength: TAG_BYTES });
  cipher.setAAD(aad);
  const body = Buffer.from(plain);
  const ciphertext = Buffer.concat([cipher.update(body), cipher.final()]);
  const tag = cipher.getAuthTag();

  const header = Buffer.alloc(HEADER_BYTES + aad.length);
  let at = 0;
  MAGIC.copy(header, at); at += MAGIC.length;
  header[at++] = VERSION;
  header[at++] = ALG_CHACHA20_POLY1305;
  header[at++] = 0;   // reserved
  header[at++] = 0;   // reserved
  nonce.copy(header, at); at += NONCE_BYTES;
  header.writeUInt16BE(aad.length, at); at += 2;
  aad.copy(header, at);

  const blob = Buffer.concat([header, ciphertext, tag]);
  return {
    blob: new Uint8Array(blob),
    meta: {
      kind: ENVELOPE_KIND,
      algorithm: KEY_ALGORITHM,
      keySource: KEY_SOURCE,
      version: VERSION,
      magic: MAGIC.toString('ascii'),
      item, filename, batchId,
      nonce: nonce.toString('hex'),
      plaintextSha256: sha256Hex(body),
      ciphertextSha256: sha256Hex(ciphertext),
      size: blob.length,
    },
  };
}

export function inspectEnvelope(blob) {
  const b = Buffer.from(blob);
  if (b.length < HEADER_BYTES + TAG_BYTES) throw new Error('IA_ENVELOPE_TOO_SHORT');
  if (!b.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error('IA_BAD_MAGIC');
  const version = b[MAGIC.length];
  const alg = b[MAGIC.length + 1];
  if (version !== VERSION) throw new Error('IA_UNSUPPORTED_VERSION');
  if (alg !== ALG_CHACHA20_POLY1305) throw new Error('IA_UNSUPPORTED_ALGORITHM');
  let at = MAGIC.length + 4;
  const nonce = b.subarray(at, at + NONCE_BYTES); at += NONCE_BYTES;
  const aadLen = b.readUInt16BE(at); at += 2;
  if (b.length < HEADER_BYTES + aadLen + TAG_BYTES) throw new Error('IA_ENVELOPE_TRUNCATED');
  const aad = b.subarray(at, at + aadLen); at += aadLen;
  const ciphertext = b.subarray(at, b.length - TAG_BYTES);
  const tag = b.subarray(b.length - TAG_BYTES);
  return { version, alg, nonce, aad, ciphertext, tag, headerLength: HEADER_BYTES + aadLen };
}

/* باز کردن؛ هر دستکاری (tag/AAD/هدر/بدنه) قبل از برگرداندن plaintext رد میشود. */
export function decryptEnvelope(blob, { key = sourceKeyBytes(), expected = null } = {}) {
  const p = inspectEnvelope(blob);
  const decipher = createDecipheriv('chacha20-poly1305', key, p.nonce, { authTagLength: TAG_BYTES });
  decipher.setAAD(p.aad);
  decipher.setAuthTag(p.tag);
  const plain = Buffer.concat([decipher.update(p.ciphertext), decipher.final()]);
  if (expected?.plaintextSha256 && sha256Hex(plain) !== expected.plaintextSha256) {
    throw new Error('IA_PLAINTEXT_HASH_MISMATCH');
  }
  if (expected?.item || expected?.filename || expected?.batchId) {
    const want = buildAad({
      item: expected.item, filename: expected.filename, batchId: expected.batchId,
    });
    if (!want.equals(p.aad)) throw new Error('IA_AAD_MISMATCH');
  }
  return {
    plain: new Uint8Array(plain),
    aad: p.aad.toString('utf8'),
    plaintextSha256: sha256Hex(plain),
    ciphertextSha256: sha256Hex(p.ciphertext),
    algorithm: KEY_ALGORITHM,
    keySource: KEY_SOURCE,
  };
}

export default encryptEnvelope;
