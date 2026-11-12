// Shared Web Crypto helpers: works in Cloudflare Workers, browsers and Node >=20.
// The server NEVER sees plaintext: encryption/decryption happens on the client only.

const te = new TextEncoder();
const td = new TextDecoder();

export const utf8 = (s) => te.encode(s);
export const fromUtf8 = (b) => td.decode(b);

export function b64(bytes) {
  let s = '';
  const CH = 0x8000;
  for (let i = 0; i < bytes.length; i += CH) {
    s += String.fromCharCode(...bytes.subarray(i, i + CH));
  }
  return btoa(s);
}

export function unb64(s) {
  const bin = atob(s);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export const b64url = (b) => b64(b).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
export function unb64url(s) {
  s = s.replace(/-/g, '+').replace(/_/g, '/');
  while (s.length % 4) s += '=';
  return unb64(s);
}

export const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
export function randomBytes(n) {
  // getRandomValues() refuses arrays larger than 65,536 bytes in some runtimes.
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 65536) {
    crypto.getRandomValues(out.subarray(i, Math.min(i + 65536, n)));
  }
  return out;
}

export async function sha256Hex(bytes) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
}

export async function deriveAesKey(passphrase, salt, iterations = 150000) {
  const base = await crypto.subtle.importKey('raw', utf8(passphrase), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    base,
    256,
  );
  return crypto.subtle.importKey('raw', new Uint8Array(bits), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

// One chunk = AES-256-GCM(12-byte random IV, 128-bit tag) over plaintext.
// `packet.sha` is the SHA-256 of the CIPHERTEXT, so integrity can be checked
// by an intermediary that cannot decrypt (this is the "verify before delete" hook).
export async function encryptChunk(key, plain, aad = '') {
  const iv = randomBytes(12);
  const ct = new Uint8Array(await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: utf8(aad), tagLength: 128 },
    key,
    plain,
  ));
  return { v: 1, iv: b64url(iv), ct: b64url(ct), sha: await sha256Hex(ct), size: ct.length };
}

export async function decryptChunk(key, packet, aad = '') {
  const ct = unb64url(packet.ct);
  if ((await sha256Hex(ct)) !== packet.sha) throw new Error('integrity check failed: ciphertext hash mismatch');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64url(packet.iv), additionalData: utf8(aad), tagLength: 128 },
    key,
    ct,
  );
  return new Uint8Array(plain);
}

export function concatBytes(list) {
  const len = list.reduce((n, b) => n + b.length, 0);
  const out = new Uint8Array(len);
  let at = 0;
  for (const b of list) { out.set(b, at); at += b.length; }
  return out;
}

export function chunkBytes(bytes, size) {
  const out = [];
  for (let i = 0; i < bytes.length; i += size) out.push(bytes.subarray(i, i + size));
  return out.length ? out : [new Uint8Array(0)];
}
