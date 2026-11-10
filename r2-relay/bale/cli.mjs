#!/usr/bin/env node
/* MemeChat — خطفرمان ارسال پیام مستقیم با API رسمی «بله».
 *
 * مستندات رسمی: https://docs.bale.ai/  |  Base: https://tapi.bale.ai/bot<token>/METHOD
 *
 *   node cli.mjs status --fixture
 *   node cli.mjs chat-id --fixture
 *   node cli.mjs send --text "سلام" --fixture
 *   node cli.mjs send-packets --file ../rubika/out/packets-X.txt --manifest ../rubika/out/manifest-X.json --fixture
 *   node cli.mjs receive --out out/received.txt --fixture
 *   node cli.mjs help
 *
 * بدون --fixture، فقط BALE_BOT_TOKEN و BALE_CHAT_ID از محیط امن سرور خوانده
 * میشوند. هیچ رازی تو چت، سورس، فرانتاند، لاگ یا فایل خروجی قرار نمیگیرد.
 */

import { webcrypto } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  baleStatus, sendDirectMessage, deliverBatch, getBaleUpdates,
  discoverChatId, receivePackets,
} from './api.mjs';
import {
  FIXTURE_ENV, FIXTURE_TOKEN, FIXTURE_CHAT_ID, mockFetch, mockFetchForPackets,
} from './mock.mjs';

if (!globalThis.crypto) globalThis.crypto = webcrypto;

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(HERE, 'out');

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
function has(flag) { return process.argv.includes(flag); }
async function ensureOut() { await fs.mkdir(OUT, { recursive: true }); }

function runtime() {
  const fixture = has('--fixture');
  return {
    fixture,
    env: fixture ? FIXTURE_ENV : process.env,
    token: fixture ? FIXTURE_TOKEN : String(process.env.BALE_BOT_TOKEN || '').trim(),
    chatId: fixture ? FIXTURE_CHAT_ID : String(process.env.BALE_CHAT_ID || '').trim(),
    fetchImpl: fixture ? mockFetch : globalThis.fetch,
  };
}

function requireCredentials(r) {
  if (r.fixture) return;
  if (!r.token || !r.chatId) {
    console.error('❌ BALE_BOT_TOKEN / BALE_CHAT_ID تو محیط امن سرور تنظیم نشده. هیچ تماسی برقرار نشد.');
    process.exit(2);
  }
}

async function doStatus() {
  const r = runtime();
  const s = await baleStatus({ token: r.token, fetchImpl: r.fetchImpl, env: r.env });
  console.log(`بله (API رسمی) | endpoint: ${s.endpoint} | ورسل: خیر | فرانتاند: بدون راز`);
  console.log(`آماده: ${s.ready} | توکن تنظیمشده: ${s.tokenPresent} | چتآیدی تنظیمشده: ${s.chatIdPresent}`);
  console.log(s.message);
}

async function doChatId() {
  const r = runtime();
  requireCredentials(r);
  const updates = await getBaleUpdates({
    token: r.token, fetchImpl: r.fetchImpl, env: r.env, limit: 100,
  });
  const id = discoverChatId(updates);
  if (!id) {
    console.log('هنوز پیامی نرسیده. تو بله به رباتت /start بده، بعد دوباره این دستور رو بزن.');
    return;
  }
  console.log(`چت خصوصی پیدا شد: ${id}`);
  console.log('همین عدد رو فقط تو محیط امن سرور بهعنوان BALE_CHAT_ID بذار؛ تو چت نفرست.');
}

async function doSend() {
  const r = runtime();
  requireCredentials(r);
  const text = arg('--text');
  if (!text) {
    console.error('❌ متن لازم است: --text "سلام"');
    process.exit(2);
  }
  const out = await sendDirectMessage({
    chatId: r.chatId, token: r.token, fetchImpl: r.fetchImpl, env: r.env, text,
  });
  console.log(`✅ پیام مستقیم ارسال شد | ${out.textLength} کاراکتر | messageId: ${out.messageId ?? '—'}`);
  console.log('دیتابیس اصلی دستنخورده؛ صفر حذف.');
}

