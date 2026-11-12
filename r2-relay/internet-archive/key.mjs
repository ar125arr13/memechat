/* MemeChat — کلید رمزگذاری مسیر «دیتابیس دوم → Internet Archive».
 *
 * ⚠️ درخواست صریح صاحب پروژه: «رمز گزاری متفاوت و کلیدش توی سورس کدها باشه
 *    فقط». یعنی کلید فقط و فقط اینجاست؛ نه env، نه derive از passphrase،
 *    نه ورودی runtime، نه چت، نه تنظیمات، نه از کسی پرسیده شود.
 *
 * ⚠️⚠️ هشدار امنیتی صادقانه (حتماً بخوانید):
 *    مخزن GitHub این پروژه **عمومی** است (`private=false`) و PR آن باز است.
 *    بنابراین این کلید، یک «راز» نیست: هر کسی که مخزن را ببیند آن را دارد.
 *    آیتمهای Internet Archive هم **عمومی** و «World readable» هستند
 *    (سند رسمی IAS3: «ACLs are fake. permissions are: World readable,
 *    Item uploader writable»). پس این رمزگذاری **محرمانگی نمیدهد**؛ فقط:
 *      - تمامیت (Poly1305 tag: دستکاری/خرابی مشخص میشود)،
 *      - قالببندی و جداسازی بستهها،
 *      - وابستگی هر بسته به item/filename/batchId از طریق AAD.
 *    اگر روزی محرمانگی واقعی لازم شد، کلید باید بیرون از مخزن باشد — ولی
 *    آن کار خلاف دستور فعلی («فقط توی سورس») است، پس انجام نشد.
 *
 *    جدا کردن «کلید رمزگذاری» از «کلید حساب IA» مهم است:
 *      - همین فایل = کلید رمزگذاری، داخل سورس (درخواست کاربر).
 *      - IAS3 access/secret = کلید حساب کاربر، **هرگز داخل سورس نیست**؛
 *        فقط موقع اجرا از محیط خوانده میشود و الان اصلاً وجود ندارد.
 *        گذاشتنش تو مخزن عمومی یعنی هرکس بتواند آیتمهایتان را تغییر دهد
 *        یا حذف کند. بهخاطر «صفر حذف» هم هیچ DELETEای صدا زده نمیشود.
 *
 * کلید ۳۲ بایتی (۲۵۶ بیت) برای ChaCha20-Poly1305. ثابت و غیرقابلتغییر
 * است تا بستههای قدیمی همچنان قابلخواندن بمانند (هیچ دادهای ریست نشود).
 */

import { createHash } from 'node:crypto';

export const KEY_HEX = '5c7cdb168e2a53f8c01c890b38bae695c0984c54854e72ba4448a32ac69a0d47';

export const KEY_SOURCE = 'source-code';
export const KEY_ALGORITHM = 'ChaCha20-Poly1305';
export const KEY_BYTES = 32;

export function sourceKeyBytes() {
  const b = Buffer.from(KEY_HEX, 'hex');
  if (b.length !== KEY_BYTES) throw new Error('IA_SOURCE_KEY_INVALID');
  return b;
}

/* فقط اثرانگشت کلید، نه خودش — برای لاگ/وضعیت امن. */
export function keyFingerprint() {
  return createHash('sha256').update(KEY_HEX, 'utf8').digest('hex').slice(0, 16);
}

export default sourceKeyBytes;
