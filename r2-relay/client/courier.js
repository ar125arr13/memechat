// "No API" courier — for channels such as Rubika when a bot token is dead/blocked.
// It does NOT scrape, does NOT reverse-engineer private endpoints and needs NO token.
// A human copies short text packets into a chat (or QR) and pastes them back.
// Everything is ciphertext: the carrier sees only opaque text.

import { b64url, unb64url, utf8, fromUtf8, sha256Hex, randomBytes, hex, concatBytes } from '../worker/src/crypto.js';

const MAGIC = 'MCPK1';          // MemeChat Packet v1
export const PACKET_VERSION = 1;

export function makePackets(bytes, { chunkSize = 900, id, mime = 'application/octet-stream', name = 'payload.bin' } = {}) {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('bytes must be Uint8Array');
  const packetId = id || hex(randomBytes(8));
  const chunks = [];
  for (let i = 0; i < bytes.length; i += chunkSize) chunks.push(bytes.subarray(i, i + chunkSize));
  if (!chunks.length) chunks.push(new Uint8Array(0));
  const whole = sha256Hex(bytes);
  return Promise.all(chunks.map(async (part, i) => {
    const header = {
      id: packetId, i, n: chunks.length, v: PACKET_VERSION,
      csha: await sha256Hex(part), sha: await whole,
      size: bytes.length, mime, name,
    };
    return `${MAGIC}.${b64url(utf8(JSON.stringify(header)))}.${b64url(part)}`;
  }));
}

export async function joinPackets(packets) {
  if (!Array.isArray(packets) || !packets.length) throw new Error('no packets');
  const parsed = packets.map((p, idx) => {
    const parts = String(p).trim().split('.');
    if (parts.length !== 3 || parts[0] !== MAGIC) throw new Error(`bad packet at index ${idx}`);
    return { header: JSON.parse(fromUtf8(unb64url(parts[1]))), body: unb64url(parts[2]) };
  });
  const { id, n, sha, size, mime, name, v } = parsed[0].header;
  if (v !== PACKET_VERSION) throw new Error('unsupported packet version');
  const byIndex = new Map();
  for (const p of parsed) {
    if (p.header.id !== id) throw new Error('mixed packet ids');
    if (p.header.n !== n) throw new Error('inconsistent packet count');
    if (byIndex.has(p.header.i)) throw new Error(`duplicate packet ${p.header.i}`);
    byIndex.set(p.header.i, p);
  }
  for (let i = 0; i < n; i++) if (!byIndex.has(i)) throw new Error(`missing packet ${i + 1}/${n}`);
  const ordered = [];
  for (let i = 0; i < n; i++) {
    const p = byIndex.get(i);
    if ((await sha256Hex(p.body)) !== p.header.csha) throw new Error(`corrupt packet ${i + 1}`);
    ordered.push(p.body);
  }
  const bytes = concatBytes(ordered);
  if (bytes.length !== size) throw new Error('size mismatch');
  if ((await sha256Hex(bytes)) !== sha) throw new Error('payload hash mismatch');
  return { bytes, meta: { id, n, sha, size, mime, name } };
}
