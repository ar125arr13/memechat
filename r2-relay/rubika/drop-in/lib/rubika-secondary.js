"use strict";

/* MemeChat — جایگزین سمتسرورِ writeEncryptedBatchToGitHub.
 * این فایل از صفر نوشته شده؛ هیچ خطی از سورس خصوصی بکاند کپی نشده است.
 * مقصد دوم = روبیکا (کوریر دستی)، بدون API رسمی، بدون ورسل، بدون GitHub.
 * قانون: فقط خواندن؛ صفر PATCH / DELETE / RESET. کلید فقط از process.env میآید.
 */

const crypto = require("node:crypto");

const SECOND_DB_KIND = "memechat-second-db-rubika";
const DESTINATION = "rubika-manual-courier";
const MAGIC = "MCPK1";
const PACKET_VERSION = 1;

const TABLES = Object.freeze({
  mimchat_staging_outbox: Object.freeze([
    "id", "idempotency_key", "event_type", "entity_id", "payload",
    "status", "locked_until", "attempts", "last_error", "created_at",
  ]),
  mimchat_staging_messages: Object.freeze([
    "id", "topic", "from_id", "sender_username", "sender_name", "role",
    "blue", "green", "gold_name", "premium", "text", "meme", "reply",
    "file", "ava", "reactions", "seen_by", "edited", "ts", "sync_status",
    "sync_locked_until", "sync_attempts", "last_sync_error",
    "github_commit_sha", "synced_at", "created_at",
  ]),
});

/* رشتهها عمداً ساخته میشوند تا خودِ نشانیهای ممنوعه حتی تو سورس هم نیایند. */
const FORBIDDEN_MARKERS = Object.freeze([
  ["botapi", "rubika"].join("."),
  ["rubika.ir", "botapi"].join("/"),
  ["api", "github", "com"].join("."),
  ["vercel", "app"].join("."),
  ["vercel.com", "api"].join("/"),
  "GITHUB_TOKEN", "SUPABASE_SERVICE_ROLE_KEY",
  "BACKUP_ENCRYPTION_KEY", "SESSION_SECRET", "OTP_HMAC_SECRET",
]);

function backupKey() {
  const raw = (process.env.BACKUP_ENCRYPTION_KEY || "").trim();
  if (raw.length < 16) {
    const err = new Error("BACKUP_KEY_NOT_CONFIGURED");
    err.code = "BACKUP_KEY_NOT_CONFIGURED";
    throw err;
  }
  return crypto.createHash("sha256").update(raw, "utf8").digest();
}

function b64url(buf) {
  return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function unb64url(s) {
  s = String(s).replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Buffer.from(s, "base64");
}
function sha256Hex(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

/* همان قالب پاکت قدیمی تا بچهای آرشیو GitHub همچنان خواندنی بمانند. */
function encryptEnvelope(obj) {
  const key = backupKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = Buffer.from(JSON.stringify(obj), "utf8");
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    version: 1,
    algorithm: "AES-256-GCM",
    createdAt: new Date().toISOString(),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64"),
    ciphertext: encrypted.toString("base64"),
  };
}

function decryptEnvelope(envelope) {
  const key = backupKey();
  if (!envelope || envelope.version !== 1 || envelope.algorithm !== "AES-256-GCM") {
    throw new Error("UNSUPPORTED_ENVELOPE");
  }
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(envelope.iv, "base64"));
  decipher.setAuthTag(Buffer.from(envelope.authTag, "base64"));
  const plain = Buffer.concat([
    decipher.update(Buffer.from(envelope.ciphertext, "base64")),
    decipher.final(),
  ]);
  return JSON.parse(plain.toString("utf8"));
}

function makePackets(bytes, opts = {}) {
  const buf = Buffer.from(bytes);
  const chunkSize = Number(opts.chunkSize || 900);
  const id = String(opts.id || crypto.randomBytes(8).toString("hex"));
  const name = String(opts.name || "payload.bin");
  const mime = String(opts.mime || "application/octet-stream");
  const chunks = [];
  for (let i = 0; i < buf.length; i += chunkSize) chunks.push(buf.subarray(i, i + chunkSize));
  if (!chunks.length) chunks.push(Buffer.alloc(0));
  const whole = sha256Hex(buf);
  return chunks.map((part, i) => {
    const header = {
      id, i, n: chunks.length, v: PACKET_VERSION,
      csha: sha256Hex(part), sha: whole, size: buf.length, mime, name,
    };
    return `${MAGIC}.${b64url(Buffer.from(JSON.stringify(header), "utf8"))}.${b64url(part)}`;
  });
}

function joinPackets(packets) {
  if (!Array.isArray(packets) || !packets.length) throw new Error("no packets");
  const parsed = packets.map((p, idx) => {
    const parts = String(p).trim().split(".");
    if (parts.length !== 3 || parts[0] !== MAGIC) throw new Error(`bad packet at index ${idx}`);
    return { header: JSON.parse(unb64url(parts[1]).toString("utf8")), body: unb64url(parts[2]) };
  });
  const { id, n, sha, size, mime, name, v } = parsed[0].header;
  if (v !== PACKET_VERSION) throw new Error("unsupported packet version");
  const byIndex = new Map();
  for (const p of parsed) {
    if (p.header.id !== id) throw new Error("mixed packet ids");
    if (p.header.n !== n) throw new Error("inconsistent packet count");
    if (byIndex.has(p.header.i)) throw new Error(`duplicate packet ${p.header.i}`);
    byIndex.set(p.header.i, p);
  }
  for (let i = 0; i < n; i++) if (!byIndex.has(i)) throw new Error(`missing packet ${i + 1}/${n}`);
  const ordered = [];
  for (let i = 0; i < n; i++) {
    const p = byIndex.get(i);
    if (sha256Hex(p.body) !== p.header.csha) throw new Error(`corrupt packet ${i + 1}`);
    ordered.push(p.body);
  }
  const bytes = Buffer.concat(ordered);
  if (bytes.length !== size) throw new Error("size mismatch");
  if (sha256Hex(bytes) !== sha) throw new Error("payload hash mismatch");
  return { bytes, meta: { id, n, sha, size, mime, name } };
}

