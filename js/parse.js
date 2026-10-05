/**
 * parse.js — 把「原始表格」變成「成績資料」
 * ---------------------------------------------------------------------------
 * 負責：
 *   1. 從資料夾路徑推導 學年 / 學段 / 班級 / 年級
 *   2. 在表格中自動尋找真正的標題列（容忍上面有合併的大標題）
 *   3. 判斷每一欄的角色：學號 / 姓名 / 科目 / 備註資訊 / 總分名次
 *   4. 抽取學生資料，正確處理缺考、空白、文字等級、0 分
 *
 * 設計原則：寧可寬鬆通過，也不要因為一個奇怪的欄位就整份檔案讀不進來。
 * 所有判斷結果都會附帶信心程度，讓 UI 可以提示使用者手動修正。
 */

/* --------------------------------------------------------- 欄位判斷規則 --- */

const RE_ID = /學號|學籍號|學籍|座號|班號|學生編號|學號碼|準考證|考生號/i;
const RE_NAME = /姓名|學生姓名|名字|名稱/i;

// 這些欄位「不是科目」，不應該被當成可排序的分數欄。
// 注意：文字欄位本來就會因為 numericRatio 過低而被歸類成 info，
// 所以這裡只需列出「看起來像數字、但其實不是成績」的欄位，避免誤判。
const RE_INFO = /操行|品行|德育|獎懲|獎勵|懲罰|警告|缺曠|缺席|遲到|早退|出勤|評語|備註|備注|導師|班主任|家長|電話|地址|電郵|email|性別|出生|生日|身份|身分|國籍|住址|聯絡|通訊|狀態/i;
const RE_DERIVED = /總分|總成績|總計|合計|平均|平均分|名次|排名|排位|等級|等第|標準分|z分數|t分數|百分等級|pr值/i;

// 缺考／無成績的寫法
const RE_ABSENT = /^(缺考|缺席|曠考|免修|未考|無|不適用|n\/?a|nil|null|--|-|—|–|\/|\*|x|X|Ｘ|請假|病假|事假)$/i;

