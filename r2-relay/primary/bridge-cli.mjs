#!/usr/bin/env node
/* خطفرمان «پل GET» — مخصوص اجرا توسط خودِ عامل از همین محیط.
 *
 *   node primary/bridge-cli.mjs plan                # نقشهٔ قرمزشده، امن برای سند
 *   node primary/bridge-cli.mjs urls                # URLهای کامل (فقط تو ترمینال امن ما)
 *   node primary/bridge-cli.mjs verify --file x.json
 *   node primary/bridge-cli.mjs help
 *
 * توکن/چتآیدی از آرگومان یا process.env خوانده میشوند، هرگز داخل سورس/مخزن
 * نوشته نمیشوند. خروجی `plan` قرمزشده است؛ `urls` فقط وقتی چاپ میشود که
 * صراحتاً خواسته شود.
 */

import { webcrypto } from 'node:crypto';
import fs from 'node:fs';
import {
  buildTrialPlan, verifyGetUpdatesResponse, discoveredChatId,
  parseBaleResponse, GET_BRIDGE_KIND,
} from './get-bridge.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const token = arg('--token') || String(process.env.BALE_BOT_TOKEN || '').trim();
const chatId = arg('--chat-id') || String(process.env.BALE_CHAT_ID || '').trim();

async function plan() {
  const p = await buildTrialPlan({
    token: token || '__BALE_BOT_TOKEN__',
    chatId: chatId || '__BALE_CHAT_ID__',
    emit: false,
    now: () => '2026-11-11T00:00:00.000Z',
  });
  console.log(JSON.stringify(p, null, 2));
}

async function urls() {
  if (!token || !chatId) {
    console.log(JSON.stringify({
      kind: GET_BRIDGE_KIND,
      blocked: 'NO_RUNTIME_CREDENTIALS',
      message: 'توکن و چتآیدی لازم است؛ هیچ URL حاوی توکن ساخته نشد.',
    }, null, 2));
    process.exitCode = 2;
    return;
  }
  const p = await buildTrialPlan({
    token, chatId, emit: true,
    now: () => new Date().toISOString(),
  });
  console.log(JSON.stringify({
    kind: GET_BRIDGE_KIND,
    expectedSha256: p.expectedSha256,
    packetCount: p.packetCount,
    sequence: [
      ...Object.values(p.preflight),
      ...p.sends.map((s) => s.url),
      p.verifyUrl,
    ],
    note: 'getMe → getUpdates → sendMessage(ها) → getUpdates → تأیید SHA',
  }, null, 2));
}

async function verify() {
  const file = arg('--file');
  const expected = arg('--sha');
  if (!file || !expected) {
    console.log('نیاز است: --file <پاسخ getUpdates> --sha <SHA نقشه>');
    process.exitCode = 2;
    return;
  }
  const content = fs.readFileSync(file, 'utf8');
  const r = await verifyGetUpdatesResponse({ content, expectedSha256: expected });
  let chat = null;
  try { chat = discoveredChatId(content); } catch { /* پاسخ نامعتبر */ }
  console.log(JSON.stringify({
    kind: GET_BRIDGE_KIND,
    verified: r.verified,
    receivedCount: r.receivedCount,
    restoredSha256: r.restoredSha256,
    discoveredChatIdPresent: Boolean(chat),
    dataDeleted: r.dataDeleted,
    destructiveOperations: r.destructiveOperations,
  }, null, 2));
  if (!r.verified) process.exitCode = 1;
}

function help() {
  console.log(`پل GET بله — اجرا توسط عامل، بدون اینکه صاحب پروژه دستوری بزند

  plan                 نقشهٔ قرمزشدهٔ URLها (امن، بدون راز)
  urls                 URLهای کامل، فقط با توکن/چتآیدی موقع اجرا
  verify --file F --sha S   تأیید برگشت بستهها و SHA-256
  help                 همین متن

متغیرها (فقط موقع اجرا): BALE_BOT_TOKEN, BALE_CHAT_ID
همچنین: --token / --chat-id / --fixture-env

نکتهٔ فنی: متن بسته «%5F» دارد؛ تو query به «%255F» تبدیل میشود تا سرور
دقیقاً همان «%5F» را تحویل بگیرد و رمزگشایی خراب نشود.

محدودیت صادقانهٔ بله: بازو نمیتواند خودش به حسابی که هرگز به آن پیام نداده
پیام آغاز کند؛ باید یکبار /start زده شود (در چت خصوصی chat_id == user_id).
منبع: مستندات بله و رفتار API همخانوادهٔ تلگرام.`);
}

const cmd = process.argv[2] || 'help';
if (cmd === 'plan') await plan();
else if (cmd === 'urls') await urls();
else if (cmd === 'verify') await verify();
else help();
