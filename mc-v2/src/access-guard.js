/* MemeChat v2 — access-guard.js
 * «دکمهٔ غیرفعال دسترسیها رو کلا خاموش کن، که سایت نره رو هوا.»
 *
 * تو حالت جداسازی، این دکمهها دیگر نباید قابل کلیک باشند چون پشتشان به لایهٔ
 * قدیمی میرود و ممکن است صفحه را به خطا ببرد:
 *   - منوی «تنظیمات ← دسترسی برنامه»
 *   - دکمههای «فعال / غیرفعال» تو بخش حریم خصوصی (mcSetPriv)
 *   - دکمهٔ «تنظیمات برنامه» / «درخواست» تو پنجرهٔ دسترسیها
 *
 * هیچ چیزی پاک نمیشود: فقط کلیک خاموش میشود، عنصر مخفی/غیرفعال میشود،
 * و تابع اصلی تو restore دقیقاً برمیگردد. پیشفرض decouple=false یعنی هیچ تغییری.
 */
export const ACCESS_GUARD_TARGETS = Object.freeze([
  "mcSetPriv", "permPanel", "openAppSettings", "mcPermRequest",
]);

const NOTE = "این بخش موقتاً غیرفعال است؛ اطلاعات قدیمی دستنخورده مانده است.";

export function disableAccessControls({ g = globalThis, doc = null, toast = null } = {}) {
  const document = doc || (g && g.document) || null;
  const restores = [];
  function say() {
    try {
      if (typeof toast === "function") toast(NOTE);
      else if (g && typeof g.toast === "function") g.toast(NOTE);
    } catch (e) {}
  }
  function wrapGlobal(name) {
    const before = g && g[name];
    if (typeof before !== "function") return;
    g[name] = function accessGuardNoop() { say(); return undefined; };
    restores.push(() => { try { g[name] = before; } catch (e) {} });
  }
  for (const name of ACCESS_GUARD_TARGETS) wrapGlobal(name);

  const hasDom = document && typeof document.querySelectorAll === "function";
  if (!hasDom) {
    return {
      disabled: restores.length,
      sweep() {},
      stop() { for (const fn of restores.splice(0).reverse()) { try { fn(); } catch (e) {} } },
    };
  }

  function snapshot(el) {
    return {
      display: el.style ? el.style.display : undefined,
      opacity: el.style ? el.style.opacity : undefined,
      pointerEvents: el.style ? el.style.pointerEvents : undefined,
      disabled: el.disabled,
      title: el.title,
      onclickProp: el.onclick,
      onclickAttr: typeof el.getAttribute === "function" ? el.getAttribute("onclick") : null,
      marked: typeof el.getAttribute === "function" ? el.getAttribute("data-mcv2-access") : null,
    };
  }
  function restoreEl(el, s) {
    try {
      if (el.style) {
        if (s.display === undefined) delete el.style.display; else el.style.display = s.display;
        if (s.opacity === undefined) delete el.style.opacity; else el.style.opacity = s.opacity;
        if (s.pointerEvents === undefined) delete el.style.pointerEvents; else el.style.pointerEvents = s.pointerEvents;
      }
      if ("disabled" in el) el.disabled = s.disabled;
      if ("title" in el) el.title = s.title;
      el.onclick = s.onclickProp;
      if (typeof el.setAttribute === "function") {
        if (s.onclickAttr === null) el.removeAttribute("onclick");
        else el.setAttribute("onclick", s.onclickAttr);
        if (s.marked === null) el.removeAttribute("data-mcv2-access");
      }
    } catch (e) {}
  }
  function disableEl(el, hide) {
    if (!el || (typeof el.getAttribute === "function" && el.getAttribute("data-mcv2-access") === "1")) return;
    const s = snapshot(el);
    restores.push(() => restoreEl(el, s));
    if (typeof el.setAttribute === "function") el.setAttribute("data-mcv2-access", "1");
    el.onclick = null;
    if (typeof el.removeAttribute === "function") el.removeAttribute("onclick");
    if (hide) {
      if (el.style) el.style.display = "none";
    } else {
      if ("disabled" in el) el.disabled = true;
      if (el.style) { el.style.opacity = "0.45"; el.style.pointerEvents = "none"; }
      if ("title" in el) el.title = NOTE;
    }
  }
  function sweep() {
    let nodes = [];
    try {
      nodes = document.querySelectorAll('[onclick*="mcSetPriv"], [onclick*="permPanel"], [onclick*="openAppSettings"], [onclick*="mcPermRequest"], .it, .crow, button');
    } catch (e) { return; }
    for (const el of nodes) {
      const txt = String((el && el.textContent) || "").trim();
      const attr = typeof el.getAttribute === "function" ? String(el.getAttribute("onclick") || "") : "";
      const tag = String((el && el.tagName) || "").toUpperCase();
      const isAccessMenu = txt.indexOf("دسترسی برنامه") >= 0 || txt.indexOf("تنظیمات برنامه") >= 0;
      const isPrivButton = attr.indexOf("mcSetPriv") >= 0 ||
        (tag === "BUTTON" && (txt === "فعال" || txt === "غیرفعال" || txt === "درخواست"));
      const isPermFn = attr.indexOf("permPanel") >= 0 || attr.indexOf("openAppSettings") >= 0 || attr.indexOf("mcPermRequest") >= 0;
      if (isAccessMenu || isPrivButton || isPermFn) disableEl(el, isAccessMenu);
    }
  }
  sweep();

  let observer = null;
  const root = document.body || document.documentElement;
  if (g && typeof g.MutationObserver === "function" && root) {
    try {
      observer = new g.MutationObserver(() => { try { sweep(); } catch (e) {} });
      observer.observe(root, { childList: true, subtree: true });
    } catch (e) { observer = null; }
  }
  return {
    disabled: restores.length,
    sweep,
    stop() {
      if (observer) { try { observer.disconnect(); } catch (e) {} observer = null; }
      for (const fn of restores.splice(0).reverse()) { try { fn(); } catch (e) {} }
    },
  };
}
