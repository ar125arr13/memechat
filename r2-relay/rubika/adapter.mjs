/* MemeChat — هستهٔ مشترک «دیتابیس دوم».
 *
 * این ماژول فقط سمتسرور/ترمینال امن اجرا میشود. خروجیاش «بستههای متنی
 * رمزشدهٔ MCPK1» است. مقصد پیشفرض همان کوریر دستی روبیکا (بدون API) است؛
 * بهصورت اختیاری میتواند با API رسمی «بله» هم فرستاده شود
 * (docs/MESSENGER-API-BALE.md). در هر دو حالت: بدون ورسل، بدون GitHub API،
 * بدون مرورگر، بدون کلید تو فرانتاند، بدون PATCH / DELETE / RESET به Supabase.
 *
 * قانون ثابت: فقط SELECT از دیتابیس اصلی؛ صفر PATCH / DELETE / RESET.
 */

import nodeCrypto from 'node:crypto';
import {
  utf8, fromUtf8, b64url, unb64url, sha256Hex, concatBytes,
} from '../worker/src/crypto.js';
import { makePackets, joinPackets } from '../client/courier.js';

export const SECOND_DB_KIND = 'memechat-second-db-rubika';
export const DESTINATION = 'rubika-manual-courier';   // پیشفرض، بدون توکن
export const BALE_DESTINATION = 'bale-bot-api';        // مسیر اختیاری با API رسمی
export const PACKET_MAGIC = 'MCPK1';

/* همان نام جدولها و فیلدهای زنده؛ عمداً دستنخورده میمانند. */
export const TABLES = Object.freeze({
  mimchat_staging_outbox: Object.freeze([
    'id', 'idempotency_key', 'event_type', 'entity_id', 'payload',
    'status', 'locked_until', 'attempts', 'last_error', 'created_at',
  ]),
  mimchat_staging_messages: Object.freeze([
    'id', 'topic', 'from_id', 'sender_username', 'sender_name', 'role',
    'blue', 'green', 'gold_name', 'premium', 'text', 'meme', 'reply',
    'file', 'ava', 'reactions', 'seen_by', 'edited', 'ts', 'sync_status',
    'sync_locked_until', 'sync_attempts', 'last_sync_error',
    'github_commit_sha', 'synced_at', 'created_at',
  ]),
});

/* رشتهها عمداً ساخته میشوند تا خودِ نشانیهای ممنوعه حتی تو سورس هم نیایند؛
   فقط موقع اسکن خروجی بهکار میروند. */
export const FORBIDDEN_MARKERS = Object.freeze([
  ['botapi', 'rubika'].join('.'),
  ['rubika.ir', 'botapi'].join('/'),
  ['api', 'github', 'com'].join('.'),
  ['vercel', 'app'].join('.'),
  ['vercel.com', 'api'].join('/'),
  'GITHUB_TOKEN', 'SUPABASE_SERVICE_ROLE_KEY',
  'BACKUP_ENCRYPTION_KEY', 'SESSION_SECRET', 'OTP_HMAC_SECRET',
]);

function backupKey(rawKey) {
  const key = String(rawKey || '').trim();
  if (key.length < 16) {
    throw Object.assign(new Error('BACKUP_KEY_NOT_CONFIGURED'), { code: 'BACKUP_KEY_NOT_CONFIGURED' });
  }
  return nodeCrypto.createHash('sha256').update(key, 'utf8').digest(); // 32 bytes
}

/* دقیقاً همان قالب پاکت قدیمی encryptBackupPayload تو lib/core.js،
   تا بچهای آرشیو قدیمی GitHub همچنان قابل خواندن بمانند. */
export function encryptEnvelope(obj, rawKey) {
  const key = backupKey(rawKey);
  const iv = nodeCrypto.randomBytes(12);
  const cipher = nodeCrypto.createCipheriv('aes-256-gcm', key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), 'utf8');
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: 1,
    algorithm: 'AES-256-GCM',
    createdAt: new Date().toISOString(),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: encrypted.toString('base64'),
  };
}

