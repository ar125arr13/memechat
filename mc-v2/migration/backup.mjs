#!/usr/bin/env node
/* MemeChat v2 — migration/backup.mjs  (مرحلهٔ ۱: کپی امن، فقطخواندنی)
 * از همان REST فعلی Supabase میخواند و یک کپی کامل محلی میسازد.
 * هیچ DELETE / UPDATE / DROP انجام نمیدهد. هیچ مقدار محرمانهای چاپ نمیشود.
 * اجرا: SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node backup.mjs --out ./backup
 *       node backup.mjs --fixture --out ./backup   (بدون دسترسی به سرور، برای تست)
 */
import { writeFile, mkdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { utf8, sha256Hex, fromUtf8 } from "../src/crypto.js";
import { makeFixture } from "./fixture.mjs";

/* فهرست دقیق ۴۴ جدول public، راستیآزماییشده از information_schema پروژهٔ زنده
 * (فقط نام جدول و ستون خوانده شد؛ هیچ ردیف/مقدار کاربری خوانده نشد).
 * چهار جدول قدیمی conversations / messages / conversation_members / profile هم
 * عمداً داخل فهرستاند تا «هیچ دادهٔ موجودی» جا نماند. */
export const TABLES = [
  "conversation_members", "conversations", "messages", "profile",
  "mimchat_assets", "mimchat_bans", "mimchat_boosts", "mimchat_bot_handlers",
  "mimchat_bot_runs", "mimchat_bot_scripts", "mimchat_bots",
  "mimchat_challenge_teams", "mimchat_challenge_weeks", "mimchat_code",
  "mimchat_email_verifications", "mimchat_gift_log", "mimchat_gifts", "mimchat_media",
  "mimchat_nft", "mimchat_nft_owned", "mimchat_nft_transfers", "mimchat_nfts",
  "mimchat_pins", "mimchat_premium_icons", "mimchat_publish_comments",
  "mimchat_publish_saves", "mimchat_publishes", "mimchat_rate_limits",
  "mimchat_room_members", "mimchat_rooms", "mimchat_schema_version", "mimchat_sessions",
  "mimchat_settings", "mimchat_spam_reports", "mimchat_staging_messages",
  "mimchat_staging_outbox", "mimchat_sticker_owns", "mimchat_stickers", "mimchat_stories",
  "mimchat_story_views", "mimchat_tickets", "mimchat_typing", "mimchat_users",
  "mimchat_verifications",
];

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
async function fetchTable(base, key, table) {
  const out = [];
  const size = 1000;
  for (let offset = 0; offset < 200000; offset += size) {
    const qs = `select=*&limit=${size}&offset=${offset}`;
    const headers = { apikey: key, Authorization: "Bearer " + key, Accept: "application/json" };
    let r = await fetch(`${base}/rest/v1/${encodeURIComponent(table)}?${qs}&order=id.asc`, { headers });
    if (!r.ok && r.status !== 404) {
      /* بعضی جدولها ستون id ندارند (مثلاً mimchat_rate_limits)؛ بدون مرتبسازی دوباره */
      r = await fetch(`${base}/rest/v1/${encodeURIComponent(table)}?${qs}`, { headers });
    }
    if (r.status === 404) return null;           // جدولی که تو این پروژه وجود ندارد
    if (!r.ok) throw new Error(`READ_FAILED_${table}_${r.status}`);
    const rows = await r.json();
    if (!Array.isArray(rows)) throw new Error(`READ_BAD_SHAPE_${table}`);
    out.push(...rows);
    if (rows.length < size) break;
  }
  return out;
}
export async function createBackup({ fixture = false, base = "", key = "", outDir = "./backup" } = {}) {
  const dir = resolve(outDir);
  await mkdir(join(dir, "tables"), { recursive: true });
  const tables = {};
  let fixtureData = null;
  if (fixture) {
    fixtureData = makeFixture();
    for (const [name, rows] of Object.entries(fixtureData.tables)) tables[name] = rows;
  } else {
    if (!base || !key) throw new Error("SUPABASE_URL_AND_SERVICE_ROLE_KEY_REQUIRED");
    for (const t of TABLES) {
      const rows = await fetchTable(base.replace(/\/+$/, ""), key, t).catch(e => { if (String(e.message).includes("404")) return null; throw e; });
      if (rows === null) continue;
      tables[t] = rows;
    }
  }
  const manifest = { v: 2, kind: "memechat-full-backup", source: fixture ? "fixture" : "supabase-rest-readonly",
    createdAt: new Date().toISOString(), tableCount: Object.keys(tables).length, tables: {} };
  for (const [name, rows] of Object.entries(tables)) {
    const bytes = utf8(JSON.stringify(rows, null, 2));
    await writeFile(join(dir, "tables", name + ".json"), bytes);
    manifest.tables[name] = { rows: rows.length, bytes: bytes.length, sha256: await sha256Hex(bytes) };
  }
  const mBytes = utf8(JSON.stringify(manifest, null, 2));
  await writeFile(join(dir, "manifest.json"), mBytes);
  await writeFile(join(dir, "README.txt"), utf8(
    "MemeChat v2 — backup فقطخواندنی.\n" +
    "این پوشه کپی کامل دادههای خواندهشده است؛ تا پایان migration نگهداری شود.\n" +
    "هیچ دادهٔ زندهای پاک یا تغییر نکرده است.\n" +
    "فایلها حاوی اطلاعات حساساند: در مخزن عمومی قرار نگیرند.\n"
  ));
  return { dir, manifest, tableCount: Object.keys(tables).length, totalRows: Object.values(manifest.tables).reduce((a, x) => a + x.rows, 0) };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = arg("--out", "./backup");
  const fixture = process.argv.includes("--fixture");
  const base = process.env.SUPABASE_URL || "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const r = await createBackup({ fixture, base, key, outDir: out });
  console.log(`backup OK → ${r.dir} | ${r.tableCount} tables | ${r.totalRows} rows | manifest.json`);
}
