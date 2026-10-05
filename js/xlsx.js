/**
 * xlsx.js — 零依賴的 .xlsx / .csv 讀取器
 * ---------------------------------------------------------------------------
 * 為什麼自己寫而不用 SheetJS：
 *   1. 不需要 CDN，離線可用（PWA 必須能離線）。
 *   2. 沒有第三方供應鏈風險；這支程式會讀取學生成績。
 *   3. 只需要讀取，不需要寫入／公式計算，實作範圍很小。
 *
 * .xlsx 本質上是一個 ZIP 檔，裡面裝著 XML：
 *   xl/workbook.xml          → 工作表清單與名稱
 *   xl/_rels/workbook.xml.rels → 工作表 rId 對應的實際檔名
 *   xl/sharedStrings.xml     → 共用字串表（文字都放這裡）
 *   xl/styles.xml            → 儲存格格式（用來判斷是不是日期）
 *   xl/worksheets/sheetN.xml → 實際的儲存格資料
 *
 * 解壓縮使用瀏覽器原生的 DecompressionStream('deflate-raw')，不需要純 JS 的 inflate。
 * 需求：Chrome / Edge 80+、Firefox 113+、Safari 16.4+
 */

const SIG_EOCD = 0x06054b50; // End of Central Directory
const SIG_CEN = 0x02014b50;  // Central Directory file header
const SIG_LOC = 0x04034b50;  // Local file header

/* ------------------------------------------------------------------ ZIP --- */

