// Cloudflare Worker prototype — the ONLY component in this design that actually computes.
// Google Drive / GitHub Pages / Rubika / R2 / free file hosts are storage only: they
// cannot execute this code. Run this on Workers, call it from the client.
//
// NOT deployed. NOT wired into index.html. NOT a replacement for the Supabase auth/chat API.

import { utf8, fromUtf8, sha256Hex, unb64url, hex } from './crypto.js';

const JSON_H = { 'Content-Type': 'application/json; charset=utf-8' };
const DEFAULT_ORIGIN = 'https://zahradavoodi69-code.github.io';
const KEY_RE = /^[A-Za-z0-9/_.:-]{1,256}$/;

function validKey(k) {
  return typeof k === 'string' && KEY_RE.test(k) && !k.startsWith('/') && !k.includes('..');
}

function corsHeaders(env, request) {
  const allowed = env.ALLOWED_ORIGIN || DEFAULT_ORIGIN;
  const origin = request.headers.get('Origin') || '';
  return {
    'Access-Control-Allow-Origin': origin === allowed ? origin : allowed,
    'Access-Control-Allow-Methods': 'GET, HEAD, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type, X-MC-SHA, X-MC-KEY',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
  };
}

function json(body, status, env, request, extra = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...JSON_H, ...corsHeaders(env, request), ...extra },
  });
}

