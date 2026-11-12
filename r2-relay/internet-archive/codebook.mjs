/* MemeChat — «کدبوک واژگان»: تبدیل هر بایت به یک کلمهٔ فارسی.
 *
 * درخواست صاحب پروژه: «یه کلید رمز گزاری بسازیم که کلمات رو تبدیل کنن به
 * یه کلمه دیگه؟ اینجوری میشه readable».
 *
 * صداقت فنی (مهم — لطفاً «رمزگذاری امن» برداشت نشود):
 *   - این یک **substitution / codebook cipher** است، نه الگوریتم رمزگذاری
 *     مدرن. بهتنهایی در برابر فرکانسگیری و حملهٔ متنآشنا ضعیف است.
 *   - «کلید» اینجا = یک **جایگشت (permutation) ۲۵۶تایی** از واژهنامه که
 *     بهصورت قطعی از همان کلید داخل سورس (`key.mjs`) ساخته میشود. پس مثل
 *     خود آن کلید، **عمومی** است (مخزن `private=false`).
 *   - آیتمهای Internet Archive هم «World readable»اند. نتیجه: خروجی
 *     **قابلخواندن** است، ولی **محرمانه نیست**. ادعای امنیت نمیکنیم.
 *   - بههمیندلیل این لایه **جایگزین** ChaCha20-Poly1305 نشد؛ روی آن
 *     نشست. بستهٔ باینری MCIA1 همچنان ساخته میشود، سپس بایتهایش به
 *     واژه تبدیل میشوند. هنگام برگشت، دوباره باینری میشود و **tag Poly1305
 *     و AAD تأیید میشوند** — یعنی تمامیت از دست نمیرود.
 *
 * نکتهای که بهنفع ماست: چون ورودیِ این لایه خروجی ChaCha20 (تقریباً
 * یکنواخت) است، بسامد واژهها هم تقریباً یکنواخت میشود؛ فرکانسگیری ساده
 * روی کدبوک چیزی بهدست نمیدهد. ولی چون کلید عمومی است، همچنان محرمانگی صفر است.
 *
 * قالب متنی (فایل قابلخواندن روی IA):
 *   خط ۱:  MCRD1.<byteCount>.<sha256 بستهٔ باینری (۱۶ hex اول)>
 *   خط ۲+: واژهها، ۱۲ تا در هر خط، جدا شده با فاصله
 *
 * واژهنامه دقیقاً ۲۵۶ واژهٔ یکتای فارسی (بدون فاصله درون واژه) دارد؛
 * یعنی هر بایت ↔ دقیقاً یک کلمه. فقط داخل سورس است، مثل همان کلید.
 */

import { createHmac, createHash } from 'node:crypto';
import { KEY_HEX, KEY_SOURCE, keyFingerprint } from './key.mjs';

export const CODEBOOK_MAGIC = 'MCRD1';
export const WORDS_PER_LINE = 12;
export const WORD_COUNT = 256;
export const CODEBOOK_KIND = 'memechat-word-substitution-codebook';

/* ۲۵۶ واژهٔ یکتا. ترتیبش ثابت است تا بستههای قدیمی قابلخواندن بمانند. */
export const WORDLIST = Object.freeze((
  'آب باد خاک آتش ماه خورشید ستاره ابر باران برف تگرگ رعد صاعقه دریا رود چشمه چاه موج ساحل جزیره صخره ماسه گل سنگ کوه دره تپه دشت جنگل بیشه بوته درخت سرو کاج بید بلوط چنار صنوبر نارون افرا شمشاد برگ شاخه ریشه تنه میوه دانه تخم گلبرگ ریحان نعناع گندم جو برنج ذرت نخود لوبیا عدس سیب گلابی انگور انار خرما زردآلو آلو هلو پرتقال لیمو نارنگی توت بادام گردو فندق پسته کشمش قند نمک فلفل زردچوبه دارچین نان آرد شیر ماست پنیر کره عسل روغن گوشت مرغ بره گاو اسب شتر گوسفند بز خرگوش روباه گرگ پلنگ ببر خرس آهو گوزن سگ گربه موش پرنده کلاغ گنجشک کبوتر عقاب شاهین جغد طاووس بلبل قناری پروانه زنبور مور مگس پشه سوسک کرم مار لاکپشت قورباغه نهنگ دلفین خرچنگ صدف حلزون ستون دیوار سقف پنجره پله راهرو حیاط بام ایوان اتاق آشپزخانه حمام کتاب دفتر قلم مداد کاغذ جوهر میز صندلی چراغ پرده فرش قالی بالش پتو لحاف ساعت آینه شانه صابون حوله لیوان کاسه بشقاب قاشق چنگال کارد قوری استکان سماور کتری دیگ تابه سفره قفل زنجیر جعبه صندوق کیف جیب کمربند کفش کلاه پیراهن شلوار پالتو دستکش جوراب دکمه نخ سوزن قیچی نوار چسب کمان تیر سپر شمشیر نیزه تبر چکش اره میخ پیچ فنر چرخ دنده موتور پمپ لوله سیم کابل باتری لامپ آهن مس برق طلا نقره برنز شیشه چوب کاه گچ آجر سیمان آسفالت پل جاده کوچه خیابان میدان ایستگاه قطار اتوبوس تاکسی دوچرخه کشتی قایق هواپیما چتر بادبادک توپ راکت تخته شطرنج مهره تاس کارت زنگ دف تار سنتور'
).split(' ').map((w) => w.trim()).filter(Boolean));

