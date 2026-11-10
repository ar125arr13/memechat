/* شبیهساز آفلاین API بله — فقط برای `--fixture` و تستها.
 * هیچ تماسی با شبکه، هیچ توکن واقعی، هیچ مقدار محرمانهای وجود ندارد.
 */

import { webcrypto } from 'node:crypto';
import { makePackets } from '../client/courier.js';
import { encodePacketForBale } from './api.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

/* مقادیر کاملاً ساختگی؛ بهصورت join ساخته میشوند تا حتی شکل یک توکن واقعی
   تو سورس ذخیره نشود. */
export const FIXTURE_TOKEN = ['123456789', 'fixtureTokenNotReal'].join(':');
export const FIXTURE_CHAT_ID = ['987654', '321'].join('');
export const FIXTURE_ENV = Object.freeze({
  BALE_BOT_TOKEN: FIXTURE_TOKEN,
  BALE_CHAT_ID: FIXTURE_CHAT_ID,
});

const [fixturePacket] = await makePackets(
  new TextEncoder().encode('MemeChat / Bale / offline fixture / بدون شبکه'),
  { id: 'bale-fixture', chunkSize: 900, mime: 'application/json', name: 'fixture.enc.json' },
);
export const FIXTURE_ENCODED_PACKET = `MCB1.${fixturePacket.replace(/_/g, '%5F')}`;
export const FIXTURE_PACKET = fixturePacket;

function methodFromUrl(url) {
  const m = String(url).match(/\/bot[^/]+\/([^?]+)/);
  return m ? m[1] : '';
}

function response(result, { ok = true, status = 200 } = {}) {
  return {
    ok,
    status,
    json: async () => ({ ok, result, error_code: ok ? undefined : status }),
  };
}

export function mockFetch(url, options = {}) {
  const method = methodFromUrl(url);
  if (method === 'getMe') {
    return Promise.resolve(response({
      id: 1, is_bot: true, first_name: 'Fixture', username: 'memchat_fixture_bot',
    }));
  }
  if (method === 'getUpdates') {
    return Promise.resolve(response([
      {
        update_id: 1,
        message: {
          message_id: 10,
          chat: { id: Number(FIXTURE_CHAT_ID), type: 'private' },
          text: '/start',
        },
      },
      {
        update_id: 2,
        message: {
          message_id: 11,
          chat: { id: Number(FIXTURE_CHAT_ID), type: 'private' },
          text: FIXTURE_ENCODED_PACKET,
        },
      },
    ]));
  }
  if (method === 'sendMessage') {
    let body = {};
    try { body = JSON.parse(options.body || '{}'); } catch { body = {}; }
    if (!body.chat_id || !body.text) {
      return Promise.resolve(response(null, { ok: false, status: 400 }));
    }
    return Promise.resolve(response({
      message_id: 100 + String(body.text).length,
      chat: { id: Number(body.chat_id), type: 'private' },
      text: body.text,
    }));
  }
  return Promise.resolve(response(null, { ok: false, status: 404 }));
}

/* برای تست چرخهٔ کامل: همان بستههای exportشده را از getUpdates برمیگرداند. */
export function mockFetchForPackets(packets) {
  const texts = (packets || []).map((p) => encodePacketForBale(p, {}));
  return (url, options = {}) => {
    if (methodFromUrl(url) === 'getUpdates') {
      return Promise.resolve(response([
        {
          update_id: 1,
          message: {
            message_id: 10,
            chat: { id: Number(FIXTURE_CHAT_ID), type: 'private' },
            text: '/start',
          },
        },
        ...texts.map((text, i) => ({
          update_id: i + 2,
          message: {
            message_id: 20 + i,
            chat: { id: Number(FIXTURE_CHAT_ID), type: 'private' },
            text,
          },
        })),
      ]));
    }
    return mockFetch(url, options);
  };
}

/* تست چرخهٔ کامل «بله بهعنوان اصلی»: هر پیام ارسالشده را دقیقاً همانطور
   تو getUpdates برمیگرداند تا بشود فایل رمزشده را پس گرفت و SHA را تأیید کرد. */
export function mockEchoFetch() {
  const sent = [];
  const fetchImpl = async (url, options = {}) => {
    const method = methodFromUrl(url);
    if (method === 'sendMessage') {
      let body = {};
      try { body = JSON.parse(options.body || '{}'); } catch { body = {}; }
      if (!body.chat_id || !body.text) return response(null, { ok: false, status: 400 });
      sent.push(body.text);
      return response({
        message_id: 100 + sent.length,
        chat: { id: Number(body.chat_id), type: 'private' },
        text: body.text,
      });
    }
    if (method === 'getUpdates') {
      return response([
        {
          update_id: 1,
          message: {
            message_id: 10,
            chat: { id: Number(FIXTURE_CHAT_ID), type: 'private' },
            text: '/start',
          },
        },
        ...sent.map((text, i) => ({
          update_id: i + 2,
          message: {
            message_id: 20 + i,
            chat: { id: Number(FIXTURE_CHAT_ID), type: 'private' },
            text,
          },
        })),
      ]);
    }
    return mockFetch(url, options);
  };
  fetchImpl.sent = sent;
  return fetchImpl;
}

export function mockRateLimitFetch() {
  return Promise.resolve({
    ok: false,
    status: 429,
    json: async () => ({
      ok: false,
      error_code: 429,
      description: 'Too Many Requests',
      parameters: { retry_after: 2 },
    }),
  });
}