// HMAC session token: base64url(payloadJson).base64url(HMAC-SHA256(payloadJson)).
// Same shape as lib/core.js, but the secret lives in a Worker secret, never in the client.
async function verifyToken(env, request) {
  const auth = request.headers.get('Authorization') || '';
  if (!auth.startsWith('Bearer ')) return false;
  const [p, s] = auth.slice(7).split('.');
  if (!p || !s || !env.MC_AUTH_SECRET) return false;
  try {
    const key = await crypto.subtle.importKey(
      'raw', utf8(env.MC_AUTH_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify'],
    );
    const ok = await crypto.subtle.verify('HMAC', key, unb64url(s), utf8(p));
    if (!ok) return false;
    const payload = JSON.parse(fromUtf8(unb64url(p)));
    return typeof payload.exp === 'number' && payload.exp * 1000 > Date.now();
  } catch { return false; }
}

// Best-effort rate limit. NOTE: KV Free allows only 1,000 writes/day, so in production
// use a Durable Object counter (or Workers Rate Limiting API) instead of KV.
async function rateLimit(env, request) {
  if (!env.RATE) return true;
  try {
    const minute = Math.floor(Date.now() / 60000);
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const k = `rl:${minute}:${ip}`;
    const n = Number((await env.RATE.get(k)) || 0);
    const cap = Number(env.RATE_LIMIT_PER_MIN || 120);
    if (n >= cap) return false;
    await env.RATE.put(k, String(n + 1), { expirationTtl: 120 });
  } catch { /* fail open: a KV outage must not corrupt data */ }
  return true;
}

async function requireAuth(env, request) {
  if (!(await verifyToken(env, request))) return json({ error: 'unauthorized' }, 401, env, request);
  if (!(await rateLimit(env, request))) return json({ error: 'rate_limited' }, 429, env, request);
  return null;
}

async function verifyPairs(env, request, keys) {
  const verified = [], failed = [];
  for (const item of keys) {
    const { key, sha } = item || {};
    if (!validKey(key) || typeof sha !== 'string' || sha.length !== 64) { failed.push({ key, reason: 'bad_input' }); continue; }
    const obj = await env.BUCKET.get(key);
    if (!obj) { failed.push({ key, reason: 'missing' }); continue; }
    const bytes = new Uint8Array(await obj.arrayBuffer());
    if ((await sha256Hex(bytes)) !== sha) { failed.push({ key, reason: 'hash_mismatch' }); continue; }
    verified.push({ key, sha, bytes });
  }
  return { verified, failed };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const method = request.method;

    if (method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders(env, request) });
    if (path === '/health') return json({ ok: true, service: 'memechat-r2-relay', deployed: false }, 200, env, request);

    // ---- Immutable ciphertext blob (public read: it is encrypted + content-addressed) ----
    if (method === 'GET' || method === 'HEAD') {
      const m = path.match(/^\/v1\/blob\/([a-f0-9]{64})$/);
      if (m) {
        const obj = await env.BUCKET.get(`blob/${m[1]}`);
        if (!obj) return json({ error: 'not_found' }, 404, env, request);
        const headers = {
          ...corsHeaders(env, request),
          'Content-Type': 'application/octet-stream',
          'Cache-Control': 'public, max-age=31536000, immutable',
          ETag: `"${m[1]}"`,
          'X-Content-Type-Options': 'nosniff',
        };
        return new Response(method === 'HEAD' ? null : obj.body, { status: 200, headers });
      }
    }

    // Everything below needs an authenticated session.
    const denied = await requireAuth(env, request);
    if (denied) return denied;

    // ---- Put ciphertext. X-MC-KEY selects a staging key; otherwise canonical blob/<sha>. ----
    if (method === 'POST' && path === '/v1/blob') {
      const bytes = new Uint8Array(await request.arrayBuffer());
      if (!bytes.length) return json({ error: 'empty_body' }, 400, env, request);
      const sha = await sha256Hex(bytes);
      const declared = request.headers.get('X-MC-SHA');
      if (declared && declared !== sha) return json({ error: 'sha_mismatch' }, 400, env, request);
      const stageKey = request.headers.get('X-MC-KEY');
      if (stageKey && !validKey(stageKey)) return json({ error: 'bad_key' }, 400, env, request);
      const key = stageKey || `blob/${sha}`;
      await env.BUCKET.put(key, bytes, {
        customMetadata: { sha, size: String(bytes.length), at: new Date().toISOString() },
        httpMetadata: { contentType: 'application/octet-stream' },
      });
      return json({ sha, key, size: bytes.length }, 201, env, request);
    }

    // ---- Raw object access (staging keys during sync) ----
    if (path.startsWith('/v1/object/')) {
      const key = decodeURIComponent(path.slice('/v1/object/'.length));
      if (!validKey(key)) return json({ error: 'bad_key' }, 400, env, request);
      if (method === 'GET' || method === 'HEAD') {
        const obj = await env.BUCKET.get(key);
        if (!obj) return json({ error: 'not_found' }, 404, env, request);
        return new Response(method === 'HEAD' ? null : obj.body, {
          status: 200,
          headers: { ...corsHeaders(env, request), 'Content-Type': 'application/octet-stream' },
        });
      }
      if (method === 'DELETE') {
        await env.BUCKET.delete(key);
        return json({ deleted: key }, 200, env, request);
      }
    }

    // ---- Manifest (small JSON; this is the "R2 خیلی کم" part) ----
    if (method === 'POST' && path === '/v1/manifest') {
      const body = await request.text();
      const sha = await sha256Hex(utf8(body));
      await env.BUCKET.put(`manifest/${sha}`, body, {
        httpMetadata: { contentType: 'application/json' },
      });
      return json({ sha, key: `manifest/${sha}` }, 201, env, request);
    }
    if (method === 'GET' && path.startsWith('/v1/manifest/')) {
      const sha = path.slice('/v1/manifest/'.length);
      if (!/^[a-f0-9]{64}$/.test(sha)) return json({ error: 'bad_id' }, 400, env, request);
      const obj = await env.BUCKET.get(`manifest/${sha}`);
      if (!obj) return json({ error: 'not_found' }, 404, env, request);
      return new Response(obj.body, { status: 200, headers: { ...JSON_H, ...corsHeaders(env, request) } });
    }

    // ---- Verify-only endpoint: never deletes anything ----
    if (method === 'POST' && path === '/v1/sync/verify') {
      const { keys } = await request.json();
      if (!Array.isArray(keys)) return json({ error: 'keys_required' }, 400, env, request);
      const { verified, failed } = await verifyPairs(env, request, keys);
      return json({ verified: verified.map((v) => ({ key: v.key, sha: v.sha })), failed }, 200, env, request);
    }

    // ---- Commit: verify ALL -> promote ALL -> delete staging. No partial deletion. ----
    if (method === 'POST' && path === '/v1/sync/commit') {
      const { keys } = await request.json();
      if (!Array.isArray(keys) || !keys.length) return json({ error: 'keys_required' }, 400, env, request);
      const { verified, failed } = await verifyPairs(env, request, keys);
      if (failed.length) {
        return json({ confirmed: false, retainedInStaging: true, failed, verified: verified.length }, 409, env, request);
      }
      for (const v of verified) {
        await env.BUCKET.put(`blob/${v.sha}`, v.bytes, {
          customMetadata: { sha: v.sha, confirmedAt: new Date().toISOString() },
          httpMetadata: { contentType: 'application/octet-stream' },
        });
      }
      const deleted = [];
      for (const v of verified) { await env.BUCKET.delete(v.key); deleted.push(v.key); }
      return json({ confirmed: true, commit: await sha256Hex(utf8(verified.map((v) => v.sha).join(''))), deleted }, 200, env, request);
    }

    // ---- Mirrors: deliberately NOT implemented ----
    if (method === 'POST' && path.startsWith('/v1/mirror/')) {
      return json({
        error: 'not_implemented',
        detail: 'Provider adapters (Drive / GitHub / generic file host) need a server-side proxy. '
          + 'Never put a provider token in the browser. CORS and ToS must be checked per provider.',
      }, 501, env, request);
    }

    return json({ error: 'not_found' }, 404, env, request);
  },
};