function findEOCD(view, len) {
  // 註解區最長 65535，所以最多往回找 65557 bytes
  const lowest = Math.max(0, len - 65557);
  for (let i = len - 22; i >= lowest; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

/**
 * 讀取 ZIP 的中央目錄，回傳「檔名 → 項目資訊」的 Map。
 * 只做 central directory 掃描，實際內容等到要用時才解壓（lazy）。
 */
function readCentralDirectory(view, bytes) {
  const len = bytes.length;
  const eocd = findEOCD(view, len);
  if (eocd < 0) {
    throw new Error('這個檔案不是有效的 .xlsx（找不到 ZIP 結尾標記）。如果是舊版 .xls 格式，請先用 Excel 另存為 .xlsx。');
  }

  let count = view.getUint16(eocd + 10, true);
  let cdOffset = view.getUint32(eocd + 16, true);

  // ZIP64：欄位被填成最大值時，真正的數值在 ZIP64 EOCD 裡
  if (cdOffset === 0xffffffff || count === 0xffff) {
    const locator = eocd - 20;
    if (locator >= 0 && view.getUint32(locator, true) === 0x07064b50) {
      const z64 = Number(view.getBigUint64(locator + 8, true));
      if (view.getUint32(z64, true) === 0x06064b50) {
        count = Number(view.getBigUint64(z64 + 32, true));
        cdOffset = Number(view.getBigUint64(z64 + 48, true));
      }
    }
  }

  const entries = new Map();
  let p = cdOffset;
  for (let i = 0; i < count && p + 46 <= len; i++) {
    if (view.getUint32(p, true) !== SIG_CEN) break;
    const method = view.getUint16(p + 10, true);
    let compSize = view.getUint32(p + 20, true);
    let uncompSize = view.getUint32(p + 24, true);
    const nameLen = view.getUint16(p + 28, true);
    const extraLen = view.getUint16(p + 30, true);
    const commentLen = view.getUint16(p + 32, true);
    const localOffset = view.getUint32(p + 42, true);
    const name = new TextDecoder('utf-8').decode(bytes.subarray(p + 46, p + 46 + nameLen));

    // ZIP64 擴充欄位（extra field header id = 0x0001）
    if (compSize === 0xffffffff || uncompSize === 0xffffffff || localOffset === 0xffffffff) {
      let e = p + 46 + nameLen;
      const end = e + extraLen;
      while (e + 4 <= end) {
        const id = view.getUint16(e, true);
        const sz = view.getUint16(e + 2, true);
        if (id === 0x0001) {
          let q = e + 4;
          if (uncompSize === 0xffffffff) { uncompSize = Number(view.getBigUint64(q, true)); q += 8; }
          if (compSize === 0xffffffff) { compSize = Number(view.getBigUint64(q, true)); q += 8; }
          if (localOffset === 0xffffffff) { localOffset = Number(view.getBigUint64(q, true)); q += 8; }
          break;
        }
        e += 4 + sz;
      }
    }

    entries.set(name, { name, method, compSize, uncompSize, localOffset });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return { entries, count };
}

function lookup(entries, name) {
  if (entries.has(name)) return entries.get(name);
  // 有些產生器大小寫不一致，做一次便宜的後備搜尋
  const lower = name.toLowerCase();
  for (const [k, v] of entries) if (k.toLowerCase() === lower) return v;
  return null;
}

async function inflateRaw(bytes) {
  if (typeof DecompressionStream !== 'function') {
    throw new Error('此瀏覽器不支援 DecompressionStream，無法解壓 .xlsx。請改用新版 Chrome、Edge、Firefox 或 Safari。');
  }
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** 取出 ZIP 中某個檔案並解壓成 Uint8Array；不存在則回傳 null。 */
async function readEntry(zip, name) {
  const e = lookup(zip.entries, name);
  if (!e) return null;
  const { view, bytes } = zip;

  if (view.getUint32(e.localOffset, true) !== SIG_LOC) {
    throw new Error(`ZIP 內的檔案標頭毀損：${name}`);
  }
  const nameLen = view.getUint16(e.localOffset + 26, true);
  const extraLen = view.getUint16(e.localOffset + 28, true);
  const start = e.localOffset + 30 + nameLen + extraLen;
  const comp = bytes.subarray(start, start + e.compSize);

  if (e.method === 0) return comp;            // stored（未壓縮）
  if (e.method === 8) return await inflateRaw(comp); // deflate
  throw new Error(`不支援的 ZIP 壓縮方式（method=${e.method}）：${name}`);
}

/** 取出 ZIP 中的 XML 並解析成 DOM；不存在則回傳 null。 */
async function readXml(zip, name) {
  const raw = await readEntry(zip, name);
  if (!raw) return null;
  const text = new TextDecoder('utf-8').decode(raw);
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  const err = doc.getElementsByTagName('parsererror')[0];
  if (err) throw new Error(`XML 解析失敗（${name}）：${err.textContent.slice(0, 200)}`);
  return doc;
}

/* ------------------------------------------------------------------ XML --- */

/** 取得所有指定 localName 的子元素（忽略命名空間前綴）。 */
function kids(el, localName) {
  const out = [];
  for (const n of el.childNodes) {
    if (n.nodeType === 1 && n.localName === localName) out.push(n);
  }
  return out;
}

/** 共用字串 <si> 轉文字：串接所有 <t>，但排除 <rPh> 注音區。 */
function siText(si) {
  let s = '';
  for (const t of si.getElementsByTagNameNS('*', 't')) {
    let p = t.parentNode;
    let skip = false;
    while (p && p.localName !== 'si') {
      if (p.localName === 'rPh') { skip = true; break; }
      p = p.parentNode;
    }
    if (!skip) s += t.textContent;
  }
  return s;
}

/** 把 "BC12" 這種參照轉成 0 起始的欄索引。 */
function colIndexByRef(ref) {
  let n = 0;
  for (let i = 0; i < ref.length; i++) {
    const c = ref.charCodeAt(i);
    if (c >= 65 && c <= 90) n = n * 26 + (c - 64);
    else if (c >= 97 && c <= 122) n = n * 26 + (c - 96);
    else break;
  }
  return n - 1;
}

/* -------------------------------------------------------------- 日期格式 --- */

// Excel 內建的日期／時間 numFmtId
const BUILTIN_DATE_FMT = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);

/** 解析 styles.xml → 每個 cellXfs 索引是否為日期格式。 */
function readDateStyles(stylesDoc) {
  const isDate = [];
  if (!stylesDoc) return isDate;

  const custom = new Map();
  const numFmtsEl = stylesDoc.getElementsByTagNameNS('*', 'numFmts')[0];
  if (numFmtsEl) {
    for (const nf of kids(numFmtsEl, 'numFmt')) {
      const id = parseInt(nf.getAttribute('numFmtId') || '', 10);
      const code = nf.getAttribute('formatCode') || '';
      // 去掉顏色／條件等中括號段落再判斷，避免 [Red] 被誤認
      const cleaned = code.replace(/\[[^\]]*\]/g, '').replace(/"[^"]*"/g, '');
      const looksDate = /[ymdhs]/i.test(cleaned) && !/[#0?]/.test(cleaned.replace(/[ymdhs]/gi, ''));
      custom.set(id, looksDate || /^[ymdhs\-/. :]+$/i.test(cleaned));
    }
  }

  const cellXfsEl = stylesDoc.getElementsByTagNameNS('*', 'cellXfs')[0];
  if (cellXfsEl) {
    for (const xf of kids(cellXfsEl, 'xf')) {
      const id = parseInt(xf.getAttribute('numFmtId') || '0', 10);
      isDate.push(BUILTIN_DATE_FMT.has(id) || custom.get(id) === true);
    }
  }
  return isDate;
}

/** Excel 序列值 → 日期字串。 */
function serialToDate(serial, date1904) {
  const epochOffset = date1904 ? 24107 : 25569; // 1970-01-01 對應的序列值
  const ms = (serial - epochOffset) * 86400000;
  const d = new Date(Math.round(ms));
  if (Number.isNaN(d.getTime())) return String(serial);
  const p = (n) => String(n).padStart(2, '0');
  const date = `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())}`;
  const hasTime = Math.abs(serial - Math.floor(serial)) > 1e-9;
  return hasTime ? `${date} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}` : date;
}

/* -------------------------------------------------------------- 工作表 --- */

function cellValue(c, sharedStrings, dateStyles, date1904) {
  const t = c.getAttribute('t');

  if (t === 'inlineStr') {
    const is = kids(c, 'is')[0];
    return is ? siText(is) : '';
  }

  const v = kids(c, 'v')[0];
  if (!v) return '';
  const raw = v.textContent;

  if (t === 's') {
    const i = parseInt(raw, 10);
    return sharedStrings[i] !== undefined ? sharedStrings[i] : '';
  }
  if (t === 'b') return raw === '1';
  if (t === 'e') return raw;    // #DIV/0! 之類
  if (t === 'str') return raw;  // 公式的字串結果
  if (t === 'd') return raw;    // ISO 8601 日期字串

  const n = Number(raw);
  if (!Number.isFinite(n)) return raw;

  // 數值：若套用日期格式就轉成可讀日期
  const s = c.getAttribute('s');
  if (s !== null && dateStyles && dateStyles[parseInt(s, 10)]) {
    return serialToDate(n, date1904);
  }
  return n;
}

function parseSheetRows(sheetDoc, sharedStrings, dateStyles, date1904) {
  const rows = [];
  let autoRow = 0;

  for (const rowEl of sheetDoc.getElementsByTagNameNS('*', 'row')) {
    const rAttr = parseInt(rowEl.getAttribute('r') || '', 10);
    const rowIdx = Number.isFinite(rAttr) && rAttr > 0 ? rAttr - 1 : autoRow;
    autoRow = rowIdx + 1;

    const cells = [];
    let autoCol = 0;
    for (const c of kids(rowEl, 'c')) {
      const ref = c.getAttribute('r');
      let ci = ref ? colIndexByRef(ref) : autoCol;
      if (ci < 0) ci = autoCol;
      autoCol = ci + 1;
      cells[ci] = cellValue(c, sharedStrings, dateStyles, date1904);
    }
    rows[rowIdx] = cells;
  }

  // 補齊稀疏陣列，讓 rows 是完整的 2D 陣列
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i]) { rows[i] = []; continue; }
    for (let j = 0; j < rows[i].length; j++) {
      if (rows[i][j] === undefined) rows[i][j] = '';
    }
  }
  return rows;
}

