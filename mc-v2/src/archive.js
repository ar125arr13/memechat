/* MemeChat v2 — archive.js
 * بستهٔ تاریخچه: ZIP فشرده → رمزگذاری AES-GCM → فایل فقطخواندنی با نام نسخهدار.
 * نام مسیرها از هش میاد، نه از اسم گفتگو، تا چیزی از روی اسم فایل لو نره.
 * هیچوقت روی فایل قدیمی بازنویسی نمیشه؛ هر نسخه اسم خودشو داره.
 * کلید از بیرون میاد (دستگاه / سرور)، هیچوقت تو Pages یا GitHub عمومی نیست.
 */
import { utf8, fromUtf8, toBytes, b64e, sha256Hex, encryptBlob, decryptBlob, randomId } from "./crypto.js";
import { createZip, readZip } from "./zip.js";

export const ARCHIVE_VERSION = 2;

export function safeSegment(s) {
  return String(s || "").replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 120);
}
export async function historyKey(conversationId) {
  return sha256Hex(utf8("memechat-history-v2|" + String(conversationId || "")));
}
export function archivePathFromKey(key, version) {
  const h = String(key).replace(/[^0-9a-f]/g, "");
  if (h.length < 8) throw new Error("BAD_HISTORY_KEY");
  return `data/history/${h.slice(0, 2)}/${h}/v${Number(version) || 1}.zip.enc`;
}
export function indexPathFromKey(key, version) {
  const h = String(key).replace(/[^0-9a-f]/g, "");
  return `data/history/${h.slice(0, 2)}/${h}/index-v${Number(version) || 1}.json`;
}
export function currentPathFromKey(key) {
  const h = String(key).replace(/[^0-9a-f]/g, "");
  return `data/history/${h.slice(0, 2)}/${h}/current.json`;
}
export async function archivePath(conversationId, version) {
  return archivePathFromKey(await historyKey(conversationId), version);
}
export function publicProfilePath(username) {
  const u = safeSegment(String(username || "").toLowerCase());
  return `data/profiles/${u.slice(0, 2) || "_"}/${u}.json`;
}

/** ساخت بسته از روی رکوردهای موجود (هیچ فیلدی حذف یا تغییر نمیکنه). */
export async function buildArchive(key, { conversationId, version = 1, messages = [], profiles = [], createdAt = new Date().toISOString(), source = "supabase" }) {
  if (!key) throw new Error("ARCHIVE_KEY_REQUIRED");
  if (!conversationId) throw new Error("CONVERSATION_ID_REQUIRED");
  const list = Array.isArray(messages) ? messages : [];
  const jsonl = list.map(m => JSON.stringify(m)).join("\n") + (list.length ? "\n" : "");
  const hKey = await historyKey(conversationId);
  const manifest = {
    v: ARCHIVE_VERSION,
    historyKey: hKey,
    version: Number(version),
    createdAt,
    source,
    messageCount: list.length,
    profileCount: profiles.length,
    messagesSha256: await sha256Hex(utf8(jsonl)),
    historyId: randomId("h-"),
  };
  const zip = await createZip([
    { name: "manifest.json", data: JSON.stringify(manifest, null, 2) },
    { name: "messages.jsonl", data: jsonl },
    { name: "profiles.json", data: JSON.stringify(profiles, null, 2) },
  ]);
  const envelope = await encryptBlob(key, zip, `memechat-archive|${hKey}|${version}`);
  const bytes = utf8(JSON.stringify({
    format: "memechat-history-v2",
    envelope,
    sha256: await sha256Hex(utf8(b64e(zip))),
  }));
  return { bytes, manifest, byteLength: bytes.length, historyKey: hKey, path: archivePathFromKey(hKey, version) };
}

/** باز کردنِ امن: هش → رمزگشایی → CRC تکتک فایلها → هش محتوا → تطابق تعداد. */
export async function openArchive(key, bytes, { expectedHistoryKey, expectedVersion } = {}) {
  const outer = JSON.parse(fromUtf8(toBytes(bytes)));
  if (outer.format !== "memechat-history-v2") throw new Error("BAD_ARCHIVE_FORMAT");
  const zip = await decryptBlob(key, outer.envelope);
  if (await sha256Hex(utf8(b64e(zip))) !== outer.sha256) throw new Error("ARCHIVE_HASH_MISMATCH");
  const entries = await readZip(zip);
  const byName = Object.fromEntries(entries.map(e => [e.name, e.data]));
  if (!byName["manifest.json"] || !byName["messages.jsonl"]) throw new Error("ARCHIVE_MISSING_PARTS");
  const manifest = JSON.parse(fromUtf8(byName["manifest.json"]));
  if (manifest.v !== ARCHIVE_VERSION) throw new Error("ARCHIVE_VERSION_UNSUPPORTED");
  if (expectedHistoryKey && manifest.historyKey !== expectedHistoryKey) throw new Error("ARCHIVE_CONVERSATION_MISMATCH");
  if (expectedVersion && Number(manifest.version) !== Number(expectedVersion)) throw new Error("ARCHIVE_VERSION_MISMATCH");
  const jsonl = fromUtf8(byName["messages.jsonl"]);
  if (await sha256Hex(utf8(jsonl)) !== manifest.messagesSha256) throw new Error("ARCHIVE_MESSAGES_HASH_MISMATCH");
  const messages = jsonl.trim() ? jsonl.trim().split("\n").map(line => JSON.parse(line)) : [];
  if (messages.length !== manifest.messageCount) throw new Error("ARCHIVE_MESSAGE_COUNT_MISMATCH");
  const profiles = byName["profiles.json"] ? JSON.parse(fromUtf8(byName["profiles.json"])) : [];
  if (profiles.length !== manifest.profileCount) throw new Error("ARCHIVE_PROFILE_COUNT_MISMATCH");
  return { manifest, messages, profiles, byteLength: toBytes(bytes).length };
}

/** فهرست نسخهدار (فقطخواندنی) و اشارهگر خیلی کوچک جاری. */
export function buildIndex({ historyKey, version, path, sha256, previous = null }) {
  return utf8(JSON.stringify({
    v: ARCHIVE_VERSION, historyKey, version: Number(version), path, sha256,
    updatedAt: new Date().toISOString(), previous,
  }, null, 2));
}
export function buildCurrent({ historyKey, version, path, sha256, mode = "legacy" }) {
  return utf8(JSON.stringify({
    v: ARCHIVE_VERSION, historyKey, version: Number(version), path, sha256, mode,
  }, null, 2));
}

/** فقط فیلدهای عمومی پروفایل بیرون میرن؛ ایمیل/تلفن/هش رمز/توکن هرگز. */
export function publicProfile(user) {
  if (!user || typeof user !== "object") return null;
  return {
    id: String(user.id || ""),
    username: String(user.username || ""),
    name: String(user.display_name || user.name || ""),
    avatar: typeof user.avatar === "string" ? user.avatar : "",
    bio: typeof user.bio === "string" ? user.bio : "",
    role: String(user.role || "user"),
    blue_tick: !!user.blue_tick,
    green_tick: !!user.green_tick,
    theme: String(user.theme || "kowa"),
  };
}