if (WORDLIST.length !== WORD_COUNT || new Set(WORDLIST).size !== WORD_COUNT) {
  throw new Error('IA_CODEBOOK_INVALID: واژهنامه باید دقیقاً ۲۵۶ واژهٔ یکتا باشد');
}

const WORD_INDEX = new Map(WORDLIST.map((w, i) => [w, i]));

/* جریان بایتهای شبهتصادفی قطعی از کلید سورس (HMAC-SHA256 در حالت شمارنده). */
function* keyStream(hex, label) {
  const key = Buffer.from(hex, 'hex');
  let counter = 0;
  while (true) {
    counter += 1;
    const block = createHmac('sha256', key)
      .update(label).update(':').update(String(counter)).digest();
    for (const b of block) yield b;
  }
}

/* الگوریتم Sattolo (گونهای از Fisher–Yates با j ∈ [0, i-1]) جایگشتی
 * میسازد که **هیچ نقطهٔ ثابتی ندارد**: perm[i] !== i برای همهٔ i.
 * یعنی هر کلمه حتماً به «یک کلمهٔ دیگر» تبدیل میشود، همانطور که خواسته شد؛
 * هیچوقت «خاک ← خاک» پیش نمیآید. نمونهگیری ۱۶بیتی بدون بایاس است. */
export function buildSubstitutionKey(keyHex = KEY_HEX) {
  const stream = keyStream(keyHex, 'memechat-codebook-v1');
  const nextByte = () => stream.next().value;
  const uniform = (n) => {
    const limit = 65536 - (65536 % n);
    for (;;) {
      const v = (nextByte() << 8) | nextByte();
      if (v < limit) return v % n;
    }
  };
  const perm = new Uint8Array(WORD_COUNT);
  for (let i = 0; i < WORD_COUNT; i++) perm[i] = i;
  for (let i = WORD_COUNT - 1; i > 0; i--) {
    const j = uniform(i);
    const t = perm[i]; perm[i] = perm[j]; perm[j] = t;
  }
  const inverse = new Uint8Array(WORD_COUNT);
  for (let i = 0; i < WORD_COUNT; i++) inverse[perm[i]] = i;
  return { perm, inverse };
}

export function describeCodebook() {
  return {
    kind: CODEBOOK_KIND,
    magic: CODEBOOK_MAGIC,
    wordCount: WORD_COUNT,
    wordsArePersian: true,
    keySource: KEY_SOURCE,
    keyFingerprint: keyFingerprint(),
    confidentiality: false,
    readable: true,
    integrityPreservedBy: 'ChaCha20-Poly1305 + AAD (لایهٔ زیرین)',
  };
}

/* باینری → متن قابلخواندن. */
export function encodeReadable(blob, { keyHex = KEY_HEX } = {}) {
  const bytes = Buffer.from(blob);
  const { perm } = buildSubstitutionKey(keyHex);
  const digest = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  const words = new Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) words[i] = WORDLIST[perm[bytes[i]]];
  const lines = [];
  for (let i = 0; i < words.length; i += WORDS_PER_LINE) {
    lines.push(words.slice(i, i + WORDS_PER_LINE).join(' '));
  }
  return `${CODEBOOK_MAGIC}.${bytes.length}.${digest}\n${lines.join('\n')}\n`;
}

/* متن قابلخواندن → باینری؛ هش و تعداد واژهها قبل از تحویل چک میشود. */
export function decodeReadable(text, { keyHex = KEY_HEX } = {}) {
  const raw = String(text ?? '').replace(/\r\n/g, '\n').trim();
  const nl = raw.indexOf('\n');
  if (nl < 0) throw new Error('IA_READABLE_NO_HEADER');
  const header = raw.slice(0, nl).split('.');
  if (header[0] !== CODEBOOK_MAGIC || header.length !== 3) {
    throw new Error('IA_READABLE_BAD_HEADER');
  }
  const byteCount = Number(header[1]);
  const digest = header[2];
  const tokens = raw.slice(nl + 1).split(/[\s]+/).filter(Boolean);
  if (!Number.isInteger(byteCount) || byteCount < 0 || tokens.length !== byteCount) {
    throw new Error('IA_READABLE_COUNT_MISMATCH');
  }
  const { inverse } = buildSubstitutionKey(keyHex);
  const out = Buffer.alloc(byteCount);
  for (let i = 0; i < byteCount; i++) {
    const idx = WORD_INDEX.get(tokens[i]);
    if (idx === undefined) throw new Error(`IA_READABLE_UNKNOWN_WORD:${tokens[i]}`);
    out[i] = inverse[idx];
  }
  if (createHash('sha256').update(out).digest('hex').slice(0, 16) !== digest) {
    throw new Error('IA_READABLE_HASH_MISMATCH');
  }
  return new Uint8Array(out);
}

/* آمار رک و صادقانه دربارهٔ هزینهٔ قابلخواندن شدن. */
export function readableStats(plainBytes, text) {
  const before = Buffer.byteLength(Buffer.from(plainBytes));
  const after = Buffer.byteLength(String(text), 'utf8');
  return {
    binaryBytes: before,
    readableBytes: after,
    expansionFactor: Number((after / Math.max(1, before)).toFixed(2)),
    note: 'قابلخواندن شدن حجم را چند برابر میکند؛ سقف ۱۰۰GB/آیتم IA زودتر تمام میشود',
  };
}

export function sampleSubstitution(count = 8, keyHex = KEY_HEX) {
  const { perm } = buildSubstitutionKey(keyHex);
  return Array.from({ length: Math.min(count, WORD_COUNT) }, (_, i) => ({
    byte: i,
    from: WORDLIST[i],
    to: WORDLIST[perm[i]],
  }));
}

export default encodeReadable;
