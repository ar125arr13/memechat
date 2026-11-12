"use strict";

/* نسخهٔ کامل و بهروزشدهٔ mimchat/api/sync.js
 * تغییر فقط در «معماری دیتابیس دوم»:
 *   - دیگر writeEncryptedBatchToGitHub صدا زده نمیشود → مقصد GitHub کنار رفت
 *   - دیگر PATCH به sync_status / github_commit_sha انجام نمیشود
 *   - دیگر DELETE outbox / TTL پیامها انجام نمیشود (هیچ دادهای پاک نمیشود)
 *   - هیچ ورسل / API رسمی روبیکا / توکن ربات / endpoint خصوصی وجود ندارد
 *   - دیتابیس اصلی فقط «خوانده» میشود؛ نام جدولها و فیلدها دستنخوردهاند
 *
 * این فایل از صفر نوشته شده و سورس خصوصی بکاند را کپی نمیکند.
 * استقرارش موکول به اجازهٔ صریح + بکاپ واقعی + تست بدون کاربر است.
 */

const {
  sendJson,
  readJsonBody,
  getAction,
  sbRequest,
  getAuthenticatedUser,
} = require("../lib/core");
const {
  prepareRubikaBatch,
  verifyRubikaBatch,
  TABLES,
} = require("../lib/rubika-secondary");

async function isAuthorized(req) {
  const user = await getAuthenticatedUser(req);
  return !!(user && (user.role === "owner" || user.role === "super"));
}

/* فقط GET با select؛ هیچ prefer / PATCH / DELETE / POST به Supabase نمیرود. */
async function readAll(table, pageSize = 200, maxPages = 50) {
  const rows = [];
  for (let page = 0; page < maxPages; page++) {
    const q = `${table}?select=*&order=created_at.asc&limit=${pageSize}&offset=${page * pageSize}`;
    const part = await sbRequest(q); // GET پیشفرض
    if (!Array.isArray(part)) break;
    rows.push(...part);
    if (part.length < pageSize) break;
  }
  return rows;
}

module.exports = async function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.statusCode = 204;
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Authorization, Content-Type");
    res.end();
    return;
  }

  const action = getAction(req);

  try {
    if (!(await isAuthorized(req))) {
      return sendJson(res, 403, {
        success: false,
        retainedInSupabase: true,
        error: "فقط مالک یا سوپر ادمین اجازهٔ دیدن/ساخت بچ آرشیو را دارند.",
      });
    }

    if (req.method === "GET" && (action === "status" || !action)) {
      const pendingRows = await sbRequest(
        "mimchat_staging_outbox?select=id,status,created_at&order=created_at.asc&limit=200"
      );
      const list = Array.isArray(pendingRows) ? pendingRows : [];
      return sendJson(res, 200, {
        success: true,
        destination: "rubika-manual-courier",
        officialApiUsed: false,
        vercelUsed: false,
        githubConfigured: false,        // قدیمی: دیگر مقصد نیست
        rubikaConfigured: !!(process.env.BACKUP_ENCRYPTION_KEY || "").trim(),
        frontendSecrets: false,
        primaryRowsUntouched: true,
        deletes: false,
        queueSummary: {
          totalBuffered: list.length,
          pending: list.filter((r) => r.status === "pending").length,
          failedRetainedForRecovery: list.filter((r) => r.status === "failed").length,
          inFlight: list.filter((r) => r.status === "in_flight").length,
        },
        tableNames: Object.keys(TABLES),
        note: "دیتابیس دوم حالا روبیکای دستی است؛ هیچ ردیفی پاک یا تغییر نمیکند.",
      });
    }

    if (req.method !== "POST") {
      return sendJson(res, 405, {
        success: false,
        retainedInSupabase: true,
        error: "متد درخواست مجاز نیست.",
      });
    }

    if (!(process.env.BACKUP_ENCRYPTION_KEY || "").trim()) {
      return sendJson(res, 503, {
        success: false,
        retainedInSupabase: true,
        deletedCount: 0,
        error: "کلید رمزنگاری بکاپ تو محیط امن تنظیم نشده؛ تمام دادهها بدون هیچ حذفی حفظ شدند.",
      });
    }

    if (action === "export") {
      const tables = {};
      for (const table of Object.keys(TABLES)) tables[table] = await readAll(table);
      const prepared = prepareRubikaBatch(tables);
      return sendJson(res, 200, {
        success: true,
        action: "export",
        destination: "rubika-manual-courier",
        officialApiUsed: false,
        vercelUsed: false,
        frontendSecrets: false,
        retainedInSupabase: true,
        deletedCount: 0,
        batchId: prepared.batchId,
        packets: prepared.packets,
        manifest: prepared.manifest,
        message: "بستههای رمزشده آماده شد؛ آنها را کپی کنید توی پیامهای ذخیرهشدهٔ روبیکای خودتان. هیچ چیزی پاک نشد.",
      });
    }

    if (action === "confirm") {
      const body = await readJsonBody(req);
      const report = verifyRubikaBatch(body && body.manifest, body && body.packets);
      return sendJson(res, 200, {
        success: true,
        action: "confirm",
        ...report,
        message: "بستهها موبهمو تأیید شدند؛ دیتابیس اصلی دستنخورده ماند، صفر حذف.",
      });
    }

    return sendJson(res, 400, {
      success: false,
      retainedInSupabase: true,
      error: "عملیات نامعتبر. فقط status / export / confirm پشتیبانی میشود.",
    });
  } catch (e) {
    return sendJson(res, 502, {
      success: false,
      retainedInSupabase: true,
      deletedCount: 0,
      error: String((e && e.message) || "SYNC_FAILED") + " — هیچ دادهای پاک یا تغییر نکرد.",
    });
  }
};
