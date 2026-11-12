/* MemeChat v2 — edge/entry.v2.js
 * نسخهٔ کامل روتر Edge: همان سه مسیر فعلی + /api/v2. هیچ مسیر فعلی حذف نشده است.
 * این فایل «آمادهٔ وصل کردن» است؛ مستقر نشده، چون اجازهٔ تغییر EdgeFunction نداریم.
 */
import authHandler from "../api/auth.js";
import chatHandler from "../api/chat.js";
import healthHandler from "../api/health.js";
import { handleV2 } from "./v2-handler.js";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Authorization, Content-Type",
};
const ROUTES = [
  ["/api/auth", authHandler],
  ["/api/chat", chatHandler],
  ["/api/health", healthHandler],
];

async function toNodeReq(request) {
  const url = new URL(request.url);
  let body;
  if (request.method !== "GET" && request.method !== "HEAD") {
    const text = await request.text();
    if (text) { try { body = JSON.parse(text); } catch (e) { body = text; } }
  }
  return { method: request.method, url: url.pathname + url.search, headers: Object.fromEntries(request.headers.entries()), body };
}

export default async function (request) {
  try {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(request.url);
    if (/(?:^|\/)api\/v2(?:\/|$)/.test(url.pathname)) return handleV2(request);
    const hit = ROUTES.find(([p]) => url.pathname === p || url.pathname.endsWith(p));
    if (!hit) return new Response(JSON.stringify({ success: false, error: "not found: " + url.pathname }), { status: 404, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
    const req = await toNodeReq(request);
    const headers = {};
    const res = { statusCode: 200, _body: null, setHeader(k, v) { headers[k] = String(v); }, getHeader(k) { return headers[k]; }, end(b) { if (b !== undefined && b !== null) this._body = b; } };
    await hit[1](req, res);
    return new Response(res._body, { status: res.statusCode || 200, headers: { ...CORS, ...headers } });
  } catch (e) {
    return new Response(JSON.stringify({ success: false, error: String((e && e.message) || e) }), { status: 500, headers: { ...CORS, "Content-Type": "application/json; charset=utf-8" } });
  }
}