/** 從字串中解析出分數；無法解析回傳 null。 */
export function parseScore(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (typeof v === 'boolean') return null;

  const s = String(v).trim();
  if (s === '') return null;
  if (RE_ABSENT.test(s)) return null;

  // 純數字（最常見的情況）
  if (/^-?\d+(\.\d+)?$/.test(s)) {
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  const m = /(-?\d+(?:\.\d+)?)/.exec(s);
  if (!m) return null;

  // 只有在「扣掉數字之後剩下的都是單位或標點」時才接受，
  // 例如 "85分"、"60(補考)"、"90 分"。
  // 這樣可以避免把日期 "2024-01-15" 誤讀成 2024 分。
  const rest = s
    .replace(m[1], '')
    .replace(/[\s分點点%％()（）\[\]【】,，。.、:：;/／\\|~～\-－+＋]/g, '');
  if (rest === '' || /^(grade|score|補考|重考|總分|級|等)$/i.test(rest)) {
    const n = Number(m[1]);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/* ----------------------------------------------------------- 路徑 → 資訊 --- */

// 常見的年級寫法
const GRADE_PATTERNS = [
  { re: /^(高[一二三])/, order: { 高一: 11, 高二: 12, 高三: 13 } },
  { re: /^(初[一二三])/, order: { 初一: 1, 初二: 2, 初三: 3 } },
  { re: /^(中[一二三四五六])/, order: { 中一: 1, 中二: 2, 中三: 3, 中四: 4, 中五: 5, 中六: 6 } },
  { re: /^(小[一二三四五六])/, order: { 小一: 1, 小二: 2, 小三: 3, 小四: 4, 小五: 5, 小六: 6 } },
  { re: /^([sS][1-6])/, order: { s1: 1, s2: 2, s3: 3, s4: 4, s5: 5, s6: 6 } },
  { re: /^([fF]\.?\s?[1-6])/, order: { f1: 1, f2: 2, f3: 3, f4: 4, f5: 5, f6: 6 } },
  { re: /^[Ff]orm\s*([1-6])/, order: null },
];

/** 從班級名稱取出年級，例如「高一A班」→「高一」。找不到回傳 ''。 */
export function gradeOf(className) {
  const s = String(className || '').trim();
  for (const g of GRADE_PATTERNS) {
    const m = g.re.exec(s);
    if (m) {
      // S1 / F1 / Form 1 統一顯示成 S1 / F1 / Form 1 的大寫形式
      let token = m[1] || m[0];
      token = token.replace(/\s+/g, '');
      if (/^[sf]\d$/i.test(token)) token = token.toUpperCase();
      if (/^[sf]\.?\d$/i.test(token)) token = token.toUpperCase().replace(/\./, '');
      return token;
    }
  }
  // 退而求其次：抓「數字 + 年級/級」或開頭的數字
  const m2 = /(\d+)\s*(?:年級|年|級)/.exec(s) || /^(\d+)/.exec(s);
  return m2 ? m2[1] : '';
}

/** 年級排序用：數字越小越前。 */
export function gradeOrder(grade) {
  const s = String(grade || '').trim();
  for (const g of GRADE_PATTERNS) {
    if (!g.order) continue;
    const key = s.toLowerCase().replace(/\./g, '');
    if (key in g.order) return g.order[key];
    const m = g.re.exec(s);
    if (m) {
      const t = m[1].toLowerCase().replace(/\./g, '');
      if (t in g.order) return g.order[t];
    }
  }
  const n = /^(\d+)/.exec(s);
  if (n) return Number(n[1]);
  return 999;
}

const RE_YEAR = /^(?:\d{2,4}|20\d{2})[\s_-]*(?:學年|學年度|年度|學期)?$|學年|學年度|年度/;
const RE_TERM = /上學期|下學期|上學段|下學段|第一學段|第二學段|第三學段|第一段|第二段|第三段|學期|學段|^\s*(上|下|第一|第二|第三)\s*$|^[sS][12]$|^[tT][12]$|^term\s*[12]$/i;

/**
 * 從相對路徑推導 metadata。
 * 典型輸入："113學年/上學期/高一A班.xlsx"
 * @param {string} relativePath
 */
export function metaFromPath(relativePath) {
  const parts = String(relativePath || '').split(/[\\/]+/).filter((p) => p !== '' && p !== '.');
  const fileName = parts.length ? parts[parts.length - 1] : '';
  const folders = parts.slice(0, -1);

  // 檔名去掉副檔名 → 班級名稱
  let className = fileName.replace(/\.[^.]+$/, '');
  // 去掉常見的前綴，例如「班級_高一A班」「成績_高一A班」
  className = className.replace(/^(班級|班别|成績|成绩|分數|分数|學期成績|成绩表|成績表)\s*[_\-－]\s*/, '').trim();

  let year = '';
  let term = '';

  for (const f of folders) {
    if (!year && RE_YEAR.test(f.trim())) year = f.trim();
    else if (!term && RE_TERM.test(f.trim())) term = f.trim();
  }
  // 若只找到一個資料夾且它不像年份，就當成年份用（單層結構）
  if (!year && !term && folders.length === 1) year = folders[0].trim();
  if (!year && folders.length > 0) year = folders[0].trim();
  if (!term && folders.length > 1 && folders[1].trim() !== year && !gradeOf(folders[1])) {
    term = folders[1].trim();
  }

  const gradeFolder = folders.find((f) => gradeOf(f));
  const grade = gradeOf(className) || (gradeFolder ? gradeOf(gradeFolder) : '');
  const extraFolders = folders.filter((f) => f.trim() !== year && f.trim() !== term);

  return {
    year: year || '未標示學年',
    term: term || '',
    className: className || fileName || '未命名',
    grade: grade || '未分類',
    extraFolders,
    relativePath: parts.join('/'),
    fileName,
  };
}

/* -------------------------------------------------------- 標題列偵測 --- */

/**
 * 找出真正的標題列索引。
 * 有些成績表第 1 列是合併的大標題，真正欄位在第 2 列。
 */
function findHeaderRow(rows, limit = 25) {
  let best = 0;
  let bestScore = -Infinity;

  const n = Math.min(rows.length, limit);
  for (let i = 0; i < n; i++) {
    const raw = rows[i] || [];
    const cells = raw.map((v) => String(v ?? '').trim()).filter((v) => v !== '');
    if (cells.length === 0) continue;

    // 去重後的非空值數量：合併儲存格填滿會造成大量重複，這裡可以壓低它的分數
    const unique = new Set(cells).size;
    let score = unique * 1.5;

    const joined = cells.join('|');
    if (RE_ID.test(joined)) score += 12;
    if (RE_NAME.test(joined)) score += 12;

    // 標題列應該以文字為主，數字多的通常是資料列
    const numeric = cells.filter((c) => /^-?\d+(\.\d+)?$/.test(c)).length;
    score -= numeric * 3;

    // 重複值懲罰（合併大標題的特徵）
    score -= (cells.length - unique) * 2;

    // 越靠後面越不可能是標題列
    score -= i * 0.6;

    if (score > bestScore) { bestScore = score; best = i; }
  }
  return best;
}

/** 產生欄位名稱，處理空白與重複。 */
function buildHeaders(headerRow, width) {
  const headers = [];
  const seen = new Map();
  for (let c = 0; c < width; c++) {
    let name = String(headerRow[c] ?? '').trim();
    if (name === '') name = `欄位${c + 1}`;
    if (seen.has(name)) {
      const n = seen.get(name) + 1;
      seen.set(name, n);
      name = `${name}(${n})`;
    } else {
      seen.set(name, 1);
    }
    headers.push(name);
  }
  return headers;
}

/**
 * 判斷每一欄的角色。
 * @returns {Array<{index:number, header:string, role:string, numericRatio:number, nonEmpty:number}>}
 */
function classifyColumns(headers, dataRows) {
  const total = dataRows.length || 1;
  const cols = [];

  for (let c = 0; c < headers.length; c++) {
    const header = headers[c];
    let nonEmpty = 0;
    let numeric = 0;

    for (const row of dataRows) {
      const v = row[c];
      if (v === undefined || v === null || String(v).trim() === '') continue;
      nonEmpty++;
      const s = parseScore(v);
      if (s !== null && typeof v !== 'boolean') numeric++;
    }

    const numericRatio = nonEmpty > 0 ? numeric / nonEmpty : 0;

    let role;
    if (RE_ID.test(header)) role = 'id';
    else if (RE_NAME.test(header)) role = 'name';
    else if (RE_DERIVED.test(header)) role = 'derived';
    else if (RE_INFO.test(header)) role = 'info';
    else if (numericRatio >= 0.5 && numeric >= 1) role = 'subject';
    else if (nonEmpty === 0) role = 'ignore';
    else role = 'info'; // 有內容但非數值 → 當成備註資訊，不列入成績運算

    cols.push({ index: c, header, role, numericRatio, nonEmpty, fillRate: nonEmpty / total });
  }
  return cols;
}

function canonicalSubjectCode(value) {
  const s = String(value ?? '').trim();
  if (!/^\d+$/.test(s)) return '';
  return String(Number(s));
}

function normalizeSubjectLabel(value) {
  const label = String(value ?? '').trim();
  return /[\u3400-\u9fff]/.test(label)
    ? label.replace(/\s+/g, '')
    : label.replace(/\s+/g, ' ');
}

/** 從 A 欄「代碼.科目名稱」清單建立代碼 → 顯示名稱對照。 */
function subjectLabelsFromRows(rows, headerRow, columns) {
  const codeHeaders = new Set(columns
    .filter((c) => c.role === 'subject')
    .map((c) => canonicalSubjectCode(c.header))
    .filter(Boolean));
  if (codeHeaders.size === 0) return {};

  const labels = {};
  for (const row of rows.slice(headerRow + 1)) {
    const match = /^\s*(\d+)\s*[.．、]\s*(.*?)\s*$/.exec(String((row && row[0]) ?? ''));
    if (!match) continue;
    const code = canonicalSubjectCode(match[1]);
    const label = normalizeSubjectLabel(match[2]);
    if (codeHeaders.has(code) && label) labels[code] = label;
  }
  return labels;
}

/* ------------------------------------------------------------ 主解析流程 --- */

/** 這列看起來像統計摘要列嗎？（平均、全班、總計…） */
function isSummaryRow(nameCell) {
  const s = String(nameCell ?? '').trim();
  if (s === '') return false;
  return /^(平均|全班|全級|總計|合計|小計|統計|總和|最高|最低|標準差|中位數|眾數|人數|排序|備註|說明|班主任|導師)/.test(s)
    || /^(平均|總計|合計|小計|全班平均|全年級平均)/.test(s);
}

/**
 * 解析單一工作表。
 * @param {Array<Array<any>>} rows
 * @returns {{columns:Array, headerRow:number, students:Array, subjects:Array, warnings:Array}}
 */
export function parseSheet(rows) {
  const warnings = [];

  if (!rows || rows.length === 0) {
    return { columns: [], headerRow: -1, students: [], subjects: [], warnings: ['工作表是空的'] };
  }

  const headerRow = findHeaderRow(rows);
  const width = Math.max(
    ...rows.slice(0, Math.min(rows.length, 200)).map((r) => (r ? r.length : 0)),
    (rows[headerRow] || []).length,
  );

  const headers = buildHeaders(rows[headerRow] || [], width);
  const dataRows = rows.slice(headerRow + 1);
  const columns = classifyColumns(headers, dataRows);
  const labelsByCode = subjectLabelsFromRows(rows, headerRow, columns);
  const subjectLabels = {};
  const subjectCodes = {};
  for (const c of columns) {
    if (c.role !== 'subject') continue;
    const code = canonicalSubjectCode(c.header);
    const label = labelsByCode[code];
    c.subjectKey = label ? `@subject:${label}` : c.header;
    if (label) {
      subjectLabels[c.subjectKey] = label;
      subjectCodes[c.subjectKey] = code;
    }
  }

  // 這種版型的 A 欄是科目代碼對照清單，不是學生資訊欄。
  if (Object.keys(labelsByCode).length > 0 && columns[0]) columns[0].role = 'ignore';

  const idCol = columns.find((c) => c.role === 'id');
  const nameCol = columns.find((c) => c.role === 'name');
  const subjectCols = columns.filter((c) => c.role === 'subject');
  const basicConductCol = columns.find((c) => c.role === 'info' && /基本\s*操行/.test(c.header));
  const adjustedConductCol = columns.find((c) => c.role === 'info' && /調整\s*操行/.test(c.header));
  const conductColumns = [basicConductCol, adjustedConductCol].filter(Boolean);
  const finalConductColumn = columns.find((c) => /(?:最後\s*操行|操行\s*總分)/.test(c.header));
  if (finalConductColumn) finalConductColumn.header = '操行總分';
  if (conductColumns.length && !finalConductColumn) {
    columns.push({
      index: -1, header: '操行總分', role: 'info',
      numericRatio: 1, nonEmpty: 0, fillRate: 0,
    });
  }
  const finalConductHeader = finalConductColumn ? finalConductColumn.header : '操行總分';

  if (headerRow > 0) warnings.push(`標題列在第 ${headerRow + 1} 列（前面有大標題列，已自動跳過）`);
  if (!nameCol) warnings.push('找不到「姓名」欄位，將以學號代替顯示');
  if (subjectCols.length === 0) warnings.push('找不到任何科目分數欄位，請在設定中手動指定');

  const subjects = subjectCols.map((c) => c.subjectKey || c.header);
  const students = [];

  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i] || [];
    const rawId = idCol ? row[idCol.index] : '';
    const rawName = nameCol ? row[nameCol.index] : '';

    const explicitId = rawId === undefined || rawId === null ? '' : String(rawId).trim();
    const rawNameText = rawName === undefined || rawName === null ? '' : String(rawName).trim();
    const namePrefix = /^(\d+)\s*[.．、]\s*/.exec(rawNameText);
    const id = explicitId || (namePrefix ? namePrefix[1] : '');
    const name = namePrefix ? rawNameText.slice(namePrefix[0].length).trim() : rawNameText;

    // 整列空的
    const hasAny = row.some((v) => v !== undefined && v !== null && String(v).trim() !== '');
    if (!hasAny) continue;

    // 摘要列（平均、總計…）
    if (isSummaryRow(name) || isSummaryRow(id)) continue;

    // 沒有學號也沒有姓名 → 不是學生列
    if (id === '' && name === '') continue;

    const scores = {};
    for (const sc of subjectCols) {
      scores[sc.subjectKey || sc.header] = parseScore(row[sc.index]);
    }

    const info = {};
    for (const c of columns) {
      if (c.role !== 'info') continue;
      const v = row[c.index];
      info[c.header] = v === undefined || v === null ? '' : v;
    }
    if (conductColumns.length) {
      const rawConduct = conductColumns.map((c) => row[c.index]);
      const presentConduct = rawConduct.filter((v) => v !== undefined && v !== null && String(v).trim() !== '');
      const parsedConduct = rawConduct.map((v) => parseScore(v));
      const hasInvalidConduct = rawConduct.some((v, index) =>
        v !== undefined && v !== null && String(v).trim() !== '' && parsedConduct[index] === null);
      if (presentConduct.length > 0 && !hasInvalidConduct) {
        const total = parsedConduct.reduce((sum, value) => sum + (value ?? 0), 0);
        info[finalConductHeader] = Math.round(total * 100) / 100;
      }
    }

    // 保留每一欄的原始值。用途：使用者若在設定中把某個「備註資訊」欄
    // 改成科目，我們仍然必須拿得到那個欄位的分數，不必重新讀檔。
    const cells = {};
    for (const c of columns) {
      const v = row[c.index];
      cells[c.header] = v === undefined || v === null ? '' : v;
    }
    if (Object.prototype.hasOwnProperty.call(info, finalConductHeader)) {
      cells[finalConductHeader] = info[finalConductHeader];
    }

    const derived = {};
    for (const c of columns) {
      if (c.role !== 'derived') continue;
      const v = row[c.index];
      derived[c.header] = v === undefined || v === null ? '' : v;
    }

    // 自己算的總和與平均（只計有分數的科目）
    const values = subjects.map((s) => scores[s]).filter((v) => v !== null && v !== undefined);
    const sum = values.length ? values.reduce((a, b) => a + b, 0) : null;
    const avg = values.length ? sum / values.length : null;

    // 檔案裡的總分／名次（可能包含操行調整，所以與自算值分開存放）
    const fileTotalRaw = derived['總分'] ?? derived['總成績'] ?? derived['總計'] ?? derived['合計'];
    const fileRankRaw = derived['名次'] ?? derived['排名'] ?? derived['排位'];
    const fileTotal = parseScore(fileTotalRaw);
    const fileRank = fileRankRaw === undefined || fileRankRaw === null || String(fileRankRaw).trim() === ''
      ? null : Number(String(fileRankRaw).replace(/[^\d.-]/g, '')) || null;

    students.push({
      id,
      name,
      scores,
      info,
      cells,
      derived,
      sum: sum === null ? null : Math.round(sum * 100) / 100,
      avg: avg === null ? null : Math.round(avg * 100) / 100,
      subjectCount: values.length,
      fileTotal,
      fileRank,
      totalMismatch: fileTotal !== null && sum !== null && Math.abs(fileTotal - sum) > 0.51,
      rowNumber: headerRow + 2 + i, // 在原始 Excel 中的列號（1 起始）
    });
  }

  // 統計每科缺考人數，讓 UI 可以提示
  const absentCount = {};
  for (const s of subjects) {
    absentCount[s] = students.filter((st) => st.scores[s] === null || st.scores[s] === undefined).length;
  }

  const mismatch = students.filter((s) => s.totalMismatch).length;
  if (mismatch > 0) {
    warnings.push(`有 ${mismatch} 位學生的「總分」與各科加總不一致（可能是總分含操行調整或其他加分）`);
  }

  return { columns, headerRow, students, subjects, subjectLabels, subjectCodes, absentCount, warnings };
}

/**
 * 解析整個檔案，會在多個工作表中挑出最像成績表的那一個。
 * @param {{sheets:Array<{name:string, rows:Array, merges:Array}>}} workbook
 * @param {string} relativePath
 */
export function parseWorkbook(workbook, relativePath) {
  const meta = metaFromPath(relativePath);
  const candidates = [];

  for (const sheet of workbook.sheets || []) {
    if (!sheet.rows || sheet.rows.length === 0) continue;
    try {
      const parsed = parseSheet(sheet.rows);
      // 分數：學生數 × 科目數，越多的越可能是真正的成績表
      const score = parsed.students.length * Math.max(1, parsed.subjects.length)
        + (parsed.students.length > 0 ? 20 : 0);
      candidates.push({ sheetName: sheet.name, parsed, score });
    } catch (err) {
      candidates.push({ sheetName: sheet.name, error: err.message, score: -1 });
    }
  }

  if (candidates.length === 0) {
    return { meta, students: [], subjects: [], subjectLabels: {}, subjectCodes: {}, columns: [], warnings: ['檔案中沒有可讀取的工作表'], sheetName: '', ok: false };
  }

  candidates.sort((a, b) => b.score - a.score);
  const best = candidates[0];

  if (best.error) {
    return { meta, students: [], subjects: [], subjectLabels: {}, subjectCodes: {}, columns: [], warnings: [`工作表「${best.sheetName}」解析失敗：${best.error}`], sheetName: best.sheetName, ok: false };
  }

  const warnings = [...best.parsed.warnings];
  if (candidates.length > 1) {
    warnings.push(`檔案內有 ${candidates.length} 個工作表，已選用「${best.sheetName}」`);
  }

  return {
    meta,
    sheetName: best.sheetName,
    students: best.parsed.students,
    subjects: best.parsed.subjects,
    subjectLabels: best.parsed.subjectLabels || {},
    subjectCodes: best.parsed.subjectCodes || {},
    columns: best.parsed.columns,
    absentCount: best.parsed.absentCount || {},
    headerRow: best.parsed.headerRow,
    warnings,
    ok: best.parsed.students.length > 0,
  };
}

/**
 * 把同一班的學生依總分排名（競賽排名法：同分同名次）。
 * @param {Array} students
 * @param {(s:any)=>number|null} valueOf
 * @returns {Map<any, number>} 學生 → 名次
 */
export function computeRanks(students, valueOf) {
  const withValue = students
    .map((s) => ({ s, v: valueOf(s) }))
    .filter((x) => x.v !== null && x.v !== undefined && Number.isFinite(x.v));

  withValue.sort((a, b) => b.v - a.v);

  const ranks = new Map();
  let lastValue = null;
  let lastRank = 0;
  withValue.forEach((x, i) => {
    const rank = (lastValue !== null && x.v === lastValue) ? lastRank : i + 1;
    ranks.set(x.s, rank);
    lastValue = x.v;
    lastRank = rank;
  });
  return ranks;
}
