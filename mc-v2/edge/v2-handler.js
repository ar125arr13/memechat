/* MemeChat v2 — edge/v2-handler.js
 * همان Edge Function فعلی، فقط یک مسیر /api/v2 اضافه میشود.
 * هیچ توکنی تو مرورگر نیست؛ نوشتن روی GitHub فقط اینجا و با کلید سرور انجام میشود.
 * قانون: «اول بنویس، بعد تأیید کن، بعد بگو رسید». هیچ پاککردنی از Supabase انجام نمیده.
 * متغیرهای سرور (همان الگوی api/sync.js فعلی): GITHUB_TOKEN, GITHUB_REPO,
 * GITHUB_PAGES_BRANCH, BACKUP_ENCRYPTION_KEY. مقدارشان هرگز لاگ یا چاپ نمیشود.
 */
import { utf8, fromUtf8, b64d, b64e, sha256Hex, toBytes } from "../src/crypto.js";
import { normalizeIceServers, DEFAULT_STUN_SERVERS } from "../src/ice.js";

const GH_API = "https://api.github.com";
/* fetchFn فقط برای تست تزریق میشود؛ در اجرای واقعی همان fetch محیط است */

function env(name) { return String((globalThis.Deno ? Deno.env.get(name) : globalThis.process?.env?.[name]) || "").trim(); }
function json(res, status, body) {
  return new Response(JSON.stringify(body), { status, headers: {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Cache-Control": "no-store",
  } });
}
function timingEqual(a, b) {
  const x = utf8(String(a)), y = utf8(String(b));
  if (x.length !== y.length) return false;
  let d = 0; for (let i = 0; i < x.length; i++) d |= x[i] ^ y[i];
  return d === 0;
}

async function authenticate(req, deps) {
  const doFetch = deps.fetchFn || globalThis.fetch;
  const auth = String(req.headers.get("authorization") || "");
  if (!/^Bearer\s+/i.test(auth)) return null;
  if (deps.authenticate) return deps.authenticate(auth.replace(/^Bearer\s+/i, "").trim());
  /* پیشفرض: همان مسیر session سیستم فعلی صدا زده میشود (هیچ منطق لاگین عوض نمیشود). */
  const base = env("MIMCHAT_API_BASE");
  if (!base) return null;
  const r = await doFetch(base.replace(/\/+$/, "") + "/api/auth?action=session", { headers: { Authorization: auth } });
  if (!r.ok) return null;
  const d = await r.json();
  return d && d.success && d.user ? d.user : null;
}

async function ghPut(repo, branch, path, bytesB64, message, sha, deps = {}) {
  const doFetch = deps.fetchFn || globalThis.fetch;
  const token = env("GITHUB_TOKEN");
  if (!token) throw new Error("GITHUB_NOT_CONFIGURED");
  const body = { message, content: bytesB64, branch };
  if (sha) body.sha = sha; // فقط برای current.jsonِ کوچک؛ فایلهای نسخهدار هرگز بازنویسی نمیشوند
  const r = await doFetch(`${GH_API}/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", "Content-Type": "application/json", "User-Agent": "MemeChat-V2" },
    body: JSON.stringify(body),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("GITHUB_WRITE_" + r.status);
  if (!d.commit || !d.commit.sha) throw new Error("GITHUB_NO_COMMIT");
  /* تأیید دوم: کامیت واقعاً وجود داشته باشد، بعد به کلاینت بگوییم رسید */
  const v = await doFetch(`${GH_API}/repos/${repo}/git/commits/${encodeURIComponent(d.commit.sha)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "MemeChat-V2" },
  });
  if (!v.ok) throw new Error("GITHUB_COMMIT_VERIFY_FAILED");
  return { commitSha: d.commit.sha, contentSha: d.content && d.content.sha };
}
async function ghHead(repo, branch, path, deps = {}) {
  const doFetch = deps.fetchFn || globalThis.fetch;
  const token = env("GITHUB_TOKEN");
  const r = await doFetch(`${GH_API}/repos/${repo}/contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${encodeURIComponent(branch)}`, {
    headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github+json", "User-Agent": "MemeChat-V2" },
  });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error("GITHUB_HEAD_" + r.status);
  const d = await r.json();
  if (!d || !d.sha) return null;
  let contentB64 = "";
  if (typeof d.content === "string") contentB64 = d.content.replace(/\s/g, "");
  return { sha: d.sha, contentB64 };
}