/** 讀取合併儲存格，並把左上角的值填滿整個合併範圍（對標題列辨識很重要）。 */
function applyMerges(rows, sheetDoc) {
  const merges = [];
  for (const mc of sheetDoc.getElementsByTagNameNS('*', 'mergeCell')) {
    const ref = mc.getAttribute('ref') || '';
    const m = /^([A-Za-z]+)(\d+):([A-Za-z]+)(\d+)$/.exec(ref);
    if (!m) continue;
    const c1 = colIndexByRef(m[1]);
    const r1 = parseInt(m[2], 10) - 1;
    const c2 = colIndexByRef(m[3]);
    const r2 = parseInt(m[4], 10) - 1;
    merges.push({ r1, c1, r2, c2 });

    const v = rows[r1] ? rows[r1][c1] : undefined;
    if (v === undefined || v === '') continue;
    for (let r = r1; r <= r2; r++) {
      if (!rows[r]) rows[r] = [];
      for (let c = c1; c <= c2; c++) {
        if (rows[r][c] === undefined || rows[r][c] === '') rows[r][c] = v;
      }
    }
  }
  return merges;
}

/* ------------------------------------------------------------- 對外介面 --- */

/**
 * 讀取 .xlsx 檔。
 * @param {ArrayBuffer} arrayBuffer
 * @returns {Promise<{sheets: Array<{name:string, rows:Array<Array<any>>, merges:Array}>}>}
 */
