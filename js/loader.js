/**
 * loader.js — 批次載入整個資料夾並組成資料集
 * ---------------------------------------------------------------------------
 * 輸入是瀏覽器給的一堆 File 物件（來自 <input webkitdirectory> 或拖放），
 * 每個 File 都帶著 webkitRelativePath，例如 "113學年/上學期/高一A班.xlsx"，
<<<<<<< HEAD
 * 或 "2025-2026/初一/初一仁.xlsx"，我們就靠路徑推導出學年／學段／年級／班級。
=======
 * 我們就靠這個路徑推導出學年／學段／班級。
>>>>>>> e1b79721076a5dbb3de0fe79d448fb57b1aa9069
 */

import { readTableFile } from './xlsx.js';
import { parseWorkbook, computeRanks, gradeOrder } from './parse.js';

const SUPPORTED = /\.(xlsx|xlsm|csv)$/i;

/** 把工作佇列分批執行，避免一次開太多檔造成瀏覽器卡住。 */
async function runPool(items, worker, concurrency, onProgress, signal) {
  const results = new Array(items.length);
  let next = 0;
  let done = 0;

  async function runner() {
    for (;;) {
      if (signal && signal.aborted) return;
      const i = next++;
      if (i >= items.length) return;
      try {
        results[i] = await worker(items[i], i);
      } catch (err) {
        results[i] = { __error: err && err.message ? err.message : String(err) };
      }
      done++;
      if (onProgress) onProgress(done, items.length, items[i]);
      // 偶爾讓出主執行緒，讓進度條能更新、UI 不凍結
      if (done % 2 === 0) await new Promise((r) => setTimeout(r, 0));
    }
  }

  const n = Math.max(1, Math.min(concurrency, items.length));
  await Promise.all(Array.from({ length: n }, runner));
  return results;
}

/** 依序取出陣列中的唯一值。 */
function uniq(arr) {
  return [...new Set(arr)];
}

/**
 * 建立資料集。
 * @param {Array<File|{file:File, path:string}>} fileList
 * @param {{onProgress?:Function, signal?:AbortSignal, sourceName?:string}} opts
 */