export function decryptEnvelope(envelope, rawKey) {
  const key = backupKey(rawKey);
  if (!envelope || envelope.version !== 1 || envelope.algorithm !== 'AES-256-GCM') {
    throw new Error('UNSUPPORTED_ENVELOPE');
  }
  const decipher = nodeCrypto.createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString('utf8'));
}

function idsHash(rows) {
  const ids = rows.map((r) => String(r.id)).sort();
  return nodeCrypto.createHash('sha256').update(ids.join('\n'), 'utf8').digest('hex');
}

function assertNoForbiddenText(...pieces) {
  const text = pieces.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join('\n');
  for (const marker of FORBIDDEN_MARKERS) {
    if (text.includes(marker)) throw new Error(`FORBIDDEN_MARKER:${marker}`);
  }
}

/* فقط GET. هرگز PATCH / POST / DELETE / PUT به Supabase نمیزند. */
export async function readPrimary({ base, serviceKey, fetchImpl = fetch, pageSize = 200, maxPages = 50 } = {}) {
  const url = String(base || '').replace(/\/+$/, '');
  const key = String(serviceKey || '').trim();
  if (!url || !key) throw new Error('SUPABASE_READ_CONFIG_MISSING');
  const out = {};
  for (const table of Object.keys(TABLES)) {
    const rows = [];
    for (let page = 0; page < maxPages; page++) {
      const q = `${url}/rest/v1/${table}?select=*&order=created_at.asc&limit=${pageSize}&offset=${page * pageSize}`;
      const resp = await fetchImpl(q, {
        method: 'GET',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
        },
      });
      if (!resp.ok) throw new Error(`SUPABASE_READ_${resp.status}`);
      const part = await resp.json();
      if (!Array.isArray(part)) throw new Error('SUPABASE_BAD_RESPONSE');
      rows.push(...part);
      if (part.length < pageSize) break;
    }
    out[table] = rows;
  }
  return out;
}

export function buildEnvelope(tables, batchId, destination = DESTINATION) {
  return {
    kind: SECOND_DB_KIND,
    batchId,
    exportedAt: new Date().toISOString(),
    source: 'supabase-primary-readonly',
    destination,
    officialApiUsed: destination === BALE_DESTINATION,
    vercelUsed: false,
    frontendSecrets: false,
    primaryRowsUntouched: true,
    deleted: false,
    tables,
  };
}

export async function prepareBatch({
  tables, rawKey, batchId = `mc-${Date.now().toString(36)}-${nodeCrypto.randomBytes(4).toString('hex')}`,
  chunkSize = 900, fetchImpl = null, destination = DESTINATION,
} = {}) {
  if (!tables) throw new Error('TABLES_REQUIRED');
  if (![DESTINATION, BALE_DESTINATION].includes(destination)) throw new Error('UNSUPPORTED_DESTINATION');
  const envelope = buildEnvelope(tables, batchId, destination);
  const protectedEnvelope = encryptEnvelope(envelope, rawKey);
  const envelopeBytes = utf8(JSON.stringify(protectedEnvelope));
  const envelopeSha256 = await sha256Hex(envelopeBytes);
  const packets = await makePackets(envelopeBytes, {
    id: batchId,
    chunkSize,
    mime: 'application/json',
    name: `batch-${batchId}.enc.json`,
  });
  const rowCounts = {}, rowIdHashes = {};
  for (const [name, rows] of Object.entries(tables)) {
    rowCounts[name] = rows.length;
    rowIdHashes[name] = idsHash(rows);
  }
  const manifest = {
    v: 2,
    kind: SECOND_DB_KIND,
    batchId,
    destination,
    officialApiUsed: destination === BALE_DESTINATION,
    vercelUsed: false,
    frontendSecrets: false,
    primaryRowsUntouched: true,
    deleted: false,
    destructiveOperations: [],
    createdAt: new Date().toISOString(),
    tableNames: Object.keys(TABLES),
    columnsPreserved: TABLES,
    rowCounts,
    rowIdHashes,
    envelopeSha256,
    packetCount: packets.length,
    packetMagic: PACKET_MAGIC,
    chunkSize,
    note: 'هیچ ردیفی از دیتابیس اصلی پاک یا تغییر نکرد؛ حامل فقط ciphertext میبیند.',
  };
  assertNoForbiddenText(manifest, packets.join('\n'));
  return { manifest, packets, envelopeSha256 };
}