function assertSafePath(p) {
  if (typeof p !== "string" || p.length > 300) throw new Error("BAD_PATH");
  if (!/^data\/(history|profiles)\/[A-Za-z0-9._\/-]+$/.test(p)) throw new Error("BAD_PATH");
  if (p.indexOf("..") >= 0 || p.indexOf("//") >= 0) throw new Error("BAD_PATH");
  return p;
}

/** فقط محتوای رمزشده قبول میشود: متن خام، توکن یا کلید هرگز نباید به Pages برسد. */
function assertCiphertext(bytes, path) {
  if (path.endsWith(".zip.enc")) {
    const head = fromUtf8(bytes.slice(0, 64));
    if (head.indexOf('"format":"memechat-history-v2"') < 0 && head.indexOf('"format": "memechat-history-v2"') < 0) {
      throw new Error("PLAINTEXT_REFUSED");
    }
  }
  if (path.endsWith(".json")) {
    let o; try { o = JSON.parse(fromUtf8(bytes)); } catch (e) { throw new Error("BAD_JSON"); }
    const forbidden = ["password", "password_hash", "password_salt", "token", "email", "phone", "phone_hash", "secret", "privatekey", "service_role", "session_epoch", "backup_encryption_key", "github_token"];
    /* بازرسی تو در توی همهٔ اشیا/آرایهها؛ قرار نیست چیز حساسی لابلای فایل عمومی جا بماند */
    const walk = (v, depth) => {
      if (!v || typeof v !== "object" || depth > 8) return;
      for (const [k, val] of Object.entries(v)) {
        if (forbidden.some(f => String(k).toLowerCase().includes(f))) throw new Error("SENSITIVE_FIELD_REFUSED:" + k);
        walk(val, depth + 1);
      }
    };
    walk(o, 0);
  }
}
export async function handleV2(req, deps = {}) {
  if (req.method === "OPTIONS") return new Response(null, { status: 204 });
  const u = new URL(req.url);
  /* هر دو شکل پذیرفته میشود: ?action=key و /api/v2/key */
  const pathAction = /(?:^|\/)api\/v2\/(key|append|ice)(?:\/|$)/.exec(u.pathname);
  const action = u.searchParams.get("action") || (pathAction && pathAction[1]) || "";
  let user;
  try { user = await authenticate(req, deps); } catch (e) { return json(null, 502, { success: false, error: "AUTH_UNAVAILABLE" }); }
  if (!user) return json(null, 401, { success: false, error: "لطفاً دوباره وارد شوید." });

  if (action === "key" && req.method === "POST") {
    const master = env("BACKUP_ENCRYPTION_KEY");
    if (!master || master.length < 16) return json(null, 503, { success: false, error: "KEY_NOT_CONFIGURED" });
    const raw = utf8(master);
    const ikm = await globalThis.crypto.subtle.importKey("raw", await globalThis.crypto.subtle.digest("SHA-256", raw), "HKDF", false, ["deriveBits"]);
    const bits = await globalThis.crypto.subtle.deriveBits(
      { name: "HKDF", hash: "SHA-256", salt: utf8("memechat-v2-archive"), info: utf8("user|" + String(user.id)) },
      ikm, 256
    );
    const keyB64 = b64e(new Uint8Array(bits));
    return json(null, 200, { success: true, key: keyB64, scope: String(user.id) });
  }

  if (action === "ice" && req.method === "GET") {
    /* رمز TURN فقط اینجا، پشت همان توکن ورود فعلی. هیچ مقداری لاگ نمیشود. */
    let turn = [];
    const cfg = env("MC_V2_ICE_SERVERS_JSON");
    if (cfg) {
      try {
        const parsed = JSON.parse(cfg);
        if (!Array.isArray(parsed)) throw new Error("NOT_ARRAY");
        turn = parsed;
      } catch (e) { return json(null, 503, { success: false, error: "ICE_CONFIG_BAD_JSON" }); }
    } else {
      const urls = env("MC_V2_TURN_URLS").split(",").map(s => s.trim()).filter(Boolean);
      const username = env("MC_V2_TURN_USERNAME"), credential = env("MC_V2_TURN_CREDENTIAL");
      if (urls.length && username && credential) turn = [{ urls, username, credential }];
      else if (urls.length || username || credential) return json(null, 503, { success: false, error: "ICE_TURN_CONFIG_INCOMPLETE" });
    }
    let iceServers;
    try { iceServers = normalizeIceServers([...DEFAULT_STUN_SERVERS, ...turn], { allowCredentials: true }); }
    catch (e) { return json(null, 503, { success: false, error: "ICE_CONFIG_INVALID" }); }
    return json(null, 200, { success: true, iceServers, turnConfigured: turn.length > 0, scope: String(user.id) });
  }

  if (action === "append" && req.method === "POST") {
    const repo = env("GITHUB_REPO"), branch = env("GITHUB_PAGES_BRANCH") || "main";
    if (!repo || !/^[^/\s]+\/[^/\s]+$/.test(repo)) return json(null, 503, { success: false, error: "GITHUB_NOT_CONFIGURED" });
    let body;
    try { body = await req.json(); } catch (e) { return json(null, 400, { success: false, error: "BAD_BODY" }); }
    const files = Array.isArray(body && body.files) ? body.files : [];
    if (!files.length || files.length > 6) return json(null, 400, { success: false, error: "BAD_FILE_COUNT" });
    let archiveSha = null, lastCommit = null;
    const written = [];
    try {
      for (const f of files) {
        const path = assertSafePath(f.path);
        const bytes = toBytes(b64d(String(f.content || "")));
        if (bytes.length > 12 * 1024 * 1024) throw new Error("FILE_TOO_LARGE");
        assertCiphertext(bytes, path);
        const actual = await sha256Hex(bytes);
        if (f.sha256 && f.sha256 !== actual) throw new Error("SHA256_MISMATCH");
        const isCurrent = path.endsWith("/current.json");
        const existing = await ghHead(repo, branch, path, deps);
        if (!isCurrent && existing) {
          /* فایل نسخهدار: اگر همان محتوا از قبل هست، تلاش مجدد بیدردسر قبول میشود؛
             اگر فرق داشت، بازنویسی ممنوع (هیچ دادهٔ قدیمی عوض نمیشود). */
          const same = existing.contentB64 && existing.contentB64 === String(f.content).replace(/\s/g, "");
          if (!same) throw new Error("IMMUTABLE_FILE_EXISTS");
          written.push({ path, sha256: actual, alreadyPresent: true, commitSha: lastCommit || "existing" });
          if (path.endsWith(".zip.enc")) archiveSha = actual;
          continue;
        }
        const out = await ghPut(repo, branch, path, String(f.content), "chore(v2): publish archive " + path.split("/").pop(), isCurrent && existing ? existing.sha : undefined, deps);
        written.push({ path, sha256: actual, commitSha: out.commitSha });
        lastCommit = out.commitSha;
        if (path.endsWith(".zip.enc")) archiveSha = actual;
      }
    } catch (e) {
      /* شکست → هیچ چیزی پاک نمیشود و کلاینت صفش را نگه میدارد */
      return json(null, 502, { success: false, retainedInSupabase: true, written, error: String(e && e.message || e) });
    }
    return json(null, 200, { success: true, sha256: archiveSha, commitSha: lastCommit, written });
  }

  return json(null, 404, { success: false, error: "not found" });
}