export async function readXlsx(arrayBuffer) {
  if (!arrayBuffer || arrayBuffer.byteLength === 0) throw new Error('檔案是空的。');

  const bytes = new Uint8Array(arrayBuffer);
  // ZIP 檔開頭必須是 PK\x03\x04
  if (!(bytes[0] === 0x50 && bytes[1] === 0x4b)) {
    if (bytes[0] === 0xd0 && bytes[1] === 0xcf) {
      throw new Error('這是舊版 .xls 格式，本程式只支援 .xlsx。請用 Excel 開啟後「另存新檔」為 .xlsx。');
    }
    throw new Error('這不是有效的 .xlsx 檔（缺少 ZIP 標記）。');
  }

  const view = new DataView(arrayBuffer);
  const zip = { view, bytes, ...readCentralDirectory(view, bytes) };

  // 共用字串
  const sstDoc = await readXml(zip, 'xl/sharedStrings.xml');
  const sharedStrings = [];
  if (sstDoc) {
    for (const si of sstDoc.getElementsByTagNameNS('*', 'si')) {
      sharedStrings.push(siText(si));
    }
  }

  // 日期格式
  const stylesDoc = await readXml(zip, 'xl/styles.xml');
  const dateStyles = readDateStyles(stylesDoc);

  // 1904 日期系統（Mac 版 Excel 產生的檔案）
  const wbDoc = await readXml(zip, 'xl/workbook.xml');
  let date1904 = false;
  if (wbDoc) {
    const pr = wbDoc.getElementsByTagNameNS('*', 'workbookPr')[0];
    if (pr) date1904 = pr.getAttribute('date1904') === '1' || pr.getAttribute('date1904') === 'true';
  }

  // 工作表清單：名稱 + rId
  const sheets = [];
  if (wbDoc) {
    const relsDoc = await readXml(zip, 'xl/_rels/workbook.xml.rels');
    const relTarget = new Map();
    if (relsDoc) {
      for (const rel of relsDoc.getElementsByTagNameNS('*', 'Relationship')) {
        relTarget.set(rel.getAttribute('Id'), rel.getAttribute('Target'));
      }
    }
    const sheetsEl = wbDoc.getElementsByTagNameNS('*', 'sheets')[0];
    if (sheetsEl) {
      for (const sh of kids(sheetsEl, 'sheet')) {
        const rid = sh.getAttribute('r:id') || sh.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
        let target = rid && relTarget.get(rid);
        if (!target) continue;
        // Target 可能是 "worksheets/sheet1.xml" 或 "/xl/worksheets/sheet1.xml"
        if (target.startsWith('/')) target = target.slice(1);
        else target = 'xl/' + target.replace(/^\.\//, '');
        sheets.push({ name: sh.getAttribute('name') || `Sheet${sheets.length + 1}`, path: target });
      }
    }
  }

  // 後備：workbook.xml 讀不到時，直接掃 worksheets
  if (sheets.length === 0) {
    for (const [name] of zip.entries) {
      if (/^xl\/worksheets\/sheet\d*\.xml$/i.test(name)) {
        sheets.push({ name: name.replace(/^.*\//, '').replace(/\.xml$/i, ''), path: name });
      }
    }
    sheets.sort((a, b) => a.path.localeCompare(b.path, undefined, { numeric: true }));
  }

  const out = [];
  for (const sh of sheets) {
    const doc = await readXml(zip, sh.path);
    if (!doc) continue;
    const rows = parseSheetRows(doc, sharedStrings, dateStyles, date1904);
    const merges = applyMerges(rows, doc);
    out.push({ name: sh.name, rows, merges });
  }

  if (out.length === 0) throw new Error('在 .xlsx 裡找不到任何工作表。');
  return { sheets: out };
}

/* ------------------------------------------------------------------ CSV --- */

/**
 * 解析 CSV 文字（支援雙引號包覆、跳脫雙引號、CRLF，並自動偵測分隔符）。
 * @param {string} text
 * @returns {Array<Array<string|number>>}
 */
export function parseCsv(text) {
  // 去掉 BOM
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);

  const firstLine = text.slice(0, text.indexOf('\n') === -1 ? text.length : text.indexOf('\n'));
  const delim = [',', ';', '\t'].reduce((best, d) =>
    firstLine.split(d).length > firstLine.split(best).length ? d : best, ',');

  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += ch;
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === delim) {
      row.push(field); field = '';
    } else if (ch === '\n') {
      row.push(field); field = '';
      rows.push(row); row = [];
    } else if (ch === '\r') {
      // 忽略，\n 會處理換行
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }

  // 嘗試把數字欄位轉成 number，讓後續與 xlsx 的處理一致
  return rows.map((r) => r.map((v) => {
    if (typeof v !== 'string') return v;
    const s = v.trim();
    if (s === '') return '';
    if (/^-?\d+(\.\d+)?$/.test(s)) {
      const n = Number(s);
      // 避免把學號 "20230101" 之類的長整數變成浮點誤差（Number 對整數是安全的）
      return Number.isFinite(n) ? n : v;
    }
    return v;
  }));
}

/**
 * 讀取任何支援的表格檔（.xlsx / .xlsm / .csv）。
 * @param {File} file
 * @returns {Promise<{sheets: Array<{name:string, rows:Array<Array<any>>, merges:Array}>}>}
 */
export async function readTableFile(file) {
  const name = (file.name || '').toLowerCase();

  if (name.endsWith('.csv') || name.endsWith('.txt')) {
    const text = await file.text();
    return { sheets: [{ name: file.name.replace(/\.[^.]+$/, ''), rows: parseCsv(text), merges: [] }] };
  }

  if (name.endsWith('.xls') && !name.endsWith('.xlsx') && !name.endsWith('.xlsm')) {
    throw new Error(`「${file.name}」是舊版 .xls 格式。請用 Excel 開啟後另存為 .xlsx。`);
  }

  const buf = await file.arrayBuffer();
  return await readXlsx(buf);
}