export async function buildDataset(fileList, opts = {}) {
  const { onProgress, signal } = opts;

  const targets = [];
  const skipped = [];

  for (const item of fileList) {
    // 接受 File，也接受拖放資料夾時自行組出的 {file, path}
    const f = item && item.file ? item.file : item;
    if (!f || typeof f.name !== 'string') continue;
    const name = f.name;
    const path = (item && item.path) || f.webkitRelativePath || name;

    // 忽略 Excel 的暫存檔與隱藏檔
    if (name.startsWith('~$') || name.startsWith('.')) { skipped.push({ path, reason: '暫存檔或隱藏檔' }); continue; }
    if (!SUPPORTED.test(name)) { skipped.push({ path, reason: '不是 .xlsx / .csv' }); continue; }
    targets.push({ file: f, path });
  }

  if (targets.length === 0) {
    throw new Error('選取的資料夾裡找不到任何 .xlsx 或 .csv 檔。');
  }

  // 依路徑排序，讓載入順序穩定（也讓進度看起來有條理）
  targets.sort((a, b) => a.path.localeCompare(b.path, 'zh-Hant', { numeric: true }));

  const parsedFiles = await runPool(
    targets,
    async (t) => {
      const workbook = await readTableFile(t.file);
      const result = parseWorkbook(workbook, t.path);
      return { ...result, path: t.path, size: t.file.size };
    },
    4,
    onProgress,
    signal,
  );

  if (signal && signal.aborted) throw new Error('載入已取消');

  const files = [];
  const students = [];
  const warnings = [];
  const seenClassKey = new Map();
  const columnMap = new Map(); // 欄位名稱 → { role, count, numericRatio }
<<<<<<< HEAD
  const subjectLabels = {};
=======
>>>>>>> e1b79721076a5dbb3de0fe79d448fb57b1aa9069

  parsedFiles.forEach((res, i) => {
    const target = targets[i];

    if (!res || res.__error) {
      const msg = res && res.__error ? res.__error : '未知錯誤';
      files.push({
        path: target.path, ok: false, error: msg, students: 0, subjects: [],
        year: '', term: '', className: target.path.replace(/\.[^.]+$/, ''), grade: '',
      });
      warnings.push({ level: 'error', path: target.path, message: `讀取失敗：${msg}` });
      return;
    }

    const { meta } = res;

<<<<<<< HEAD
    Object.assign(subjectLabels, Object.fromEntries(
      Object.entries(res.subjectLabels || {}).filter(([code]) => !subjectLabels[code]),
    ));

    // 蒐集所有欄位（跨檔案取聯集），讓設定頁可以手動指定科目
    for (const col of res.columns || []) {
      const key = col.role === 'subject' ? (col.subjectKey || col.header) : col.header;
      const storedColumn = col.role === 'subject'
        ? { ...col, header: key, sourceHeader: col.header }
        : col;
      const prev = columnMap.get(key);
      if (!prev) {
        columnMap.set(key, { ...storedColumn, count: 1 });
=======
    // 蒐集所有欄位（跨檔案取聯集），讓設定頁可以手動指定科目
    for (const col of res.columns || []) {
      const prev = columnMap.get(col.header);
      if (!prev) {
        columnMap.set(col.header, { header: col.header, role: col.role, count: 1, numericRatio: col.numericRatio });
>>>>>>> e1b79721076a5dbb3de0fe79d448fb57b1aa9069
      } else {
        prev.count++;
        prev.numericRatio = Math.max(prev.numericRatio, col.numericRatio);
        // 多數檔案都當它是科目，就跟著當科目
        if (col.role === 'subject' && prev.role !== 'subject' && prev.count > 1) prev.role = 'subject';
      }
    }

    files.push({
      path: target.path,
      ok: res.ok,
      sheetName: res.sheetName,
      year: meta.year,
      term: meta.term,
      className: meta.className,
      grade: meta.grade,
      students: res.students.length,
      subjects: res.subjects,
<<<<<<< HEAD
      subjectLabels: res.subjectLabels || {},
=======
>>>>>>> e1b79721076a5dbb3de0fe79d448fb57b1aa9069
      warnings: res.warnings,
      size: res.size,
    });

    // 同一個 學年/學段/班級 出現兩次 → 提醒可能重複放了檔案
    const key = `${meta.year}|${meta.term}|${meta.className}`;
    if (seenClassKey.has(key)) {
      warnings.push({
        level: 'warn', path: target.path,
        message: `與「${seenClassKey.get(key)}」重複（同學年、同學段、同班級），兩份資料都會顯示`,
      });
    } else {
      seenClassKey.set(key, target.path);
    }

    for (const w of res.warnings || []) {
      warnings.push({ level: 'info', path: target.path, message: w });
    }
    if (!res.ok) {
      warnings.push({ level: 'warn', path: target.path, message: '這個檔案沒有解析出任何學生資料' });
    }

    // 幫每個學生補上來源資訊
    const base = {
      year: meta.year,
      term: meta.term,
      className: meta.className,
      grade: meta.grade,
      filePath: target.path,
<<<<<<< HEAD
      subjectLabels: res.subjectLabels || {},
      subjectCodes: res.subjectCodes || {},
=======
>>>>>>> e1b79721076a5dbb3de0fe79d448fb57b1aa9069
    };
    for (const st of res.students) {
      students.push({ ...st, ...base });
    }
  });

  // 各班各自排名（總分）
  const byClass = new Map();
  for (const st of students) {
    const key = `${st.year}|${st.term}|${st.className}`;
    if (!byClass.has(key)) byClass.set(key, []);
    byClass.get(key).push(st);
  }
  for (const list of byClass.values()) {
    const ranks = computeRanks(list, (s) => (s.sum === null ? null : s.sum));
    const avgRanks = computeRanks(list, (s) => (s.avg === null ? null : s.avg));
    for (const st of list) {
      st.rankInClass = ranks.get(st) ?? null;
      st.rankInClassByAvg = avgRanks.get(st) ?? null;
    }
  }

  // 彙整各種維度
  const subjects = uniq(students.flatMap((s) => Object.keys(s.scores || {})));
  const years = uniq(students.map((s) => s.year)).sort((a, b) =>
    a.localeCompare(b, 'zh-Hant', { numeric: true }));
  const terms = uniq(students.map((s) => s.term).filter(Boolean)).sort((a, b) =>
    a.localeCompare(b, 'zh-Hant', { numeric: true }));
  const grades = uniq(students.map((s) => s.grade)).sort((a, b) => gradeOrder(a) - gradeOrder(b));
  const classes = uniq(students.map((s) => s.className)).sort((a, b) =>
    a.localeCompare(b, 'zh-Hant', { numeric: true }));

  // 學年 + 學段 的組合（用來做下拉選單的連動）
  const periods = uniq(students.map((s) => `${s.year}|${s.term}`)).map((k) => {
    const [year, term] = k.split('|');
    return { year, term };
  });

  const okFiles = files.filter((f) => f.ok).length;

  // 欄位順序：沿用第一個成功檔案的欄位順序（通常就等於 Excel 的欄位順序）
  const columns = [...columnMap.values()];

  return {
    version: 1,
    loadedAt: new Date().toISOString(),
    sourceName: opts.sourceName || '',
    files,
    students,
    skipped,
    subjects,
<<<<<<< HEAD
    subjectLabels,
=======
>>>>>>> e1b79721076a5dbb3de0fe79d448fb57b1aa9069
    columns,
    years,
    terms,
    grades,
    classes,
    periods,
    warnings,
    summary: {
      fileCount: files.length,
      okFileCount: okFiles,
      failedFileCount: files.length - okFiles,
      studentCount: students.length,
      subjectCount: subjects.length,
      yearCount: years.length,
      classCount: classes.length,
      skippedCount: skipped.length,
    },
  };
}

/**
 * 產生內建示範資料（不需要任何 Excel 檔就能看到介面效果）。
 * 刻意模仿真實資料的樣貌，包含缺考、文字操行、偏科等情況。
 */
export function buildDemoDataset() {
  const surnames = ['陳', '黃', '李', '張', '梁', '吳', '林', '劉', '蔡', '楊', '許', '鄭', '謝', '周', '蘇', '何', '羅', '高', '蕭', '潘'];
  const given = ['嘉欣', '志明', '婉婷', '家豪', '雅雯', '俊傑', '佩珊', '文軒', '思穎', '浩然', '詠詩', '子謙', '美玲', '國強', '曉彤', '偉業', '靜怡', '永樂', '淑芬', '柏豪', '凱琳', '振東', '慧敏', '天佑', '若琳'];
  const subjects = ['中文科', '英文科', '數學科', '歷史科', '地理科', '物理科', '化學科', '生物科', '電腦科'];
  const subjectBias = { 中文科: 5, 英文科: 1, 數學科: -4, 歷史科: 3, 地理科: 2, 物理科: -3, 化學科: -2, 生物科: 0, 電腦科: 6 };
  const years = ['112學年', '113學年', '114學年'];
  const terms = ['上學期', '下學期'];
  const classes = ['高一A班', '高一B班', '高一C班', '高二A班', '高二B班', '高三A班'];

  // 固定種子的亂數，讓每次載入的示範資料都一樣（方便對照）
  let seed = 20240918;
  const rnd = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const gauss = () => {
    let u = 0, v = 0;
    while (u === 0) u = rnd();
    while (v === 0) v = rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  // 每個班級固定一批學生，能力值跨學年延續
  const roster = new Map();
  for (const cls of classes) {
    const n = 26 + Math.floor(rnd() * 9);
    const list = [];
    for (let i = 0; i < n; i++) {
      const name = surnames[Math.floor(rnd() * surnames.length)] + given[Math.floor(rnd() * given.length)];
      list.push({ id: '', name, ability: gauss(), subjectBias: subjects.map(() => gauss() * 0.5) });
    }
    roster.set(cls, list);
  }

  const students = [];

  years.forEach((year, yi) => {
    terms.forEach((term) => {
      classes.forEach((cls) => {
        const grade = cls.slice(0, 2);
        // 高三只在高年級出現（避免 112 學年就有高三的怪情況）
        if (grade === '高三' && yi < 1) return;
        if (grade === '高二' && yi < 1 && term === '上學期' && false) return;

        const rosterList = roster.get(cls);
        const termShift = term === '下學期' ? 0.25 : 0;
        const yearShift = (yi - 1) * 0.15;

        const classStudents = rosterList.map((p, idx) => {
          const scores = {};
          subjects.forEach((sub, si) => {
            const ability = p.ability + p.subjectBias[si] + yearShift + termShift;
            let v = 68 + subjectBias[sub] * 0.6 + ability * 13 + gauss() * 6;
            v = Math.max(0, Math.min(100, Math.round(v)));
            scores[sub] = v;
          });

          // 刻意放入邊界情況
          if (idx === 2) scores['數學科'] = null;      // 缺考
          if (idx === 5) scores['英文科'] = 0;         // 零分
          if (idx === 8) scores['物理科'] = null;      // 缺考

          const values = subjects.map((s) => scores[s]).filter((v) => v !== null);
          const sum = values.reduce((a, b) => a + b, 0);
          const r = rnd();
          const conduct = r > 0.72 ? 'A' : r > 0.3 ? 'B' : r > 0.08 ? 'C' : 'D';

          return {
            id: `${year.slice(0, 3)}${classes.indexOf(cls) + 1}${String(idx + 1).padStart(3, '0')}`,
            name: p.name,
            scores,
            info: { 操行: conduct, 操行調整: Math.round((rnd() * 4 - 1.5) * 2) / 2 },
            derived: {},
            sum,
            avg: Math.round((sum / values.length) * 100) / 100,
            subjectCount: values.length,
            fileTotal: sum,
            fileRank: null,
            totalMismatch: false,
            rowNumber: idx + 2,
            year, term, className: cls, grade,
            filePath: `${year}/${term}/${cls}.xlsx`,
          };
        });

        // 班內排名
        const sorted = [...classStudents].sort((a, b) => b.sum - a.sum);
        let last = null, lastRank = 0;
        sorted.forEach((s, i) => {
          const rank = last !== null && s.sum === last ? lastRank : i + 1;
          s.rankInClass = rank;
          s.fileRank = rank;
          last = s.sum; lastRank = rank;
        });

        students.push(...classStudents);
      });
    });
  });

  const uniqBy = (fn) => [...new Set(students.map(fn))];
  const periods = uniqBy((s) => `${s.year}|${s.term}`).map((k) => {
    const [year, term] = k.split('|');
    return { year, term };
  });

  // 示範資料也要有 cells，這樣在設定頁把「操行」改成科目時行為才一致
  for (const s of students) {
    s.cells = { ...s.scores, ...s.info };
  }
  const columns = [
    { header: '學號', role: 'id', count: 1, numericRatio: 1 },
    { header: '姓名', role: 'name', count: 1, numericRatio: 0 },
    ...subjects.map((h) => ({ header: h, role: 'subject', count: 1, numericRatio: 1 })),
    { header: '操行', role: 'info', count: 1, numericRatio: 0 },
    { header: '操行調整', role: 'info', count: 1, numericRatio: 1 },
  ];

  return {
    version: 1,
    loadedAt: new Date().toISOString(),
    sourceName: '內建示範資料',
    demo: true,
    files: [],
    students,
    skipped: [],
    subjects,
    columns,
    years: uniqBy((s) => s.year),
    terms: ['上學期', '下學期'],
    grades: uniqBy((s) => s.grade),
    classes,
    periods,
    warnings: [],
    summary: {
      fileCount: years.length * terms.length * classes.length,
      okFileCount: years.length * terms.length * classes.length,
      failedFileCount: 0,
      studentCount: students.length,
      subjectCount: subjects.length,
      yearCount: years.length,
      classCount: classes.length,
      skippedCount: 0,
    },
  };
}
