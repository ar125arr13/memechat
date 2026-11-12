/* شبیهساز کاملاً آفلاین IAS3 — همان رابط put/get/list، بدون شبکه و بدون کلید حساب.
 * فقط برای تست؛ هیچ تماسی با Internet Archive برقرار نمیکند. */

export class FixtureIas3 {
  constructor({ item = 'memechat-second-db' } = {}) {
    this.item = item;
    this.files = new Map();       // filename → Buffer
    this.calls = [];
    this.firstUploadDone = false;
    this.failNextPut = null;
  }

  describe() {
    return {
      mode: 'fixture', item: this.item, officialApi: false,
      credentialsSupplied: false, encryptionKeyInSource: true,
      accountKeysInSource: false, destructiveOperations: [],
      deleteCalled: false, vercelUsed: false, deployed: false,
    };
  }

  async put(filename, bytes) {
    this.calls.push({ method: 'PUT', filename, bytes: bytes.length });
    if (this.failNextPut) {
      const e = this.failNextPut;
      this.failNextPut = null;
      throw e;
    }
    this.files.set(filename, Buffer.from(bytes));
    this.firstUploadDone = true;
    return { ok: true, status: 200, filename, bytes: bytes.length, deleted: false };
  }

  async get(filename) {
    this.calls.push({ method: 'GET', filename });
    const b = this.files.get(filename);
    if (!b) return { ok: false, status: 404, bytes: Buffer.alloc(0) };
    return { ok: true, status: 200, filename, bytes: Buffer.from(b) };
  }

  /* دقیقاً همان شکلی که GET واقعی https://archive.org/metadata/stats برگرداند:
   * { files: [ { name, source, size, md5, crc32, sha1, format }, ... ] } */
  async list(prefix = 'mcia/') {
    this.calls.push({ method: 'GET-METADATA', prefix });
    const files = [...this.files.entries()]
      .filter(([name]) => name.startsWith(prefix))
      .map(([name, b]) => ({
        name, source: 'original', size: String(b.length),
        md5: 'fixture', sha1: 'fixture', format: 'Unknown',
      }));
    // فایلهای خودکار IA (مثل _meta.xml / derive) عمداً اضافه میشوند تا
    // parseMetadataFiles ثابت کند که آنها را نادیده میگیریم، نه حذف میکنیم.
    files.push({ name: `${this.item}_meta.xml`, source: 'metadata', size: '10', format: 'Metadata' });
    return this._parse(files, prefix);
  }

  _parse(files, prefix) {
    // از همان تابع رسمی استفاده میشود تا رفتار فیلتر تست شود.
    return import('./ias3.mjs').then(({ parseMetadataFiles }) =>
      parseMetadataFiles({ files }, { prefix }));
  }

  async checkLimit() { return { overLimit: false, detail: 'fixture' }; }
}

export default FixtureIas3;
