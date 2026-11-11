/* تستهای آفلاین مسیر Open Platform رسمی TeraBox.
 * اجرا: node terabox/tests/run.mjs
 * هیچ شبکه، حساب، لاگین، کلید اپ واقعی، توکن واقعی یا آپلودی در کار نیست.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(HERE, '..');
const REPO_DOCS = path.join(ROOT, '..', '..', 'docs', 'TERABOX-OPEN-PLATFORM.md');

import {
  DOCS_URL, INTEGRATIONS_URL, TOS_URL, OAUTH_ORIGIN, APP_ID_FIXED,
  APP_ROOT_PREFIX, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_SECONDS,
  MIN_SHARD_BYTES, ENV_KEYS, OAUTH_ERRORS, FORBIDDEN_OPERATIONS,
  buildSign, buildAuthorizationUrl, buildDeviceCodeUrl, buildTokenForm,
  buildRefreshForm, buildTokenInfoForm, normalizeOrigin, assertSafePath,
  assertNoDestructive, buildQuotaUrl, buildPrecreateForm,
  buildSuperfile2Url, buildCreateForm, buildListUrl, buildDownloadUrl,
  redact, parseErrno, describeOpenPlatform,
} from '../openplatform.mjs';
import { TeraboxAccounts, MAX_ACCOUNTS } from '../accounts.mjs';
import { TeraboxTransport, FixtureTerabox } from '../transport.mjs';

let passed = 0;
const test = async (name, fn) => {
  try { await fn(); console.log(`  ok  ${name}`); passed++; }
  catch (e) { console.error(`FAIL  ${name}\n      ${e.stack}`); process.exitCode = 1; }
};

const sha = (b) => createHash('sha256').update(b).digest('hex');
const md5 = (b) => createHash('md5').update(b).digest('hex');
const APP_ROOT = `${APP_ROOT_PREFIX}MemeChat-/`;
const CID = 'TEST_CLIENT_ID';
const CSEC = 'TEST_CLIENT_SECRET';
const PSEC = 'TEST_PRIVATE_SECRET';
const TS = 1705570481;

await test('سند رسمی است، ولی self-service نیست؛ لاگین/آپلود واقعی ادعا نشده', () => {
  const o = describeOpenPlatform();
  assert.equal(o.officialApi, true);
  assert.equal(o.selfService, false);
  assert.equal(o.officialDocs, DOCS_URL);
  assert.equal(o.appCredentialsInSource, false);
  assert.equal(o.realLoginPerformed, false);
  assert.equal(o.realUploadPerformed, false);
  assert.equal(o.quotaPooling, false);
  assert.deepEqual(o.destructiveOperations, []);
  assert.equal(o.uploadSteps.length, 3);
  assert.equal(ACCESS_TOKEN_TTL_SECONDS, 172800);
  assert.equal(REFRESH_TOKEN_TTL_SECONDS, 2592000);
  assert.equal(MIN_SHARD_BYTES, 4 * 1024 * 1024);
  assert.equal(INTEGRATIONS_URL, 'https://www.terabox.com/integrations');
  assert.equal(TOS_URL, 'https://www.terabox.com/terms/duty');
  assert.equal(OAUTH_ERRORS[100001].includes('unknown client'), true);
});

await test('امضای رسمی: md5(client_id_timestamp_client_secret_private_secret)', () => {
  const expect = createHash('md5').update(`${CID}_${TS}_${CSEC}_${PSEC}`).digest('hex');
  assert.equal(buildSign({ clientId: CID, clientSecret: CSEC, privateSecret: PSEC, timestamp: TS }), expect);
  assert.equal(buildSign({ clientId: CID, clientSecret: CSEC, privateSecret: PSEC, timestamp: String(TS) }), expect);
  assert.throws(() => buildSign({ clientId: CID, timestamp: TS }), /TERABOX_SIGN_MISSING_PARAMS/);
});

await test('صفحهٔ لاگین OAuth و device-code روی میزبان رسمی ساخته میشود', () => {
  const u = new URL(buildAuthorizationUrl({ clientId: CID }));
  assert.equal(u.origin, OAUTH_ORIGIN);
  assert.equal(u.pathname, '/wap/outside/login');
  assert.equal(u.searchParams.get('clientId'), CID);
  assert.equal(buildAuthorizationUrl({ clientId: CID, isFromApp: true }).includes('isFromApp=1'), true);
  const d = new URL(buildDeviceCodeUrl({ clientId: CID }));
  assert.equal(d.pathname, '/oauth/devicecode');
  assert.equal(d.searchParams.get('client_id'), CID);
  assert.throws(() => buildDeviceCodeUrl({}), /TERABOX_MISSING_CLIENT_ID/);
});

await test('فرم gettoken شامل grant_type/code/sign است و رمز خامی چاپ نمیشود', () => {
  const form = buildTokenForm({ clientId: CID, clientSecret: CSEC, privateSecret: PSEC,
    code: '57mYYcfS9f', grantType: 'authorization_code', timestamp: TS });
  assert.equal(form.get('grant_type'), 'authorization_code');
  assert.equal(form.get('code'), '57mYYcfS9f');
  assert.equal(form.get('client_id'), CID);
  assert.equal(form.get('timestamp'), String(TS));
  assert.equal(form.get('sign'), buildSign({ clientId: CID, clientSecret: CSEC, privateSecret: PSEC, timestamp: TS }));
  const dev = buildTokenForm({ clientId: CID, clientSecret: CSEC, privateSecret: PSEC,
    code: '580uZ7Svrm', grantType: 'device_code', timestamp: TS });
  assert.equal(dev.get('grant_type'), 'device_code');
  assert.throws(() => buildTokenForm({ grantType: 'authorization_code', code: 'x' }), /TERABOX_NO_APP_CREDENTIALS/);
  assert.throws(() => buildTokenForm({ clientId: CID, clientSecret: CSEC, privateSecret: PSEC,
    grantType: 'nope', code: 'x' }), /TERABOX_UNSUPPORTED_GRANT_TYPE/);
});

await test('refresh و tokeninfo فیلدهای درست سند رسمی را دارند', () => {
  const r = buildRefreshForm({ clientId: CID, clientSecret: CSEC, privateSecret: PSEC,
    refreshToken: 'REFRESH_ONE_TIME', timestamp: TS });
  assert.equal(r.get('refresh_token'), 'REFRESH_ONE_TIME');
  assert.equal(r.get('code'), null);
  assert.equal(r.get('sign').length, 32);
  const i = buildTokenInfoForm({ accessToken: 'ACCESS_X' });
  assert.equal(i.get('access_token'), 'ACCESS_X');
  assert.equal(i.get('client_secret'), null);
  assert.throws(() => buildTokenInfoForm({}), /TERABOX_MISSING_ACCESS_TOKEN/);
});

await test('پاسخهای زندهٔ واقعی سرور (بدون هیچ رمز) درست تفسیر میشوند', () => {
  const fx = JSON.parse(fs.readFileSync(path.join(HERE, 'fixtures', 'oauth-errors.json'), 'utf8'));
  assert.equal(fx.requests.length, 2);
  const a = parseErrno(fx.requests[0].response);
  const b = parseErrno(fx.requests[1].response);
  assert.equal(a.errno, 100001);
  assert.equal(a.ok, false);
  assert.equal(a.show_msg, 'unknown client');
  assert.equal(a.message, OAUTH_ERRORS[100001]);
  assert.equal(b.errno, 200002);
  assert.equal(b.show_msg, 'invalid access_token');
  assert.equal(parseErrno('{"errno":0,"data":{"x":1}}').ok, true);
});

await test('مسیرها فقط داخل فضای اپ مجازاند و دامنهٔ API پاکسازی میشود', () => {
  assert.equal(assertSafePath(`${APP_ROOT}000001.bin`), `${APP_ROOT}000001.bin`);
  assert.throws(() => assertSafePath('/'), /TERABOX_PATH_OUTSIDE_APP_ROOT/);
  assert.throws(() => assertSafePath(`${APP_ROOT}../escape`), /TERABOX_INVALID_PATH/);
  assert.equal(normalizeOrigin('www.terabox.com'), 'https://www.terabox.com');
  assert.equal(normalizeOrigin('https://c-jp.terabox.com'), 'https://c-jp.terabox.com');
  assert.throws(() => normalizeOrigin('javascript:alert(1)'), /TERABOX_INVALID_API_DOMAIN/);
  const q = new URL(buildQuotaUrl({ accessToken: 'TOKEN', apiDomain: 'www.terabox.app' }));
  assert.equal(q.pathname, '/openapi/api/quota');
  assert.equal(q.searchParams.get('access_tokens'), 'TOKEN');
});

await test('precreate و create طبق سند، و rtype=3 (overwrite) ممنوع است', () => {
  const blocks = [md5(Buffer.from('a')), md5(Buffer.from('b'))];
  const pre = buildPrecreateForm({ path: `${APP_ROOT}x.bin`, blockList: blocks });
  assert.equal(pre.get('autoinit'), '1');
  assert.deepEqual(JSON.parse(pre.get('block_list')), blocks);
  const create = buildCreateForm({ path: `${APP_ROOT}x.bin`, size: 42, uploadid: 'U1', blockList: blocks });
  assert.equal(create.get('rtype'), '1');
  assert.equal(create.get('size'), '42');
  assert.throws(() => buildCreateForm({ path: `${APP_ROOT}x.bin`, size: 1, uploadid: 'U', blockList: blocks, rtype: 3 }), /TERABOX_DESTRUCTIVE_BLOCKED/);
  assert.throws(() => buildPrecreateForm({ path: `${APP_ROOT}x.bin`, blockList: [] }), /TERABOX_EMPTY_BLOCK_LIST/);
});

await test('superfile2: app_id ثابت ۲۵۰۵۲۸، دامنهٔ آپلود جدا، partseq', () => {
  const url = new URL(buildSuperfile2Url({ accessToken: 'TOKEN', uploadDomain: 'c-jp.terabox.com',
    path: `${APP_ROOT}x.bin`, uploadid: 'U1', partseq: 2 }));
  assert.equal(url.hostname, 'c-jp.terabox.com');
  assert.equal(url.pathname, '/rest/2.0/pcs/superfile2');
  assert.equal(url.searchParams.get('method'), 'upload');
  assert.equal(url.searchParams.get('app_id'), String(APP_ID_FIXED));
  assert.equal(url.searchParams.get('partseq'), '2');
  assert.equal(url.searchParams.get('access_tokens'), 'TOKEN');
  const l = new URL(buildListUrl({ accessToken: 'TOKEN', dir: APP_ROOT, num: 100 }));
  assert.equal(l.searchParams.get('dir'), APP_ROOT);
  const d = new URL(buildDownloadUrl({ accessToken: 'TOKEN', fidlist: [934526256472844] }));
  assert.equal(d.searchParams.get('type'), 'dlink');
});

await test('هیچ حذف/بازنویسی/ریستی ساخته نمیشود', () => {
  assert.deepEqual(FORBIDDEN_OPERATIONS.includes('DELETE'), true);
  assert.equal(assertNoDestructive({ method: 'GET', url: 'https://www.terabox.com/openapi/api/list' }), true);
  assert.throws(() => assertNoDestructive({ method: 'DELETE' }), /TERABOX_DESTRUCTIVE_BLOCKED/);
  assert.throws(() => assertNoDestructive({ method: 'PATCH' }), /TERABOX_DESTRUCTIVE_BLOCKED/);
  assert.throws(() => assertNoDestructive({ method: 'POST', url: 'https://x/?opera=delete' }), /TERABOX_DESTRUCTIVE_BLOCKED/);
  assert.throws(() => assertNoDestructive({ method: 'POST', url: 'https://x/?rtype=3' }), /TERABOX_DESTRUCTIVE_BLOCKED/);
});

await test('redact توکنها، sign، client_secret و کوکی را پنهان میکند', () => {
  const s = 'https://www.terabox.com/openapi/api/quota?access_tokens=SECRET_TOKEN&client_secret=SECRET_CS&sign=ABC';
  const out = redact(s);
  assert.equal(out.includes('SECRET_TOKEN'), false);
  assert.equal(out.includes('SECRET_CS'), false);
  assert.equal(out.includes('sign=ABC'), false);
  assert.equal(out.includes('__REDACTED__'), true);
  assert.equal(redact('Cookie: ndus=REAL_COOKIE; lang=en').includes('REAL_COOKIE'), false);
});

await test('دو حساب کاملاً جدا؛ توکنها در describe افشا نمیشوند', () => {
  const reg = new TeraboxAccounts({ now: () => 1_700_000_000_000, appRoot: APP_ROOT });
  const a = reg.register({ label: 'a', accessToken: 'TOKEN_A', refreshToken: 'REFRESH_A',
    apiDomain: 'www.terabox.com', uploadDomain: 'c-jp.terabox.com', userId: 111 });
  const b = reg.register({ label: 'b', accessToken: 'TOKEN_B', refreshToken: 'REFRESH_B',
    apiDomain: 'www.terabox.app', uploadDomain: 'c-all.terabox.com', userId: 222 });
  assert.equal(MAX_ACCOUNTS, 2);
  assert.equal(reg.assertIsolated(), true);
  assert.equal(reg.describe().registered, 2);
  assert.equal(reg.describe().quotaPooling, false);
  assert.equal(reg.describe().isolated, true);
  assert.notEqual(a.accessTokenFingerprint, b.accessTokenFingerprint);
  assert.equal(JSON.stringify(reg.describe()).includes('TOKEN_A'), false);
  assert.equal(reg.tokenFor('a'), 'TOKEN_A');
  assert.throws(() => reg.register({ label: 'c', accessToken: 'C', refreshToken: 'R' }), /TERABOX_TOO_MANY_ACCOUNTS/);
  assert.throws(() => reg.register({ label: 'b', accessToken: 'TOKEN_A', refreshToken: 'OTHER' }), /TERABOX_DUPLICATE_LABEL/);
});

await test('refresh یکبارمصرف است و توکن قدیمی ۱۵ ثانیه فرصت دارد', () => {
  let now = 1_700_000_000_000;
  const reg = new TeraboxAccounts({ now: () => now });
  reg.register({ label: 'a', accessToken: 'T1', refreshToken: 'R1', userId: 1 });
  const used = 'R1';
  const v = reg.applyRefresh('a', { usedRefreshToken: used, accessToken: 'T2', refreshToken: 'R2',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS });
  assert.equal(v.accessTokenFingerprint, sha('T2').slice(0, 8));
  assert.equal(reg.get('a').accessToken, 'T2');
  assert.equal(reg.get('a').previousAccessTokenValidUntil, now + 15_000);
  assert.throws(() => reg.applyRefresh('a', { usedRefreshToken: used, accessToken: 'T3', refreshToken: 'R3' }),
    /TERABOX_REFRESH_TOKEN_ALREADY_USED/);
  assert.throws(() => reg.applyRefresh('a', { usedRefreshToken: 'WRONG', accessToken: 'T3', refreshToken: 'R3' }),
    /TERABOX_REFRESH_TOKEN_MISMATCH/);
  now += ACCESS_TOKEN_TTL_SECONDS * 1000 + 1;
  assert.equal(reg.needsRefresh('a'), true);
  assert.throws(() => reg.tokenFor('a'), /TERABOX_ACCESS_TOKEN_EXPIRED/);
});

await test('بدون کلید اپ، ترانسپورت صفر تماس شبکهای میزند و خطای صریح میدهد', async () => {
  const t = TeraboxTransport.fromEnv({});
  const d = t.describe();
  assert.equal(d.mode, 'official-open-platform');
  assert.equal(d.credentialsSupplied, false);
  assert.equal(d.credentialsInSource, false);
  assert.equal(d.networkCalls, 0);
  assert.equal(d.deleteCalled, false);
  assert.equal(ENV_KEYS.clientSecret, 'MC_TERABOX_CLIENT_SECRET');
  await assert.rejects(() => t.quota({ accessToken: 'X' }), /TERABOX_NO_APP_CREDENTIALS/);
  await assert.rejects(() => t.precreate({ accessToken: 'X', path: APP_ROOT, blockList: ['x'] }),
    /TERABOX_NO_APP_CREDENTIALS/);
  assert.equal(t.networkCalls, 0);
  assert.throws(() => t.deleteFile(), /TERABOX_DESTRUCTIVE_BLOCKED/);
});

await test('fixture همان خطاهای زندهٔ سرور را برمیگرداند', async () => {
  const t = new FixtureTerabox();
  const invalid = parseErrno(await t.deviceCode({ clientId: 'ARENA_INVALID_TEST_ONLY' }));
  assert.equal(invalid.errno, 100001);
  assert.equal(invalid.show_msg, 'unknown client');
  const badToken = parseErrno(await t.tokenInfo({ accessToken: 'ARENA_INVALID_TEST_ONLY' }));
  assert.equal(badToken.errno, 200002);
  assert.equal(t.describe().networkCalls, 0);
  assert.equal(t.describe().credentialsSupplied, false);
  const dev = parseErrno(await t.deviceCode({ clientId: 'FIXTURE_CLIENT_ID' }));
  assert.equal(dev.data.device_code, 'FIXTURE_DEVICE_CODE');
});

await test('دو حساب fixture توکن و دامنهٔ مستقل میگیرند', async () => {
  const t = new FixtureTerabox();
  const reg = new TeraboxAccounts({ now: () => 1_700_000_000_000, appRoot: APP_ROOT });
  for (const [label, code] of [['account-a', 'fixture-device-acct-a'], ['account-b', 'fixture-device-acct-b']]) {
    const tok = parseErrno(await t.getToken({ code, grantType: 'device_code', timestamp: TS }));
    assert.equal(tok.ok, true);
    const info = parseErrno(await t.tokenInfo({ accessToken: tok.data.access_token }));
    assert.equal(info.ok, true);
    reg.register({ label, accessToken: tok.data.access_token, refreshToken: tok.data.refresh_token,
      expiresIn: tok.data.expires_in, apiDomain: info.data.api_domain,
      uploadDomain: info.data.upload_domain, userId: info.data.user_id, createdAt: 1_700_000_000_000 });
    const quota = parseErrno(await t.quota({ accessToken: tok.data.access_token, apiDomain: info.data.api_domain }));
    assert.equal(quota.ok, true);
    assert.equal(quota.raw.total, 1024 * 1024 * 1024 * 1024);
  }
  assert.equal(reg.assertIsolated(), true);
  assert.notEqual(reg.get('account-a').apiDomain, reg.get('account-b').apiDomain);
  assert.notEqual(reg.get('account-a').userId, reg.get('account-b').userId);
});

await test('آپلود سهمرحلهای fixture، برگشت موبرهمو + SHA، صفر حذف', async () => {
  const t = new FixtureTerabox();
  const plain = Buffer.from(randomBytes(64 * 1024));
  const blocks = [md5(plain)];
  const p = `${APP_ROOT}000001.mcb1`;
  const pre = parseErrno(await t.precreate({ accessToken: 'FIXTURE_ACCESS_A', path: p, blockList: blocks }));
  assert.equal(pre.ok, true);
  const uploadid = pre.raw.uploadid;
  const shard = await t.uploadShard({ accessToken: 'FIXTURE_ACCESS_A', path: p, uploadid, partseq: 0, bytes: plain });
  assert.equal(shard.md5, blocks[0]);
  const created = parseErrno(await t.createFile({ accessToken: 'FIXTURE_ACCESS_A', path: p,
    size: plain.length, uploadid, blockList: blocks }));
  assert.equal(created.ok, true);
  const back = t.readFile(created.raw.fs_id);
  assert.equal(Buffer.compare(back, plain), 0);
  assert.equal(sha(back), sha(plain));
  const links = parseErrno(await t.downloadLink({ accessToken: 'FIXTURE_ACCESS_A', fidlist: [created.raw.fs_id] }));
  assert.equal(links.ok, true);
  const listed = parseErrno(await t.list({ accessToken: 'FIXTURE_ACCESS_A', dir: APP_ROOT }));
  assert.equal(listed.raw.list.length, 1);
  assert.equal(t.describe().deleteCalled, false);
  assert.equal(t.describe().networkCalls, 0);
  assert.throws(() => t.deleteFile(), /TERABOX_DESTRUCTIVE_BLOCKED/);
});

await test('refresh در fixture چرخش توکن میدهد و دوبار مصرف رد میشود', async () => {
  const t = new FixtureTerabox();
  const reg = new TeraboxAccounts({ now: () => 1_700_000_000_000 });
  reg.register({ label: 'a', accessToken: 'FIXTURE_ACCESS_A', refreshToken: 'FIXTURE_REFRESH_A_1' });
  const r1 = parseErrno(await t.refreshToken({ refreshToken: 'FIXTURE_REFRESH_A_1', timestamp: TS }));
  assert.equal(r1.ok, true);
  reg.applyRefresh('a', { usedRefreshToken: 'FIXTURE_REFRESH_A_1',
    accessToken: r1.data.access_token, refreshToken: r1.data.refresh_token, expiresIn: r1.data.expires_in });
  assert.equal(reg.get('a').accessToken, 'FIXTURE_ACCESS_A_R1');
  const r2 = parseErrno(await t.refreshToken({ refreshToken: 'FIXTURE_REFRESH_A_2', timestamp: TS + 1 }));
  assert.equal(r2.ok, true);
  assert.equal(r2.data.refresh_token, 'FIXTURE_REFRESH_A_3');
});

await test('سورس ماژول هیچ راز/کوکی/کلید مثال رسمی ندارد و فقط env خوانده میشود', () => {
  const files = ['openplatform.mjs', 'accounts.mjs', 'transport.mjs', 'cli.mjs'];
  const joined = files.map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  assert.equal(/client_secret\s*[:=]\s*['"][A-Za-z0-9]{16,}['"]/.test(joined), false,
    'هیچ مقدار ثابت client_secret نباید داخل سورس باشد');
  assert.equal(joined.includes('ndus=Y'), false, 'هیچ کوکی واقعی/مثال جلسهای نباید باشد');
  assert.equal(joined.includes('ARENA_INVALID_TEST_ONLY'), true);
  const openplatform = fs.readFileSync(path.join(ROOT, 'openplatform.mjs'), 'utf8');
  assert.equal(openplatform.includes('process.env'), false);
  const doc = fs.readFileSync(REPO_DOCS, 'utf8');
  assert.equal(doc.includes('circumvent storage space limits'), true);
  assert.equal(doc.includes('هیچ لاگین واقعی'), true);
  assert.equal(doc.includes('self-serve'), true);
  assert.equal(doc.includes('client_id'), true);
  assert.equal(doc.includes('100001'), true);
});

console.log(`\n${passed} تست TeraBox Open Platform سبز شد (کاملاً آفلاین، بدون حساب و بدون کلید اپ).`);
