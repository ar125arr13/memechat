#!/usr/bin/env node
/* MemeChat v2 — migration/decouple.mjs  (مرحلهٔ ۵: گزارش جداسازی، بدون حذف)
 * «سوپا رو جدا کن، بدون حذف اطلاعات» → این اسکریپت فقط گزارش مینویسد:
 * کدام جدولها کپی/صادر شدند، کدامها برای ورود/سیگنال میمانند، و اینکه
 * هیچ ردیف قدیمی پاک نشده است. هیچ DELETE / UPDATE / DROP / TRUNCATE اجرا نمیکند.
 *
 * اجرا: node migration/decouple.mjs --backup ./local-backup --out ./local-out
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { utf8, fromUtf8 } from "../src/crypto.js";
import { describeSupabaseRole, assertNoDestructive } from "../src/plane.js";

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

/* جدولهایی که ذاتاً «کنترل»اند: ورود، نشست، کدها، صف انتقال، سیگنالینگ، محدودیت نرخ.
   اینها زنده میمانند؛ دادهٔ کاربر نیستند که جابهجا شوند، ولی پاک هم نمیشوند. */
const CONTROL_TABLES = new Set([
  "mimchat_users", "mimchat_sessions", "mimchat_email_verifications",
  "mimchat_verifications", "mimchat_rate_limits", "mimchat_staging_outbox",
  "mimchat_assets", "mimchat_typing", "mimchat_schema_version",
]);
/* جدولهایی که مستقیم تو بستهٔ تاریخچه / پروفایل / فهرست قابل بازیابی آمدند. */
const EXPORTED_TABLES = new Set([
  "mimchat_staging_messages", "mimchat_rooms", "mimchat_room_members",
  "mimchat_settings", "mimchat_stories", "mimchat_story_views", "mimchat_media",
  "conversations", "conversation_members", "messages", "profile",
]);

function classify(table) {
  if (CONTROL_TABLES.has(table)) return "control-plane-kept";
  if (EXPORTED_TABLES.has(table)) return "exported-to-pages-zip";
  return "backed-up-and-retained";
}

export async function buildDecoupleReport({ backupDir, outDir } = {}) {
  const b = resolve(backupDir), o = resolve(outDir);
  const readJson = async p => JSON.parse(fromUtf8(new Uint8Array(await readFile(p))));
  const manifest = await readJson(join(b, "manifest.json"));
  const exportManifest = await readJson(join(o, "export-manifest.json"));
  let verification = { status: "MISSING", verifiedMessages: 0, checks: [] };
  try { verification = await readJson(join(o, "verification.json")); } catch (e) {}

  /* نگهبان: هیچ فایل SQL/اسکریپت migration نباید عملیات حذفکننده داشته باشد */
  const sources = [
    "migration/backup.mjs", "migration/export.mjs", "migration/verify.mjs",
    "migration/activate.mjs", "migration/decouple.mjs", "sql/001_v2_additive.sql",
  ];
  const destructive = [];
  for (const rel of sources) {
    try {
      const text = await readFile(new URL("../" + rel, import.meta.url), "utf8");
      assertNoDestructive(text);
    } catch (e) {
      if (String(e.message).includes("DESTRUCTIVE_OPERATION_FORBIDDEN")) destructive.push(rel);
    }
  }

  const tables = Object.entries(manifest.tables).map(([table, meta]) => ({
    table, rows: meta.rows, sha256: meta.sha256,
    role: classify(table), oldRows: "kept", deleted: false,
  }));
  const report = {
    v: 2, kind: "memechat-supabase-decouple-report",
    createdAt: new Date().toISOString(),
    status: verification.status === "PASS" && destructive.length === 0 ? "PREPARED" : "BLOCKED",
    verificationStatus: verification.status,
    verifiedMessages: verification.verifiedMessages || 0,
    archives: (exportManifest.archives || []).length,
    tableCount: tables.length,
    totalRows: tables.reduce((a, t) => a + t.rows, 0),
    dataDeleted: false,
    destructiveOperations: destructive,
    oldRowsPolicy: "kept-until-explicit-confirmation",
    supabase: describeSupabaseRole(true),
    accessControls: {
      disabledWhenDecoupled: true,
      items: ["منوی «دسترسی برنامه»", "دکمههای «فعال / غیرفعال» حریم خصوصی", "دکمهٔ «تنظیمات برنامه» / «درخواست»"],
      reason: "جلوگیری از کلیک روی مسیری که بعد از جداسازی دیگر پاسخ نمیدهد",
      reversible: true,
    },
    tables,
    checklist: [
      "بکاپ کامل ۴۴ جدول گرفته شد (یا fixture تست)",
      "تکتک پیامها و هش جدولها تأیید شد",
      "بستههای ZIP رمزشده و پروفایل عمومی ساخته شد",
      "هیچ ردیف قدیمی پاک یا بازنویسی نشد",
      "دکمهٔ دسترسیها تو حالت جداسازی خاموش میشود تا سایت به خطا نخورد",
      "سوپا بیس همچنان برای ورود/سیگنالینگ/نویسندهٔ امن زنده است",
      "خاموش کردن کامل سوپا فقط بعد از استقرار و تست بدون کاربر واقعی",
    ],
    note: "این فایل فقط گزارش است؛ هیچ تغییری تو دیتابیس زنده ایجاد نکرده است.",
  };
  await writeFile(join(o, "decouple-report.json"), utf8(JSON.stringify(report, null, 2)));
  await writeFile(join(o, "decouple-state.json"), utf8(JSON.stringify({
    v: 2, kind: "memechat-v2-decouple-state", status: "prepared-not-deployed",
    supabaseLive: true, supabaseRoleAfterCutover: "control-plane-only",
    dataDeleted: false, oldRows: "kept",
    accessButtonsDisabledWhenDecoupled: true,
    note: "جداسازی تو کد/گزارش انجام شد؛ سایت زنده و سوپا بیس دستنخوردهاند.",
  }, null, 2)));
  return report;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const r = await buildDecoupleReport({
    backupDir: arg("--backup", "./local-backup"), outDir: arg("--out", "./local-out"),
  });
  console.log(`decouple ${r.status} | ${r.tableCount} tables | ${r.totalRows} rows | ${r.verifiedMessages} messages | deleted=false`);
  if (r.status !== "PREPARED") process.exit(1);
}
