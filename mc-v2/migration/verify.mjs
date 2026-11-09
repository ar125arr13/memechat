#!/usr/bin/env node
/* MemeChat v2 — migration/verify.mjs  (مرحلهٔ ۳: تأیید تکتک دادهها)
 * قبل از هر جابهجایی اجرا میشود. اگر حتی یک رکورد کم/زیاد/تغییریافته باشد → FAIL،
 * و هیچ فعالسازی انجام نمیشود. خروجی: verification.json
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { utf8, fromUtf8, toBytes, sha256Hex, importRawKeyB64 } from "../src/crypto.js";
import { openArchive, publicProfile } from "../src/archive.js";

function arg(name, fallback) { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; }
export async function verifyMigration({ backupDir, outDir, keyB64 }) {
  const b = resolve(backupDir), o = resolve(outDir);
  const key = await importRawKeyB64(keyB64);
  const readJson = async p => JSON.parse(fromUtf8(new Uint8Array(await readFile(p))));
  const backupManifest = await readJson(join(b, "manifest.json"));
  const exportManifest = await readJson(join(o, "export-manifest.json"));
  const sourceMessages = backupManifest.tables["mimchat_staging_messages"]
    ? await readJson(join(b, "tables", "mimchat_staging_messages.json")) : [];
  const sourceUsers = backupManifest.tables["mimchat_users"]
    ? await readJson(join(b, "tables", "mimchat_users.json")) : [];
  const checks = [], errors = [];
  const check = (name, ok, detail) => { checks.push({ name, ok: !!ok, detail }); if (!ok) errors.push(name + ": " + detail); };

  check("source_manifest_tables", backupManifest.tableCount > 0, `tables=${backupManifest.tableCount}`);
  /* قانون «هیچ دادهٔ موجودی جا نماند»: حتی جدولهای قدیمی/کماستفاده هم تکتک هش میشوند */
  const backupTables = Object.keys(backupManifest.tables);
  const exportedTables = Object.keys((exportManifest.sourceBackup && exportManifest.sourceBackup.tables) || {});
  check("backup_table_list_preserved",
    backupTables.length === exportedTables.length && backupTables.every(t => exportedTables.includes(t)),
    `backup=${backupTables.length} export=${exportedTables.length}`);
  check("backup_manifest_table_count", exportManifest.sourceBackup && exportManifest.sourceBackup.tableCount === backupManifest.tableCount,
    `sourceBackup.tableCount=${exportManifest.sourceBackup && exportManifest.sourceBackup.tableCount}`);
  let allTableHashes = true;
  for (const [name, meta] of Object.entries(backupManifest.tables)) {
    const bytes = toBytes(new Uint8Array(await readFile(join(b, "tables", name + ".json"))));
    const actual = await sha256Hex(bytes);
    const declared = exportedTables.includes(name) ? exportManifest.sourceBackup.tables[name].sha256 : null;
    if (actual !== meta.sha256 || actual !== declared) {
      allTableHashes = false; errors.push("BACKUP_TABLE_HASH_MISMATCH:" + name); break;
    }
  }
  check("backup_table_hashes_preserved", allTableHashes, `${backupTables.length} tables byte-for-byte verified`);
  check("export_total_messages", exportManifest.totalMessages === sourceMessages.length,
    `export=${exportManifest.totalMessages} source=${sourceMessages.length}`);

  const srcByTopic = new Map();
  for (const m of sourceMessages) { const t = String(m.topic || "main"); if (!srcByTopic.has(t)) srcByTopic.set(t, []); srcByTopic.get(t).push(m); }
  const srcIds = new Set(sourceMessages.map(m => String(m.id)));
  const seenIds = new Set();
  let verifiedMessages = 0;

  for (const a of exportManifest.archives) {
    const bytes = toBytes(new Uint8Array(await readFile(join(o, a.path))));
    const actualSha = await sha256Hex(bytes);
    check(`hash:${a.topic}`, actualSha === a.sha256, `${actualSha.slice(0, 12)} vs ${a.sha256.slice(0, 12)}`);
    let opened;
    try { opened = await openArchive(key, bytes, { expectedHistoryKey: a.historyKey, expectedVersion: a.version }); }
    catch (e) { check(`open:${a.topic}`, false, String(e.message)); continue; }
    check(`open:${a.topic}`, true, "decrypt + CRC + manifest hash OK");
    const src = (srcByTopic.get(a.topic) || []).slice().sort((x, y) => (Number(x.ts) || 0) - (Number(y.ts) || 0));
    check(`count:${a.topic}`, opened.messages.length === src.length, `archive=${opened.messages.length} source=${src.length}`);
    let identical = opened.messages.length === src.length;
    for (let i = 0; i < Math.min(opened.messages.length, src.length); i++) {
      if (JSON.stringify(opened.messages[i]) !== JSON.stringify(src[i])) { identical = false; errors.push(`record:${a.topic}#${i} changed`); break; }
      seenIds.add(String(opened.messages[i].id)); verifiedMessages++;
    }
    check(`records:${a.topic}`, identical, "byte-for-byte identical (id, username, user_id, ts, file, reactions)");
    for (const p of opened.profiles) {
      if (p.email || p.password_hash || p.phone || p.token) errors.push("PUBLIC_PROFILE_LEAK:" + a.topic);
    }
  }
  check("all_message_ids_present", [...srcIds].every(id => seenIds.has(id)), `${seenIds.size}/${srcIds.size}`);
  for (const u of sourceUsers) {
    const p = publicProfile(u);
    if (Object.keys(p).some(k => ["email", "phone", "password_hash", "token"].includes(k))) errors.push("PUBLIC_PROFILE_FIELD_LEAK:" + u.username);
  }
  check("no_private_fields_in_public_profiles", !errors.some(e => e.includes("PUBLIC_PROFILE")), "email/phone/password_hash/token absent");
  check("user_ids_unchanged", exportManifest.users.length === sourceUsers.length &&
    exportManifest.users.every((u, i) => u.id === sourceUsers[i].id && u.username === sourceUsers[i].username),
    `${exportManifest.users.length} users`);
  check("rooms_preserved", exportManifest.rooms.length === (backupManifest.tables["mimchat_rooms"]?.rows ?? exportManifest.rooms.length),
    `${exportManifest.rooms.length} rooms`);

  const report = {
    v: 2, kind: "memechat-migration-verification", createdAt: new Date().toISOString(),
    status: errors.length ? "FAIL" : "PASS", verifiedMessages, totalSourceMessages: sourceMessages.length,
    archives: exportManifest.archives.length, checks, errors,
    note: "تا وقتی status=PASS نباشد، نسخهٔ جدید فعال نمیشود و هیچ دادهٔ قدیمی پاک نمیگردد.",
  };
  await writeFile(join(o, "verification.json"), utf8(JSON.stringify(report, null, 2)));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const b = arg("--backup", "./backup"), o = arg("--out", "./out");
  const k = process.env.MC_V2_EXPORT_KEY || (await readFile(join(resolve(o), ".export-key.txt"), "utf8").catch(() => ""));
  if (!k) { console.error("MC_V2_EXPORT_KEY لازم است."); process.exit(2); }
  const r = await verifyMigration({ backupDir: b, outDir: o, keyB64: k.trim() });
  console.log(`verify ${r.status} | ${r.verifiedMessages}/${r.totalSourceMessages} messages | ${r.checks.length} checks | ${r.errors.length} errors`);
  if (r.status !== "PASS") process.exit(1);
}