async function doSendPackets() {
  const r = runtime();
  requireCredentials(r);
  const file = arg('--file');
  const manifestFile = arg('--manifest');
  if (!file || !manifestFile) {
    console.error('❌ --file و --manifest لازماند. اول: node ../rubika/cli.mjs export --destination bale --fixture');
    process.exit(2);
  }
  const packets = (await fs.readFile(file, 'utf8')).split('\n').map((s) => s.trim()).filter(Boolean);
  const manifest = JSON.parse(await fs.readFile(manifestFile, 'utf8'));
  let report;
  try {
    report = await deliverBatch({
      packets, manifest, chatId: r.chatId, token: r.token,
      fetchImpl: r.fetchImpl, env: r.env,
      minIntervalMs: r.fixture ? 0 : 600,
    });
  } catch (err) {
    console.error(`❌ ارسال ناقص ماند: ${err.message}`);
    console.error(`   ${err.sentCount ?? 0}/${packets.length} بسته رفت؛ هیچ ردیفی از Supabase پاک نشد.`);
    process.exit(1);
  }
  await ensureOut();
  const reportFile = path.join(OUT, `delivery-${manifest.batchId}.json`);
  await fs.writeFile(reportFile, JSON.stringify(report, null, 2) + '\n', 'utf8');
  console.log(`✅ ${report.sentCount}/${report.total} بسته به پیام مستقیم بله رفت`);
  console.log(`   بچ: ${report.batchId} | SHA: ${String(report.envelopeSha256).slice(0, 16)}…`);
  console.log(`   گزارش: ${reportFile}`);
  console.log('   دیتابیس اصلی دستنخورده؛ صفر حذف، صفر ریست.');
}

async function doReceive() {
  const r = runtime();
  requireCredentials(r);
  const outFile = arg('--out') || path.join(OUT, 'received-packets.txt');
  const packetsFile = arg('--packets');
  let fetchImpl = r.fetchImpl;
  if (r.fixture && packetsFile) {
    const echoed = (await fs.readFile(packetsFile, 'utf8'))
      .split('\n').map((s) => s.trim()).filter(Boolean);
    fetchImpl = mockFetchForPackets(echoed);
  }
  const updates = await getBaleUpdates({
    token: r.token, fetchImpl, env: r.env, limit: 100,
  });
  const result = receivePackets(updates, r.env);
  await ensureOut();
  await fs.writeFile(outFile, result.packets.join('\n') + (result.packets.length ? '\n' : ''), 'utf8');
  const offsetFile = path.join(OUT, 'receive-offset.json');
  await fs.writeFile(offsetFile, JSON.stringify({ nextOffset: result.nextOffset }, null, 2) + '\n', 'utf8');
  console.log(`✅ ${result.packetCount} بستهٔ MCPK1 برگشت | nextOffset: ${result.nextOffset}`);
  console.log(`   فایل: ${outFile}`);
  console.log('   برای تأیید: node ../rubika/cli.mjs verify --file <همینفایل> --manifest <منیفست>');
  console.log('   یادآوری: بله فقط ۲۴ ساعت / ۲۰۰۰ آپدیت آخر را نگه میدارد.');
}

function help() {
  console.log(`میمچت — ارسال پیام مستقیم با API رسمی بله (بدون ورسل)

آدرس رسمی: https://tapi.bale.ai/bot<token>/sendMessage
متدها: getMe | getUpdates | sendMessage { chat_id, text } | حداکثر ۴۰۹۶ کاراکتر

دستورها:
  status --fixture                 وضعیت اتصال (آفلاین، بدون هیچ راز واقعی)
  chat-id --fixture               پیدا کردن chat_id از /start کاربر
  send --text "سلام" --fixture     یک پیام مستقیم ساده
  send-packets --file F --manifest M --fixture   ارسال بستههای MCPK1
  receive --out F --fixture       برگرداندن بستهها از getUpdates
  receive --packets F --out G --fixture   چرخهٔ کامل تست: همان بستهها برگردند
  help                            همین متن

بدون --fixture (محیط امن سرور، نه چت/مرورگر/مخزن):
  BALE_BOT_TOKEN   توکنی که خودت تو بله از @botfather میگیری
  BALE_CHAT_ID     عدد چت خصوصی؛ با chat-id پیدا میشود
  node cli.mjs status
  node cli.mjs send --text "سلام"

قوانین ثابت: فقط سرور؛ صفر راز تو فرانتاند/لاگ/چت؛ بدون ورسل، بدون GitHub API،
بدون API خصوصی روبیکا؛ فقط SELECT از Supabase؛ صفر DELETE/RESET/PATCH؛
هیچ استقرار یا تغییر زندهای انجام نشد.`);
}

const cmd = process.argv[2] || 'help';
if (cmd === 'status') await doStatus();
else if (cmd === 'chat-id') await doChatId();
else if (cmd === 'send') await doSend();
else if (cmd === 'send-packets') await doSendPackets();
else if (cmd === 'receive') await doReceive();
else help();
