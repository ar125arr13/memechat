/* MemeChat v2 — plane.js
 * «جداسازی سوپا» یعنی جدا کردن **داده** از **کنترل**، نه پاک کردن چیزی.
 *
 * داده (تاریخچه، پیام، پروفایل عمومی، تنظیمات) → ZIP رمزشده روی Pages + Cache + صف دستگاه.
 * کنترل (ورود، سیگنالینگ، نوشتن امن، کلید/ICE) → همان لایهٔ نازک احرازشدهٔ فعلی.
 *
 * هیچ ردیف قدیمی پاک نمیشود؛ قدیمیها تا تأیید نهایی سر جاشون قابل برگشتاند.
 */
export const CONTROL_PATHS = Object.freeze([
  "/api/auth",
  "/api/health",
  "/api/v2?action=key",
  "/api/v2?action=ice",
  "/api/v2?action=append",
  "action=rt-post", "action=rt-get", "action=rt-clear",
]);

/* مسیرهایی که «دادهٔ اصلی» حساب میشوند؛ تو حالت جداسازی نباید به سوپا بروند. */
export const DATA_PATHS = Object.freeze([
  "action=history", "action=send", "action=user-card", "action=poll",
  "action=message-file", "action=load-older",
]);

export class SupabaseDataPathForbidden extends Error {
  constructor(path) { super("SUPABASE_DATA_PATH_FORBIDDEN:" + path); this.name = "SupabaseDataPathForbidden"; }
}

/** فقط وقتی decouple=true چک میکند؛ حالت عادی دقیقاً مثل قبل است. */
export function assertControlPlaneOnly(path, { decouple = false } = {}) {
  const p = String(path || "");
  if (decouple && DATA_PATHS.some(d => p.indexOf(d) >= 0)) throw new SupabaseDataPathForbidden(p);
  return true;
}

/** گزارش سادهٔ نقش سوپا، برای نمایش تو مستندات/state بدون افشای هیچ مقداری. */
export function describeSupabaseRole(decouple = false) {
  return {
    before: "ورود + تاریخچه + پیامها + پروفایل + تنظیمات + سیگنالینگ",
    after: decouple
      ? "فقط ورود + سیگنالینگ + نویسندهٔ امن/کلید؛ محل اصلی تاریخچه دیگر اینجا نیست"
      : "همان قبل (تا روز تأیید، دستنخورده)",
    dataDeleted: false,
    oldRows: "kept-until-explicit-confirmation",
  };
}

/** نگهبان متن SQL/کد: اجازهٔ هیچ عملیات حذفکنندهای نمیدهد. */
export function assertNoDestructive(text) {
  const s = String(text || "");
  if (/\b(DELETE\s+FROM|DROP\s+TABLE|TRUNCATE\s+TABLE|ALTER\s+TABLE\s+[^;]*DROP\s+COLUMN)\b/i.test(s)) {
    throw new Error("DESTRUCTIVE_OPERATION_FORBIDDEN");
  }
  return true;
}

/** ساخت لایهٔ API کنترلشده: همهچی میگذرد جز مسیرهای داده وقتی جدا شده باشد. */
export function createControlApi(originalApi, { decouple = false } = {}) {
  if (typeof originalApi !== "function") throw new Error("CONTROL_API_REQUIRED");
  return async function controlApi(path, opts) {
    assertControlPlaneOnly(path, { decouple });
    return originalApi(path, opts);
  };
}
