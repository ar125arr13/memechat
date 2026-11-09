#!/usr/bin/env node
/* MemeChat v2 — migration/export.mjs  (مرحلهٔ ۲: تبدیل قابل بازگشت)
 * کپی مرحلهٔ ۱ را میخواند و برای هر گفتگو یک ZIP فشرده + رمزشده میسازد.
 * تکتک فیلدها (id / username / user_id / ts / file / reactions / تنظیمات) دستنخورده میمانند.
 * چیزی پاک نمیشود، چیزی بازنویسی نمیشود، نسخهٔ قبلی تا آخر قابل بازیابی است.
 */
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { utf8, fromUtf8, b64e, sha256Hex, importRawKeyB64, generateRawKeyB64 } from "../src/crypto.js";
import { buildArchive, buildIndex, buildCurrent, historyKey, archivePathFromKey, indexPathFromKey, currentPathFromKey, publicProfile, publicProfilePath } from "../src/archive.js";

function arg(name, fallback) { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; }

export async function exportArchives({ backupDir, outDir, keyB64 = null } = {}) {
  const bDir = resolve(backupDir), oDir = resolve(outDir);
  const manifest = JSON.parse(fromUtf8(new Uint8Array(await readFile(join(bDir, "manifest.json")))));
  const keyRaw = keyB64 || await generateRawKeyB64();
  const key = await importRawKeyB64(keyRaw);
  const readTable = async name => {
    if (!manifest.tables[name]) return [];
    return JSON.parse(fromUtf8(new Uint8Array(await readFile(join(bDir, "tables", name + ".json")))));
  };
  const messages = await readTable("mimchat_staging_messages");
  const users = await readTable("mimchat_users");
  const rooms = await readTable("mimchat_rooms");
  const byTopic = new Map();
  for (const m of messages) {
    const t = String(m.topic || "main");
    if (!byTopic.has(t)) byTopic.set(t, []);
    byTopic.get(t).push(m);
  }
  /* گفتگوهایی که پیام ندارند هم فایل خالی میگیرند تا ساختار گروهها حفظ شود */
  for (const r of rooms) { const t = String(r.topic || r.id); if (!byTopic.has(t)) byTopic.set(t, []); }

  const written = [], profiles = [];
  for (const [topic, list] of byTopic) {
    list.sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
    const hKey = await historyKey(topic);
    const topicProfiles = users.filter(u => list.some(m => m.from_id === u.id)).map(publicProfile);
    const built = await buildArchive(key, { conversationId: topic, version: 1, messages: list, profiles: topicProfiles, source: "supabase-backup" });
    const sha256 = await sha256Hex(built.bytes);
    const idx = buildIndex({ historyKey: hKey, version: 1, path: built.path, sha256 });
    const cur = buildCurrent({ historyKey: hKey, version: 1, path: built.path, sha256, mode: "mirror" });
    for (const [rel, bytes] of [[built.path, built.bytes], [indexPathFromKey(hKey, 1), idx], [currentPathFromKey(hKey), cur]]) {
      const p = join(oDir, rel);
      await mkdir(p.slice(0, p.lastIndexOf("/")), { recursive: true });
      await writeFile(p, bytes);
    }
    written.push({ topic, historyKey: hKey, path: built.path, version: 1, sha256, messages: list.length, byteLength: built.byteLength });
  }
  for (const u of users) {
    const p = join(oDir, publicProfilePath(u.username));
    await mkdir(p.slice(0, p.lastIndexOf("/")), { recursive: true });
    await writeFile(p, utf8(JSON.stringify(publicProfile(u), null, 2)));
    profiles.push({ username: u.username, path: publicProfilePath(u.username) });
  }
  /* رکورد کامل و قابل بازیابی: تکتک ردیفها، بدون هیچ حذفی */
  const recoverable = {
    v: 2, kind: "memechat-recoverable-export", createdAt: new Date().toISOString(),
    sourceBackup: manifest, rooms, users: users.map(u => ({ id: u.id, username: u.username })),
    messageIds: messages.map(m => m.id), totalMessages: messages.length, archives: written,
  };
  await mkdir(oDir, { recursive: true });
  await writeFile(join(oDir, "export-manifest.json"), utf8(JSON.stringify(recoverable, null, 2)));
  return { outDir: oDir, keyRaw, written, profiles, totalMessages: messages.length, rooms: rooms.length, users: users.length };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const b = arg("--backup", "./backup"), o = arg("--out", "./out");
  const r = await exportArchives({ backupDir: b, outDir: o, keyB64: process.env.MC_V2_EXPORT_KEY || null });
  if (!process.env.MC_V2_EXPORT_KEY) {
    await writeFile(join(r.outDir, ".export-key.txt"), utf8(r.keyRaw));
    console.log("⚠ کلید تولیدشده تو .export-key.txt ذخیره شد؛ آن را خارج از مخزن نگه دارید.");
  }
  console.log(`export OK → ${r.outDir} | ${r.written.length} archives | ${r.totalMessages} messages | ${r.users} users | ${r.rooms} rooms`);
}