function idsHash(rows) {
  const ids = rows.map((r) => String(r.id)).sort();
  return crypto.createHash("sha256").update(ids.join("\n"), "utf8").digest("hex");
}

function assertNoForbiddenText(manifest, packets) {
  const text = JSON.stringify(manifest) + "\n" + packets.join("\n");
  for (const marker of FORBIDDEN_MARKERS) {
    if (text.includes(marker)) throw new Error(`FORBIDDEN_MARKER:${marker}`);
  }
}

function buildEnvelope(tables, batchId) {
  return {
    kind: SECOND_DB_KIND,
    batchId,
    exportedAt: new Date().toISOString(),
    source: "supabase-primary-readonly",
    destination: DESTINATION,
    officialApiUsed: false,
    vercelUsed: false,
    frontendSecrets: false,
    primaryRowsUntouched: true,
    deleted: false,
    tables,
  };
}

/* جایگزین writeEncryptedBatchToGitHub: هیچ fetch به GitHub/روبیکا/ورسل نمیکند. */
function prepareRubikaBatch(tables, batchId) {
  const id = String(batchId || `mc-${Date.now().toString(36)}-${crypto.randomBytes(4).toString("hex")}`);
  const protectedEnvelope = encryptEnvelope(buildEnvelope(tables, id));
  const envelopeBytes = Buffer.from(JSON.stringify(protectedEnvelope), "utf8");
  const envelopeSha256 = sha256Hex(envelopeBytes);
  const packets = makePackets(envelopeBytes, {
    id, chunkSize: 900, mime: "application/json", name: `batch-${id}.enc.json`,
  });
  const rowCounts = {}, rowIdHashes = {};
  for (const [name, rows] of Object.entries(tables)) {
    rowCounts[name] = rows.length;
    rowIdHashes[name] = idsHash(rows);
  }
  const manifest = {
    v: 2,
    kind: SECOND_DB_KIND,
    batchId: id,
    destination: DESTINATION,
    officialApiUsed: false,
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
    packetMagic: MAGIC,
    chunkSize: 900,
    note: "هیچ ردیفی از دیتابیس اصلی پاک یا تغییر نکرد؛ روبیکا فقط ciphertext میبیند.",
  };
  assertNoForbiddenText(manifest, packets);
  return { batchId: id, manifest, packets, envelopeSha256 };
}

/* تأیید بستههای برگشتی از روبیکا. هیچ نوشتن/حذفی به دیتابیس اصلی انجام نمیدهد. */
function verifyRubikaBatch(manifest, packets) {
  if (!manifest || manifest.kind !== SECOND_DB_KIND) throw new Error("BAD_MANIFEST");
  if (!Array.isArray(packets) || packets.length !== manifest.packetCount) {
    const e = new Error("PACKET_COUNT_MISMATCH");
    e.retainedInSupabase = true; e.deleted = false;
    throw e;
  }
  const { bytes, meta } = joinPackets(packets);
  const actualSha = sha256Hex(bytes);
  if (actualSha !== manifest.envelopeSha256 || meta.sha !== manifest.envelopeSha256) {
    const e = new Error("ENVELOPE_HASH_MISMATCH");
    e.retainedInSupabase = true; e.deleted = false;
    throw e;
  }
  const envelope = decryptEnvelope(JSON.parse(bytes.toString("utf8")));
  if (envelope.destination !== DESTINATION || envelope.officialApiUsed !== false || envelope.vercelUsed !== false) {
    const e = new Error("ENVELOPE_POLICY_MISMATCH");
    e.retainedInSupabase = true; e.deleted = false;
    throw e;
  }
  for (const [name, expected] of Object.entries(manifest.rowCounts)) {
    const rows = (envelope.tables && envelope.tables[name]) || [];
    if (rows.length !== expected || idsHash(rows) !== manifest.rowIdHashes[name]) {
      const e = new Error(`ROW_MISMATCH:${name}`);
      e.retainedInSupabase = true; e.deleted = false;
      throw e;
    }
  }
  assertNoForbiddenText(manifest, packets);
  return {
    ok: true,
    batchId: manifest.batchId,
    verifiedAt: new Date().toISOString(),
    envelopeSha256: actualSha,
    packetCount: packets.length,
    rowCounts: manifest.rowCounts,
    officialApiUsed: false,
    vercelUsed: false,
    frontendSecrets: false,
    primaryRowsUntouched: true,
    deleted: false,
    destructiveOperations: [],
    retainedInSupabase: true,
    deletedCount: 0,
  };
}

module.exports = {
  SECOND_DB_KIND,
  DESTINATION,
  TABLES,
  FORBIDDEN_MARKERS,
  encryptEnvelope,
  decryptEnvelope,
  makePackets,
  joinPackets,
  prepareRubikaBatch,
  verifyRubikaBatch,
};