export async function verifyBatch({ manifest, packets, rawKey } = {}) {
  if (!manifest || manifest.kind !== SECOND_DB_KIND) throw new Error('BAD_MANIFEST');
  if (!Array.isArray(packets) || packets.length !== manifest.packetCount) {
    throw Object.assign(new Error('PACKET_COUNT_MISMATCH'), { retainedInPrimary: true, deleted: false });
  }
  const { bytes, meta } = await joinPackets(packets);
  const actualSha = await sha256Hex(bytes);
  if (actualSha !== manifest.envelopeSha256 || meta.sha !== manifest.envelopeSha256) {
    throw Object.assign(new Error('ENVELOPE_HASH_MISMATCH'), { retainedInPrimary: true, deleted: false });
  }
  const protectedEnvelope = JSON.parse(fromUtf8(bytes));
  const envelope = decryptEnvelope(protectedEnvelope, rawKey);
  const expectedOfficialApi = envelope.destination === BALE_DESTINATION;
  if (![DESTINATION, BALE_DESTINATION].includes(envelope.destination)
      || envelope.officialApiUsed !== expectedOfficialApi
      || envelope.vercelUsed !== false) {
    throw Object.assign(new Error('ENVELOPE_POLICY_MISMATCH'), { retainedInPrimary: true, deleted: false });
  }
  for (const [name, expected] of Object.entries(manifest.rowCounts)) {
    const rows = envelope.tables[name] || [];
    if (rows.length !== expected || idsHash(rows) !== manifest.rowIdHashes[name]) {
      throw Object.assign(new Error(`ROW_MISMATCH:${name}`), { retainedInPrimary: true, deleted: false });
    }
  }
  assertNoForbiddenText(manifest, packets.join('\n'));
  return {
    ok: true,
    batchId: manifest.batchId,
    verifiedAt: new Date().toISOString(),
    envelopeSha256: actualSha,
    packetCount: packets.length,
    rowCounts: manifest.rowCounts,
    destination: envelope.destination,
    officialApiUsed: envelope.officialApiUsed,
    vercelUsed: false,
    frontendSecrets: false,
    primaryRowsUntouched: true,
    deleted: false,
    destructiveOperations: [],
    retainedInPrimary: true,
  };
}

export function fixtureTables() {
  const now = new Date().toISOString();
  return {
    mimchat_staging_outbox: [
      { id: '11111111-1111-4111-8111-111111111111', idempotency_key: 'k1', event_type: 'chat_message', entity_id: 'm1', payload: { text: 'سلام' }, status: 'pending', locked_until: null, attempts: 0, last_error: null, created_at: now },
      { id: '22222222-2222-4222-8222-222222222222', idempotency_key: 'k2', event_type: 'chat_message', entity_id: 'm2', payload: { text: 'آرشیو' }, status: 'failed', locked_until: null, attempts: 1, last_error: 'OLD', created_at: now },
    ],
    mimchat_staging_messages: [
      { id: 'm1', topic: 'chat-mcc-kowa-v1', from_id: 'u1', sender_username: 'u1', sender_name: 'یک', role: 'user', blue: false, green: false, gold_name: false, premium: false, text: 'سلام', meme: null, reply: null, file: null, ava: null, reactions: {}, seen_by: [], edited: false, ts: 1, sync_status: 'pending', sync_locked_until: null, sync_attempts: 0, last_sync_error: null, github_commit_sha: null, synced_at: null, created_at: now },
      { id: 'm2', topic: 'chat-mcc-kowa-v1', from_id: 'u2', sender_username: 'u2', sender_name: 'دو', role: 'user', blue: false, green: false, gold_name: false, premium: false, text: 'آرشیو', meme: null, reply: null, file: null, ava: null, reactions: {}, seen_by: [], edited: false, ts: 2, sync_status: 'confirmed', sync_locked_until: null, sync_attempts: 0, last_sync_error: null, github_commit_sha: 'old-github-sha-kept', synced_at: now, created_at: now },
    ],
  };
}
