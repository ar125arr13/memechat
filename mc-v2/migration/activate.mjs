#!/usr/bin/env node
/* MemeChat v2 — migration/activate.mjs  (مرحلهٔ ۴: فقط بعد از PASS)
 * کاری که میکند: فایل کوچک state.json را مینویسد که بگوید نسخهٔ جدید قابل استفاده است.
 * حتی اینجا هم: هیچ DELETE، هیچ overwrite روی داده، هیچ تغییری تو Supabase.
 * برگشت: node activate.mjs --mode mirror  → دوباره مسیر فعلی، بدون پاک شدن چیزی.
 */
import { readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { utf8, fromUtf8 } from "../src/crypto.js";
function arg(name, fallback) { const i = process.argv.indexOf(name); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback; }
const o = resolve(arg("--out", "./out"));
const mode = arg("--mode", "active");
const v = JSON.parse(fromUtf8(new Uint8Array(await readFile(join(o, "verification.json")))));
if (mode === "active" && v.status !== "PASS") {
  console.error("فعلسازی ممنوع: تأیید migration هنوز PASS نشده است. هیچ چیزی تغییر نکرد.");
  process.exit(1);
}
const state = {
  v: 2, kind: "memechat-v2-state", mode, activatedAt: new Date().toISOString(),
  verificationStatus: v.status, verifiedMessages: v.verifiedMessages,
  note: "هیچ دادهٔ قدیمی حذف نشده؛ مسیر فعلی Supabase همچنان در دسترس و قابل بازگشت است.",
};
await writeFile(join(o, "state.json"), utf8(JSON.stringify(state, null, 2)));
console.log(`state → ${mode} (verification=${v.status}). هیچ دادهٔ قدیمی پاک نشد.`);
