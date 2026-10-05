/**
 * app.js — 介面主程式
 * ---------------------------------------------------------------------------
 * 職責：
 *   - 載入資料（資料夾 / 拖放 / 示範資料 / 上次的快取）
 *   - 學年 → 學段 → 年級 → 班級 的連動篩選
 *   - 成績總表：門檻上色、點欄排序、統計頁尾、匯出
 *   - 單科比較：全年級排名、各班統計、長條圖、班級×科目矩陣
 *   - 門檻與科目設定
 */

import { buildDataset, buildDemoDataset } from './loader.js';
import {
  loadDataset, saveDataset, clearDataset,
  loadSettings, saveSettings, resetSettings,
  storageEstimate, DEFAULT_SETTINGS, DEFAULT_TIERS,
} from './store.js';
import { parseScore } from './parse.js';
import { summarize, tierOf, fmt, pct } from './stats.js';
import { compareDatasets } from './import-diff.js';

/* ------------------------------------------------------------ 全域狀態 --- */

const state = {
  dataset: null,
  settings: loadSettings(),
  filters: { year: '', term: '', grade: '', classes: new Set(), search: '' },
  sort: { scores: { key: '__rank', dir: 1 } },
  compare: { subject: '', scope: 'selected' },
  view: 'scores',
  abort: null,
};

const CLASS_COLORS = [
  '#4f46e5', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#14b8a6', '#f97316', '#6366f1', '#84cc16', '#ec4899', '#06b6d4',
];

let resolveImportReview = null;

/* --------------------------------------------------------------- 工具 --- */

const $ = (sel) => document.querySelector(sel);

function esc(v) {
  if (v === null || v === undefined) return '';
  return String(v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let toastTimer = null;
function showToast(msg, ms = 3200) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  requestAnimationFrame(() => el.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.classList.remove('show');
    setTimeout(() => { el.hidden = true; }, 220);
  }, ms);
}

function classColor(name) {
  const list = state.dataset ? state.dataset.classes : [];
  const i = Math.max(0, list.indexOf(name));
  return CLASS_COLORS[i % CLASS_COLORS.length];
}

/** 取得某學生某科的分數；缺考或無資料回傳 null。 */
function getScore(s, subject) {
  if (s.cells && Object.prototype.hasOwnProperty.call(s.cells, subject)) {
    const v = parseScore(s.cells[subject]);
    if (v !== null) return v;
  }
  if (s.scores && Object.prototype.hasOwnProperty.call(s.scores, subject)) {
    const v = s.scores[subject];
    if (typeof v === 'number' && Number.isFinite(v)) return v;
  }
  return null;
}

/** 畫面上要顯示的總分（可切換用檔案的值或自己重算）。 */
function totalOf(s) {
  if (state.settings.recomputeTotals) return s.sum;
  return (s.fileTotal !== null && s.fileTotal !== undefined) ? s.fileTotal : s.sum;
}

function avgOf(s) {
  if (state.settings.recomputeTotals) return s.avg;
  const t = totalOf(s);
  const n = s.subjectCount || 0;
  if (t === null || n === 0) return s.avg;
  return Math.round((t / n) * 100) / 100;
}

function rankOf(s) {
  if (state.settings.recomputeTotals) return s.rankInClass;
  return (s.fileRank !== null && s.fileRank !== undefined) ? s.fileRank : s.rankInClass;
}

/** 目前有效的科目清單（已考慮使用者停用／強制指定）。 */
function effectiveSubjects() {
  const ds = state.dataset;
  if (!ds) return [];
  const disabled = new Set(state.settings.disabledSubjects || []);
  const forced = new Set(state.settings.forcedSubjects || []);
  const order = state.settings.subjectOrder || [];

  const cols = ds.columns && ds.columns.length
    ? ds.columns
    : (ds.subjects || []).map((h) => ({ header: h, role: 'subject' }));

  const list = [];
  for (const c of cols) {
    if (c.role === 'id' || c.role === 'name') continue;
    if (disabled.has(c.header)) continue;
    if (c.role === 'subject' || forced.has(c.header)) list.push(c.header);
  }
  // 補上只在 students.scores 出現、columns 沒記錄的科目
  for (const s of ds.subjects || []) {
    if (!list.includes(s) && !disabled.has(s)) list.push(s);
  }
  // 保底：一個科目都沒有時，直接從資料推導
  if (list.length === 0 && ds.students.length) {
    for (const k of Object.keys(ds.students[0].scores || {})) {
      if (!list.includes(k)) list.push(k);
    }
  }

  if (order.length) {
    list.sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      return (ia < 0 ? 9999 : ia) - (ib < 0 ? 9999 : ib);
    });
  }
  return list;
}

/** 目前有效的「備註資訊」欄位（例如操行、操行調整）。 */
function effectiveInfoColumns() {
  const ds = state.dataset;
  if (!ds || !ds.columns) return [];
  const disabled = new Set(state.settings.disabledSubjects || []);
  return ds.columns
    .filter((c) => c.role === 'info'
      && !disabled.has(c.header)
      && (state.settings.showConductComponents || !/^(基本\s*操行|調整\s*操行)$/.test(c.header)))
    .map((c) => c.header);
}

/** 以 Excel A 欄科名顯示科目；代碼只用於內部配對。 */
function subjectDisplay(key, students = currentStudents()) {
  const counts = new Map();
  for (const s of students) {
    const label = s.subjectLabels && s.subjectLabels[key];
    if (label) counts.set(label, (counts.get(label) || 0) + 1);
  }
  const label = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
    || (state.dataset && state.dataset.subjectLabels && state.dataset.subjectLabels[key])
    || '';
  return label || key;
}

/* -------------------------------------------------------------- 篩選 --- */

function baseStudents() {
  const ds = state.dataset;
  if (!ds) return [];
  const { year, term, grade } = state.filters;
  return ds.students.filter((s) =>
    (!year || s.year === year) &&
    (!term || s.term === term) &&
    (!grade || s.grade === grade));
}

function currentStudents() {
  const cls = state.filters.classes;
  const q = state.filters.search.trim().toLowerCase();
  return baseStudents().filter((s) => {
    // 沒有勾選任何班級 = 全部班級
    if (cls.size > 0 && !cls.has(s.className)) return false;
    if (q) {
      const hay = `${s.id} ${s.name}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
}

function subjectsWithScores(subjects, students) {
  return subjects.filter((subject) => students.some((student) => getScore(student, subject) !== null));
}

function classesInScope() {
  const list = [...new Set(baseStudents().map((s) => s.className))];
  return list.sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));
}

/* ------------------------------------------------------------- 排序 --- */

function sortValue(s, key) {
  if (key === '__rank') return rankOf(s);
  if (key === '__total') return totalOf(s);
  if (key === '__avg') return avgOf(s);
  if (key === 'id') return String(s.id ?? '');
  if (key === 'name') return String(s.name ?? '');
  if (key === 'className') return String(s.className ?? '');
  if (key.startsWith('sub:')) return getScore(s, key.slice(4));
  if (key.startsWith('info:')) {
    const v = s.info ? s.info[key.slice(5)] : '';
    return v === '' || v === undefined || v === null ? null : v;
  }
  return null;
}

function sortedStudents(list, key, dir) {
  const arr = [...list];
  arr.sort((a, b) => {
    const va = sortValue(a, key);
    const vb = sortValue(b, key);
    const na = va === null || va === undefined || va === '';
    const nb = vb === null || vb === undefined || vb === '';
    if (na && nb) return 0;
    if (na) return 1;   // 缺考永遠排最後
    if (nb) return -1;
    let c;
    if (typeof va === 'number' && typeof vb === 'number') c = va - vb;
    else c = String(va).localeCompare(String(vb), 'zh-Hant', { numeric: true });
    return c * dir;
  });
  return arr;
}

/* ==================================================== 成績總表的欄位定義 === */

function scoreColumns(students = currentStudents()) {
  const subjects = subjectsWithScores(effectiveSubjects(), students);
  const info = effectiveInfoColumns();
  const multiClass = new Set(students.map((s) => s.className)).size > 1;

  const cols = [
    { key: 'id', label: '學號', type: 'id', sticky: 1 },
    { key: 'name', label: '姓名', type: 'name', sticky: 2 },
  ];
  if (multiClass) cols.push({ key: 'className', label: '班級', type: 'class' });

  for (const s of subjects) cols.push({ key: `sub:${s}`, label: subjectDisplay(s, students), type: 'num' });
  for (const h of info) cols.push({ key: `info:${h}`, label: h, type: 'info' });

  if (state.settings.showTotals) {
    cols.push({ key: '__total', label: '總分', type: 'num bold', hint: '各科加總。滿分＝科目數 × 100' });
  }
  cols.push({ key: '__avg', label: '平均', type: 'num', hint: '各科平均分，滿分 100' });
  // 每份 Excel 就是一個班；將班名次放到資料欄位後方，接近原始 Excel 順序。
  cols.push({ key: '__rank', label: '班名次', type: 'rank', hint: '該生在這個班內依總分排出的名次（同分同名次）' });
  return cols;
}

function renderScores() {
  const table = $('#scoresTable');
  const note = $('#scoresNote');
  const summary = $('#scoresSummary');

  if (!state.dataset) {
    table.innerHTML = '';
    summary.innerHTML = '';
    note.textContent = '';
    return;
  }

  const students = currentStudents();
  const cols = scoreColumns(students);
  const subjects = subjectsWithScores(effectiveSubjects(), students);
  const list = sortedStudents(students, state.sort.scores.key, state.sort.scores.dir);
  const passLine = state.settings.passLine;
  const colorRow = state.settings.colorWholeRow;
  const tiers = state.settings.tiers;

  /* ---- 表頭 ---- */
  let thead = '<thead><tr>';
  for (const c of cols) {
    const isSorted = state.sort.scores.key === c.key;
    const mark = isSorted ? (state.sort.scores.dir > 0 ? '▲' : '▼') : '⇅';
    const stickyClass = c.sticky === 1 ? 'sticky-col' : (c.sticky === 2 ? 'sticky-col sticky-col-2' : '');
    const tip = `${c.hint ? c.hint + '。' : ''}點一下依「${c.label}」排序`;
    thead += `<th class="${stickyClass} ${isSorted ? 'sorted' : ''}" style="left:${c.sticky === 2 ? 96 : 0}px" data-key="${esc(c.key)}" title="${esc(tip)}">`
      + `${esc(c.label)}<span class="sort-mark">${mark}</span></th>`;
  }
  thead += '</tr></thead>';

  /* ---- 表身 ---- */
  const bodyRows = [];
  for (const s of list) {
    const rank = rankOf(s);
    const rowTier = colorRow ? tierOf(totalOf(s), tiers) : null;
    const rowStyle = rowTier ? ` style="background:${rowTier.bg}"` : '';
    let tr = `<tr${rowStyle}>`;

    for (const c of cols) {
      const sticky = c.sticky === 1 ? ' sticky-col' : (c.sticky === 2 ? ' sticky-col sticky-col-2' : '');
      const stickyStyle = c.sticky ? ` style="left:${c.sticky === 2 ? 96 : 0}px"` : '';

      if (c.type === 'id') {
        tr += `<td class="id${sticky}"${stickyStyle}>${esc(s.id)}</td>`;
      } else if (c.type === 'name') {
        tr += `<td class="name${sticky}"${stickyStyle}>${esc(s.name)}</td>`;
      } else if (c.type === 'class') {
        const col = classColor(s.className);
        tr += `<td><span class="chip-dot" style="display:inline-block;width:8px;height:8px;border-radius:3px;background:${col};margin-right:5px"></span>${esc(s.className)}</td>`;
      } else if (c.type === 'rank') {
        const cls = rank !== null && rank <= 3 ? ` rank-top rank-${rank}` : '';
        tr += `<td class="num${cls}">${rank === null ? '—' : rank}</td>`;
      } else if (c.type === 'info') {
        const h = c.key.slice(5);
        const raw = s.info ? s.info[h] : '';
        const txt = raw === '' || raw === undefined || raw === null ? '—' : String(raw);
        tr += `<td>${esc(txt)}</td>`;
      } else if (c.type.startsWith('num')) {
        let v;
        if (c.key === '__total') v = totalOf(s);
        else if (c.key === '__avg') v = avgOf(s);
        else v = getScore(s, c.key.slice(4));

        const bold = c.type.includes('bold') ? ' font-weight:750;' : '';
        if (v === null || v === undefined) {
          tr += `<td class="num cell-absent">缺考</td>`;
        } else {
          const t = tierOf(v, tiers);
          const style = t ? `background:${t.bg};color:${t.fg};${t.bold ? 'font-weight:800;' : ''}${bold}` : bold;
          tr += `<td class="num cell-color" style="${style}">${fmt(v)}</td>`;
        }
      }
    }
    tr += '</tr>';
    bodyRows.push(tr);
  }

  if (bodyRows.length === 0) {
    bodyRows.push(`<tr><td colspan="${cols.length}" style="padding:26px;color:var(--text-2)">這個條件下沒有學生資料。請調整上方的學年／學段／年級／班級。</td></tr>`);
  }

  /* ---- 頁尾統計 ---- */
  const valuesFor = (c) => {
    if (c.key === '__total') return list.map(totalOf);
    if (c.key === '__avg') return list.map(avgOf);
    if (c.key === '__rank') return list.map(rankOf);
    if (c.key.startsWith('sub:')) return list.map((s) => getScore(s, c.key.slice(4)));
    return null;
  };

  // 及格率的判定基準。總分欄特別處理：總分不能用及格線直接比，改用個人平均分。
  const rateValuesFor = (c) => (c.key === '__total' ? list.map(avgOf) : valuesFor(c));

  let foot = '<tfoot>';
  // 平均列
  if (state.settings.showAverages) {
    foot += '<tr>';
    for (const c of cols) {
      const sticky = c.sticky === 1 ? ' sticky-col' : (c.sticky === 2 ? ' sticky-col sticky-col-2' : '');
      const stickyStyle = c.sticky ? ` style="left:${c.sticky === 2 ? 96 : 0}px"` : '';
      if (c.sticky === 1) { foot += `<td class="${sticky.trim()}"${stickyStyle}>平均</td>`; continue; }
      if (c.sticky === 2) { foot += `<td class="${sticky.trim()}"${stickyStyle}></td>`; continue; }
      const vals = valuesFor(c);
      if (!vals || c.key === '__rank') { foot += '<td>—</td>'; continue; }
      const sum = summarize(vals, passLine);
      const tip = `最高 ${fmt(sum.max)}　最低 ${fmt(sum.min)}　標準差 ${fmt(sum.stdev)}　缺考 ${sum.absent} 人`;
      foot += `<td class="num" title="${esc(tip)}">${fmt(sum.mean)}</td>`;
    }
    foot += '</tr>';
  }
  if (state.settings.showPassRates) {
    foot += '<tr>';
    for (const c of cols) {
      const sticky = c.sticky === 1 ? ' sticky-col' : (c.sticky === 2 ? ' sticky-col sticky-col-2' : '');
      const stickyStyle = c.sticky ? ` style="left:${c.sticky === 2 ? 96 : 0}px"` : '';
      if (c.sticky === 1) { foot += `<td class="${sticky.trim()}"${stickyStyle}>及格率</td>`; continue; }
      if (c.sticky === 2) { foot += `<td class="${sticky.trim()}"${stickyStyle}></td>`; continue; }
      const vals = rateValuesFor(c);
      if (!vals || c.key === '__rank') { foot += '<td>—</td>'; continue; }
      const sum = summarize(vals, passLine);
      const color = sum.passRate === null ? '' : sum.passRate < 0.6 ? 'color:#d32f2f' : sum.passRate < 0.8 ? 'color:#e07b00' : 'color:#2e7d32';
      const tip = c.key === '__total'
        ? `總分是各科加總（滿分 ${subjects.length * 100}），不能直接和 ${passLine} 比。這裡的及格率是以每位學生的「平均分」是否 ≥ ${passLine} 來判斷。`
        : `分數 ≥ ${passLine} 的人數比例`;
      foot += `<td class="num" style="${color}" title="${esc(tip)}">${pct(sum.passRate)}</td>`;
    }
    foot += '</tr>';
  }
  foot += '</tfoot>';

  table.innerHTML = thead + '<tbody>' + bodyRows.join('') + '</tbody>' + foot;

  /* ---- 摘要 chips ---- */
  // 注意：總分滿分是「科目數 × 100」，拿及格線 60 去比總分是沒有意義的。
  // 因此「平均分」與「平均分及格率」都以每位學生的平均分為準，這也是學校的標準算法。
  const avgValues = list.map(avgOf);
  const overallAvg = summarize(avgValues, passLine);
  const overallTotal = summarize(list.map(totalOf), passLine);
  summary.innerHTML = [
    chip(list.length, '位學生'),
    chip(new Set(list.map((s) => s.className)).size, '個班級'),
    chip(fmt(overallAvg.mean), '平均分'),
    ...(state.settings.showPassRates ? [chip(pct(overallAvg.passRate), `平均分及格率（≥${passLine}）`)] : []),
    ...(state.settings.showTotals ? [chip(fmt(overallTotal.mean), '總分平均')] : []),
    chip(subjects.length, '個科目'),
  ].join('');

  const absentTotal = subjects.reduce((acc, sub) =>
    acc + list.filter((s) => getScore(s, sub) === null).length, 0);
  note.innerHTML = `點欄位標題可依該欄排序。分數格顏色依「門檻設定」的規則上色，滑過「平均」列可看最高／最低／標準差。`
    + `　<b>平均分只計有分數的科目</b>，缺考不列入平均（但缺考以 0 分計入總分，因為學校的總分欄就是這樣算的）。`
    + (absentTotal ? `　目前檢視範圍內共有 <b>${absentTotal}</b> 筆缺考紀錄。` : '');
}

function chip(value, label) {
  return `<div class="stat-chip"><b>${esc(value)}</b><span>${esc(label)}</span></div>`;
}

/* ======================================================== 單科比較頁 === */

function renderCompare() {
  const subjectSel = $('#selSubject');
  const inScope = state.compare.scope === 'grade' ? baseStudents() : currentStudents();
  const subjects = subjectsWithScores(effectiveSubjects(), inScope);

  // 科目下拉選單（保留目前選擇）
  const keep = state.compare.subject;
  subjectSel.innerHTML = subjects.length
    ? subjects.map((s) => `<option value="${esc(s)}">${esc(subjectDisplay(s, baseStudents()))}</option>`).join('')
    : '<option value="">（沒有可比較的科目）</option>';
  if (keep && subjects.includes(keep)) subjectSel.value = keep;
  const subject = subjectSel.value || subjects[0] || '';
  state.compare.subject = subject;

  const statsBox = $('#compareStats');
  const chartBox = $('#compareChart');
  const table = $('#compareTable');
  const matrixBox = $('#matrixTable');
  const countEl = $('#compareCount');

  if (!state.dataset || !subject) {
    statsBox.innerHTML = '';
    chartBox.innerHTML = '';
    table.innerHTML = '';
    matrixBox.innerHTML = '';
    countEl.textContent = '';
    return;
  }

  const displaySubject = subjectDisplay(subject, inScope);
  const students = inScope.filter((s) => getScore(s, subject) !== null);
  const passLine = state.settings.passLine;
  const tiers = state.settings.tiers;

  // 全年級（含全體）統計
  const overall = summarize(inScope.map((s) => getScore(s, subject)), passLine);

  // 依班級分組
  const byClass = new Map();
  for (const s of inScope) {
    if (!byClass.has(s.className)) byClass.set(s.className, []);
    byClass.get(s.className).push(s);
  }
  const classNames = [...byClass.keys()].sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));

  /* ---- 各班統計卡片 ---- */
  statsBox.className = 'compare-stats';
  statsBox.innerHTML = classNames.map((cn) => {
    const list = byClass.get(cn);
    const st = summarize(list.map((s) => getScore(s, subject)), passLine);
    const color = classColor(cn);
    return `<div class="class-card" style="border-left-color:${color}">
      <h3><span>${esc(cn)}</span><em>${list.length} 人</em></h3>
      <dl>
        <dt>平均</dt><dd>${fmt(st.mean)}</dd>
        <dt>中位數</dt><dd>${fmt(st.median)}</dd>
        <dt>最高 / 最低</dt><dd>${fmt(st.max)} / ${fmt(st.min)}</dd>
        <dt>標準差</dt><dd>${fmt(st.stdev)}</dd>
        ${state.settings.showPassRates ? `<dt>及格率</dt><dd>${pct(st.passRate)}</dd>` : ''}
        <dt>缺考</dt><dd>${st.absent} 人</dd>
      </dl>
    </div>`;
  }).join('');

  /* ---- 各班平均長條圖 ---- */
  const rows = classNames.map((cn) => {
    const st = summarize(byClass.get(cn).map((s) => getScore(s, subject)), passLine);
    return { label: cn, value: st.mean, color: classColor(cn) };
  });
  const overallRow = { label: '全年級', value: overall.mean, color: '#94a3b8' };

  const maxVal = Math.max(100, ...rows.map((r) => r.value || 0));
  const passPct = (passLine / maxVal) * 100;
  chartBox.className = 'bars';
  chartBox.innerHTML = `<h2>各班「${esc(displaySubject)}」平均比較</h2>`
    + [overallRow, ...rows].map((r) => {
      const w = r.value === null ? 0 : (r.value / maxVal) * 100;
      const t = tierOf(r.value, tiers);
      const col = t ? t.fg : r.color;
      return `<div class="bar-row">
        <div class="bar-label" title="${esc(r.label)}">${esc(r.label)}</div>
        <div class="bar-track">
          <div class="bar-fill" style="width:${w.toFixed(1)}%;background:${col}"></div>
          <div class="pass-line" style="left:${passPct.toFixed(2)}%" title="及格線 ${passLine} 分"></div>
        </div>
        <div class="bar-value" style="color:${col}">${fmt(r.value)}</div>
      </div>`;
    }).join('')
    + `<div class="bar-axis">橫軸為平均分數（滿分 100）。垂直虛線是及格線 ${passLine} 分，長條若明顯低於虛線代表該班這一科偏弱。</div>`;

  /* ---- 全年級排名名單 ---- */
  const sorted = sortedStudents(students, `sub:${subject}`, -1);
  // 該科在班內的名次
  const rankInClassForSubject = new Map();
  for (const cn of classNames) {
    const list = byClass.get(cn).filter((s) => getScore(s, subject) !== null);
    const r = sortedStudents(list, `sub:${subject}`, -1);
    let last = null; let lastRank = 0;
    r.forEach((s, i) => {
      const v = getScore(s, subject);
      const rank = (last !== null && v === last) ? lastRank : i + 1;
      rankInClassForSubject.set(s, rank);
      last = v; lastRank = rank;
    });
  }

  const mode = $('#selSortMode').value;
  let display = sorted;
  if (mode === 'class') {
    display = [...sorted].sort((a, b) => {
      const c = a.className.localeCompare(b.className, 'zh-Hant', { numeric: true });
      if (c !== 0) return c;
      return (getScore(b, subject) || 0) - (getScore(a, subject) || 0);
    });
  } else if (mode === 'id') {
    display = [...sorted].sort((a, b) => String(a.id).localeCompare(String(b.id), 'zh-Hant', { numeric: true }));
  }

  let html = '<thead><tr>'
    + '<th class="no-sort">全級排名</th>'
    + '<th class="no-sort">學號</th>'
    + '<th class="no-sort">姓名</th>'
    + '<th class="no-sort">班級</th>'
    + `<th class="no-sort">${esc(displaySubject)}</th>`
    + '<th class="no-sort">與全級平均差</th>'
    + '<th class="no-sort">班內排名</th>'
    + (state.settings.showTotals ? '<th class="no-sort">該生總分</th>' : '')
    + '</tr></thead><tbody>';

  if (display.length === 0) {
    html += `<tr><td colspan="${state.settings.showTotals ? 8 : 7}" style="padding:24px;color:var(--text-2)">目前範圍內沒有學生在「${esc(displaySubject)}」有分數。</td></tr>`;
  }

  display.forEach((s, i) => {
    const v = getScore(s, subject);
    const t = tierOf(v, tiers);
    const style = t ? `background:${t.bg};color:${t.fg};${t.bold ? 'font-weight:800;' : ''}` : '';
    const diff = overall.mean === null ? null : v - overall.mean;
    const diffTxt = diff === null ? '—' : (diff >= 0 ? '+' : '') + fmt(Math.round(diff * 10) / 10);
    const diffColor = diff === null ? '' : diff >= 0 ? 'color:#2e7d32' : 'color:#d32f2f';
    const cn = classColor(s.className);
    html += `<tr>
      <td class="num">${i + 1}</td>
      <td class="id">${esc(s.id)}</td>
      <td class="name">${esc(s.name)}</td>
      <td><span style="display:inline-block;width:8px;height:8px;border-radius:3px;background:${cn};margin-right:5px"></span>${esc(s.className)}</td>
      <td class="num cell-color" style="${style}">${fmt(v)}</td>
      <td class="num" style="${diffColor}">${diffTxt}</td>
      <td class="num">${rankInClassForSubject.get(s) ?? '—'}</td>
      ${state.settings.showTotals ? `<td class="num">${fmt(totalOf(s))}</td>` : ''}
    </tr>`;
  });

  // 統計頁尾（針對該科）
  const stats = summarize(students.map((s) => getScore(s, subject)), passLine);
  html += '</tbody><tfoot><tr>'
    + `<td colspan="4" style="text-align:left">全年級「${esc(displaySubject)}」統計（${students.length} 人）</td>`
    + `<td class="num">平均 ${fmt(stats.mean)}</td>`
    + `<td class="num">中位 ${fmt(stats.median)}</td>`
    + (state.settings.showPassRates
      ? `<td class="num">及格率 ${pct(stats.passRate)}</td>`
      : '<td class="num">—</td>')
    + (state.settings.showTotals ? `<td class="num">標準差 ${fmt(stats.stdev)}</td>` : '')
    + '</tr></tfoot>';

  table.innerHTML = html;
  countEl.textContent = `${displaySubject}　共 ${display.length} 人　全年級平均 ${fmt(overall.mean)}`
    + (state.settings.showPassRates ? `　及格率 ${pct(overall.passRate)}` : '');

  /* ---- 班級 × 科目 平均矩陣 ---- */
  // 注意：subjects 已在函式開頭取得，這裡直接沿用（不可重複宣告，否則整個模組會語法錯誤）
  let m = '<thead><tr><th class="row-head no-sort">班級</th>';
  for (const sub of subjects) m += `<th class="no-sort">${esc(subjectDisplay(sub, inScope))}</th>`;
  if (state.settings.showTotals) m += '<th class="no-sort">總分平均</th>';
  m += '</tr></thead><tbody>';

  for (const cn of classNames) {
    const list = byClass.get(cn);
    m += `<tr><td class="row-head">${esc(cn)}</td>`;
    for (const sub of subjects) {
      const st = summarize(list.map((s) => getScore(s, sub)), passLine);
      const t = tierOf(st.mean, tiers);
      const style = t ? `background:${t.bg};color:${t.fg}` : '';
      const title = `平均 ${fmt(st.mean)}${state.settings.showPassRates ? `　及格率 ${pct(st.passRate)}` : ''}`;
      m += `<td class="matrix-cell" style="${style}" title="${esc(title)}">${fmt(st.mean)}</td>`;
    }
    if (state.settings.showTotals) {
      const st = summarize(list.map(totalOf), passLine);
      m += `<td class="matrix-cell" title="總分平均">${fmt(st.mean)}</td>`;
    }
    m += '</tr>';
  }
  // 全年級平均列
  m += '<tr><td class="row-head" style="background:#e8eaf3">全年級</td>';
  for (const sub of subjects) {
    const st = summarize(inScope.map((s) => getScore(s, sub)), passLine);
    const t = tierOf(st.mean, tiers);
    const style = t ? `background:${t.bg};color:${t.fg};font-weight:800` : 'font-weight:800';
    m += `<td class="matrix-cell" style="${style}">${fmt(st.mean)}</td>`;
  }
  if (state.settings.showTotals) {
    m += `<td class="matrix-cell" style="font-weight:800">${fmt(summarize(inScope.map(totalOf), passLine).mean)}</td>`;
  }
  m += '</tr></tbody>';

  matrixBox.innerHTML = m;
}

/* ======================================================== 資料來源頁 === */

function renderData() {
  const ds = state.dataset;
  const summary = $('#dataSummary');
  const warnList = $('#warningList');
  const fileTable = $('#fileTable');

  if (!ds) {
    summary.innerHTML = '';
    warnList.innerHTML = '<p class="note">尚未載入資料。</p>';
    fileTable.innerHTML = '';
    $('#fileCount').textContent = '';
    $('#warnCount').textContent = '';
    return;
  }

  const s = ds.summary;
  summary.innerHTML = [
    chip(s.fileCount, '個檔案'),
    chip(s.okFileCount, '成功解析'),
    chip(s.studentCount, '位學生'),
    chip(ds.years.length, '個學年'),
    chip(ds.classes.length, '個班級'),
    chip(ds.subjects.length, '個科目'),
    chip(new Date(ds.loadedAt).toLocaleString('zh-TW'), '載入時間'),
  ].join('');

  // 警告
  if (!ds.warnings || ds.warnings.length === 0) {
    warnList.innerHTML = '<p class="note">沒有發現問題，所有檔案都順利解析。</p>';
    $('#warnCount').textContent = '';
  } else {
    const order = { error: 0, warn: 1, info: 2 };
    const sorted = [...ds.warnings].sort((a, b) => (order[a.level] ?? 9) - (order[b.level] ?? 9));
    warnList.innerHTML = `<div class="warn-list">${sorted.map((w) => `
      <div class="warn-item ${esc(w.level)}">
        <div class="wmsg">${esc(w.message)}<div class="wpath">${esc(w.path)}</div></div>
      </div>`).join('')}</div>`;
    const errCount = ds.warnings.filter((w) => w.level === 'error' || w.level === 'warn').length;
    $('#warnCount').textContent = `${ds.warnings.length} 則${errCount ? `（${errCount} 則需要注意）` : ''}`;
  }
  updateWarnBadge();

  // 檔案清單
  let html = '<thead><tr>'
    + '<th class="no-sort">狀態</th><th class="no-sort">學年</th><th class="no-sort">學段</th>'
    + '<th class="no-sort">年級</th><th class="no-sort">班級</th><th class="no-sort">人數</th>'
    + '<th class="no-sort">科目數</th><th class="no-sort">工作表</th><th class="no-sort">路徑</th>'
    + '</tr></thead><tbody>';

  if (ds.files.length === 0) {
    html += `<tr><td colspan="9" style="padding:22px;color:var(--text-2)">${ds.demo ? '這是內建示範資料，沒有實際檔案。' : '沒有檔案紀錄。'}</td></tr>`;
  }

  for (const f of ds.files) {
    const status = f.ok
      ? '<span style="color:#2e7d32">✔ 正常</span>'
      : `<span style="color:#d32f2f" title="${esc(f.error || '')}">✘ 失敗</span>`;
    html += `<tr>
      <td>${status}</td>
      <td>${esc(f.year)}</td>
      <td>${esc(f.term || '—')}</td>
      <td>${esc(f.grade)}</td>
      <td>${esc(f.className)}</td>
      <td class="num">${f.students}</td>
      <td class="num">${(f.subjects || []).length}</td>
      <td>${esc(f.sheetName || '—')}</td>
      <td style="text-align:left;font-family:var(--mono);font-size:11.5px;color:var(--text-2)">${esc(f.path)}</td>
    </tr>`;
  }
  html += '</tbody>';
  fileTable.innerHTML = html;
  $('#fileCount').textContent = `${ds.files.length} 個檔案`;

  // 副檔名被略過的
  if (ds.skipped && ds.skipped.length) {
    $('#fileCount').textContent += `（另有 ${ds.skipped.length} 個非成績檔被略過）`;
  }
}

/* ========================================================= 設定頁 === */

function renderSettings() {
  // 及格線
  $('#inpPassLine').value = state.settings.passLine;

  // 門檻編輯器
  const tiers = state.settings.tiers;
  $('#tierEditor').innerHTML = tiers.map((t, i) => `
    <div class="tier-row" data-i="${i}">
      <input type="number" class="t-min" value="${Number(t.min)}" min="0" max="100" step="1">
      <span class="dash">–</span>
      <input type="number" class="t-max" value="${t.max === Infinity || t.max === null || t.max === undefined ? '' : Number(t.max)}" placeholder="∞" min="0" max="100" step="1">
      <input type="color" class="t-bg" value="${normalizeColor(t.bg)}" title="背景顏色">
      <input type="text" class="t-label" value="${esc(t.label || '')}" placeholder="說明">
      <input type="color" class="t-fg" value="${normalizeColor(t.fg)}" title="文字顏色">
      <button class="icon-btn t-del" title="刪除這一層" type="button">✕</button>
    </div>`).join('');

  renderTierPreview();
  renderSubjectManager();

  // 儲存空間
  storageEstimate().then((e) => {
    const ds = state.dataset;
    const rows = [
      ['已載入檔案', ds ? `${ds.summary.fileCount} 個` : '—'],
      ['已載入學生', ds ? `${ds.summary.studentCount} 人` : '—'],
      ['資料來源', ds ? (ds.demo ? '內建示範資料' : (ds.sourceName || '本機資料夾')) : '—'],
      ['瀏覽器已用空間', e ? `${(e.usage / 1048576).toFixed(1)} MB / ${(e.quota / 1073741824).toFixed(1)} GB` : '不支援查詢'],
    ];
    $('#storageInfo').innerHTML = rows.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join('');
  });
}

function normalizeColor(c) {
  if (!c || typeof c !== 'string') return '#ffffff';
  const s = c.trim();
  if (/^#[0-9a-f]{6}$/i.test(s)) return s;
  if (/^#[0-9a-f]{3}$/i.test(s)) {
    return '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  }
  return '#ffffff';
}

function renderTierPreview() {
  const tiers = state.settings.tiers;
  const total = tiers.reduce((acc, t) => {
    const lo = Number(t.min);
    const hi = t.max === Infinity || t.max === null || t.max === undefined ? 100 : Number(t.max);
    return acc + Math.max(0, hi - lo);
  }, 0) || 1;
  $('#tierPreview').innerHTML = tiers.map((t) => {
    const lo = Number(t.min);
    const hi = t.max === Infinity || t.max === null || t.max === undefined ? 100 : Number(t.max);
    const w = Math.max(0, hi - lo + (t.max === Infinity ? 1 : 0)) / total * 100;
    return `<div style="width:${w.toFixed(2)}%;background:${esc(t.bg)};color:${esc(t.fg)}" title="${esc(t.label || '')} ${fmt(lo)}–${t.max === Infinity ? '100' : fmt(hi)}">${w > 7 ? esc(t.label || '') : ''}</div>`;
  }).join('');
}

function renderSubjectManager() {
  const ds = state.dataset;
  const box = $('#subjectManager');
  if (!ds) {
    box.innerHTML = '<p class="note">載入資料後才能調整科目欄位。</p>';
    return;
  }

  const disabled = new Set(state.settings.disabledSubjects || []);
  const forced = new Set(state.settings.forcedSubjects || []);
  const cols = ds.columns && ds.columns.length ? ds.columns : [];
  const roleLabel = { id: '學號欄', name: '姓名欄', subject: '科目', info: '備註資訊', derived: '總分名次', ignore: '空白欄' };

  if (cols.length === 0) {
    box.innerHTML = '<p class="note">這份資料沒有欄位資訊。</p>';
    return;
  }

  box.innerHTML = cols.map((c) => {
    const isFixed = c.role === 'id' || c.role === 'name';
    const isOn = forced.has(c.header) || (c.role === 'subject' && !disabled.has(c.header));
    return `<div class="subject-item">
      <input type="checkbox" data-header="${esc(c.header)}" ${isOn ? 'checked' : ''} ${isFixed ? 'disabled' : ''}>
      <span class="sname">${esc(subjectDisplay(c.header, baseStudents()))}</span>
      <span class="tag ${esc(c.role)}">${esc(roleLabel[c.role] || c.role)}</span>
    </div>`;
  }).join('');
  box.querySelectorAll('input[type=checkbox]').forEach((cb) => {
    cb.addEventListener('change', onSubjectToggle);
  });
}

function onSubjectToggle(e) {
  const cb = e.currentTarget;
  const header = cb.dataset.header;
  const ds = state.dataset;
  if (!ds) return;
  const col = (ds.columns || []).find((c) => c.header === header);
  const wasSubject = col && col.role === 'subject';

  const disabled = new Set(state.settings.disabledSubjects || []);
  const forced = new Set(state.settings.forcedSubjects || []);

  if (cb.checked) {
    disabled.delete(header);
    if (!wasSubject) forced.add(header);
  } else {
    forced.delete(header);
    if (wasSubject) disabled.add(header);
  }

  state.settings.disabledSubjects = [...disabled];
  state.settings.forcedSubjects = [...forced];
  saveSettings(state.settings);

  renderScores();
  renderCompare();
}

/* ========================================================== 篩選 UI === */

function renderFilters() {
  const ds = state.dataset;
  const yearSel = $('#selYear');
  const termSel = $('#selTerm');
  const gradeSel = $('#selGrade');

  if (!ds) {
    yearSel.innerHTML = '';
    termSel.innerHTML = '';
    gradeSel.innerHTML = '';
    $('#classChips').innerHTML = '';
    $('#classHint').textContent = '';
    return;
  }

  // 學年
  yearSel.innerHTML = ds.years.map((y) => `<option value="${esc(y)}">${esc(y)}</option>`).join('');
  if (!ds.years.includes(state.filters.year)) state.filters.year = ds.years[ds.years.length - 1] || '';
  yearSel.value = state.filters.year;

  // 該學年有的學段
  const terms = [...new Set(ds.students.filter((s) => s.year === state.filters.year).map((s) => s.term))];
  termSel.innerHTML = '<option value="">全部學段</option>'
    + terms.map((t) => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  if (state.filters.term && !terms.includes(state.filters.term)) state.filters.term = '';
  termSel.value = state.filters.term;

  // 年級
  const grades = [...new Set(ds.students
    .filter((s) => s.year === state.filters.year && (!state.filters.term || s.term === state.filters.term))
    .map((s) => s.grade))];
  gradeSel.innerHTML = '<option value="">全部年級</option>'
    + grades.map((g) => `<option value="${esc(g)}">${esc(g)}</option>`).join('');
  if (state.filters.grade && !grades.includes(state.filters.grade)) state.filters.grade = '';
  gradeSel.value = state.filters.grade;

  renderClassChips();
}

function renderClassChips() {
  const box = $('#classChips');
  const hint = $('#classHint');
  // 只掃一次基底資料，避免每個班級都重新過濾整份資料集
  const base = baseStudents();
  const names = [...new Set(base.map((s) => s.className))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));

  const countByClass = new Map();
  for (const s of base) countByClass.set(s.className, (countByClass.get(s.className) || 0) + 1);

  // 清掉已不在範圍內的班級
  for (const c of [...state.filters.classes]) {
    if (!names.includes(c)) state.filters.classes.delete(c);
  }

  box.innerHTML = names.map((n) => {
    const on = state.filters.classes.has(n);
    const col = classColor(n);
    return `<label class="chip ${on ? 'on' : ''}" data-class="${esc(n)}">
      <input type="checkbox" ${on ? 'checked' : ''}>
      <span class="swatch" style="background:${on ? '#fff' : col}"></span>${esc(n)}
      <span style="opacity:.6;font-size:11px">${countByClass.get(n) || 0}</span>
    </label>`;
  }).join('');

  hint.textContent = state.filters.classes.size === 0
    ? `（未勾選＝全部 ${names.length} 班）`
    : `（已選 ${state.filters.classes.size} / ${names.length} 班）`;

  box.querySelectorAll('.chip').forEach((el) => {
    el.addEventListener('click', (ev) => {
      ev.preventDefault();
      const n = el.dataset.class;
      if (state.filters.classes.has(n)) state.filters.classes.delete(n);
      else state.filters.classes.add(n);
      renderClassChips();
      refresh();
    });
  });
}

/* ========================================================== 主渲染 === */

/**
 * 更新「資料來源」分頁標籤上的問題數量徽章。
 *
 * 必須獨立於 renderData()：分頁內容是「延遲繪製」的（只有目前顯示的分頁會被重繪，
 * 以免每次改篩選都要重建全部四個分頁），但徽章在使用者還沒切到該分頁時就必須正確，
 * 否則載入了一份有問題的成績檔卻看不到任何提示。
 */
function updateWarnBadge() {
  const badge = $('#tabWarnBadge');
  const ds = state.dataset;
  const warnings = ds && ds.warnings ? ds.warnings : [];
  const needAttention = warnings.filter((w) => w.level === 'error' || w.level === 'warn').length;
  badge.hidden = needAttention === 0;
  if (needAttention > 0) {
    badge.textContent = needAttention;
    badge.className = `badge${warnings.some((w) => w.level === 'error') ? ' err' : ''}`;
  }
}

function refresh() {
  const has = !!state.dataset;
  $('#emptyState').hidden = has;
  renderFilters();
  updateWarnBadge();

  // 只有「目前顯示的分頁」會被重繪，這是刻意的：重建全部四個分頁會讓
  // 每一次調整篩選都變慢（尤其是上萬筆資料時的單科比較表）。
  // 切換分頁時，分頁按鈕的 click 處理器會再呼叫一次 refresh()，所以內容一定是最新的。
  // 因此：不要讀取「非目前顯示分頁」的 DOM，那裡可能是過期的內容。
  if (state.view === 'scores') renderScores();
  else if (state.view === 'compare') renderCompare();
  else if (state.view === 'data') renderData();
  else if (state.view === 'settings') renderSettings();
  renderStatus();
}

function renderStatus() {
  const ds = state.dataset;
  const el = $('#dataStatus');
  if (!ds) {
    el.textContent = '尚未載入資料';
    return;
  }
  const s = ds.summary;
  const when = new Date(ds.loadedAt).toLocaleString('zh-TW', { hour12: false });
  el.textContent = `${ds.demo ? '示範資料' : (ds.sourceName || '本機資料夾')}　·　`
    + `${s.yearCount} 學年、${s.classCount} 班、${s.studentCount} 位學生、${s.subjectCount} 科　·　載入於 ${when}`
    + (s.failedFileCount ? `　·　⚠ ${s.failedFileCount} 個檔案失敗` : '');
}

/* ====================================================== 載入流程 === */

function setLoading(on, text, sub) {
  const el = $('#loading');
  el.hidden = !on;
  if (text !== undefined) $('#loadingText').textContent = text;
  if (sub !== undefined) $('#loadingSub').textContent = sub;
  if (!on) $('#progressBar').style.width = '0%';
}

async function loadFromFiles(files, sourceName) {
  if (resolveImportReview) {
    showToast('請先完成目前的資料變更確認，再開始另一個匯入。');
    return;
  }
  if (state.abort) state.abort.abort();
  state.abort = new AbortController();

  setLoading(true, '正在讀取成績資料…', `共 ${files.length} 個項目`);
  const t0 = performance.now();

  try {
    const dataset = await buildDataset(files, {
      sourceName,
      signal: state.abort.signal,
      onProgress: (done, total, item) => {
        $('#progressBar').style.width = `${(done / total * 100).toFixed(1)}%`;
        $('#loadingSub').textContent = `${done} / ${total}　${item && item.path ? item.path.split('/').pop() : ''}`;
      },
    });
    if (state.dataset) {
      setLoading(false);
      const confirmed = await reviewDatasetImport(state.dataset, dataset);
      if (!confirmed) {
        showToast('已取消匯入；目前資料沒有變更。');
        return;
      }
    }
    applyDataset(dataset);
    const secs = ((performance.now() - t0) / 1000).toFixed(1);
    showToast(`載入完成：${dataset.summary.studentCount} 位學生、${dataset.summary.okFileCount} 個檔案（${secs} 秒）`);
    if (dataset.summary.failedFileCount > 0) {
      showToast(`有 ${dataset.summary.failedFileCount} 個檔案解析失敗，請到「資料來源」查看`, 5200);
    }
  } catch (err) {
    if (err && /取消/.test(err.message)) { showToast('已取消載入'); return; }
    console.error(err);
    showToast(`載入失敗：${err.message}`, 6000);
  } finally {
    setLoading(false);
    state.abort = null;
  }
}

function renderImportReport(previous, incoming) {
  const diff = compareDatasets(previous, incoming);
  const changedStudents = diff.changed.reduce((count, file) => count + file.changed.length, 0);
  const addedStudents = diff.added.reduce((count, file) => count + file.students, 0)
    + diff.changed.reduce((count, file) => count + file.added.length, 0);
  const removedStudents = diff.removed.reduce((count, file) => count + file.students, 0)
    + diff.changed.reduce((count, file) => count + file.removed.length, 0);

  const fileSummary = [
    `${diff.added.length} 個新增檔案`,
    `${diff.removed.length} 個移除檔案`,
    `${diff.changed.length} 個內容變更檔案`,
    `${diff.unchangedCount} 個未變更檔案`,
  ];
  const studentSummary = [
    `${addedStudents} 位新增學生`,
    `${removedStudents} 位移除學生`,
    `${changedStudents} 位資料變更`,
  ];
  const sections = [];
  for (const file of diff.added) {
    sections.push(`<li><b>新增檔案</b>：${esc(file.file)}（${file.students} 位學生）</li>`);
  }
  for (const file of diff.removed) {
    sections.push(`<li><b>移除檔案</b>：${esc(file.file)}（${file.students} 位學生）</li>`);
  }
  for (const file of diff.changed) {
    const details = [];
    for (const student of file.added.slice(0, 5)) {
      details.push(`<li>新增學生：${esc(student.identity)}</li>`);
    }
    for (const student of file.removed.slice(0, 5)) {
      details.push(`<li>移除學生：${esc(student.identity)}</li>`);
    }
    for (const student of file.changed.slice(0, 5)) {
      const fields = student.fields.slice(0, 6).map((change) =>
        `${esc(change.field)}：${esc(change.oldValue)} → ${esc(change.newValue)}`).join('；');
      details.push(`<li>${esc(student.identity)}：${fields}`
        + (student.fields.length > 6 ? `；另有 ${student.fields.length - 6} 個欄位` : '') + '</li>');
    }
    const extraStudents = Math.max(0, file.added.length - 5)
      + Math.max(0, file.removed.length - 5)
      + Math.max(0, file.changed.length - 5);
    const peopleChanges = [
      file.added.length ? `新增 ${file.added.length} 位` : '',
      file.removed.length ? `移除 ${file.removed.length} 位` : '',
      file.changed.length ? `修改 ${file.changed.length} 位` : '',
      file.addedSubjects.length ? `新增欄位 ${file.addedSubjects.join('、')}` : '',
      file.removedSubjects.length ? `移除欄位 ${file.removedSubjects.join('、')}` : '',
      ...file.metadataChanges.map((change) =>
        `${change.field} ${change.oldValue} → ${change.newValue}`),
      file.oldSize !== file.newSize && Number.isFinite(file.oldSize) && Number.isFinite(file.newSize)
        ? `檔案大小 ${file.oldSize} → ${file.newSize} bytes` : '',
    ].filter(Boolean).join('、');
    sections.push(`<li><b>內容變更</b>：${esc(file.file)}（${esc(peopleChanges || '檔案內容有變更')}）`
      + (details.length ? `<ul>${details.join('')}${extraStudents > 0 ? `<li>另有 ${extraStudents} 位學生項目有變更</li>` : ''}</ul>` : '')
      + '</li>');
  }

  const changeList = sections.length
    ? `<ul class="import-change-list">${sections.join('')}</ul>`
    : '<p class="import-no-changes">沒有偵測到檔案或學生資料變動。</p>';
  $('#importReviewSummary').innerHTML = `<p>${fileSummary.map(esc).join('　·　')}</p>`
    + `<p>${studentSummary.map(esc).join('　·　')}</p>`;
  $('#importReviewDetails').innerHTML = changeList;
  return diff;
}

function reviewDatasetImport(previous, incoming) {
  renderImportReport(previous, incoming);
  $('#importReview').hidden = false;
  $('#btnConfirmImport').focus();
  return new Promise((resolve) => { resolveImportReview = resolve; });
}

function settleImportReview(confirmed) {
  if (!resolveImportReview) return;
  const resolve = resolveImportReview;
  resolveImportReview = null;
  $('#importReview').hidden = true;
  resolve(confirmed);
}

function normalizeConductLabels(dataset) {
  if (!dataset) return;
  for (const column of dataset.columns || []) {
    if (column.header === '最後操行') column.header = '操行總分';
  }
  for (const student of dataset.students || []) {
    for (const record of [student.info, student.cells]) {
      if (!record || !Object.prototype.hasOwnProperty.call(record, '最後操行')) continue;
      if (!Object.prototype.hasOwnProperty.call(record, '操行總分')) {
        record['操行總分'] = record['最後操行'];
      }
      delete record['最後操行'];
    }
  }
}

function applyDataset(dataset) {
  normalizeConductLabels(dataset);
  state.dataset = dataset;
  // 預設篩選：最新學年 + 該學年第一個學段 + 全部年級 + 全部班級
  state.filters.year = dataset.years[dataset.years.length - 1] || '';
  const terms = [...new Set(dataset.students.filter((s) => s.year === state.filters.year).map((s) => s.term))];
  state.filters.term = terms[0] || '';
  state.filters.grade = '';
  state.filters.classes = new Set();
  state.filters.search = '';
  $('#searchBox').value = '';
  state.sort.scores = { key: '__rank', dir: 1 };
  state.compare.subject = '';
  state.compare.scope = 'selected';

  refresh();
  saveDataset(dataset).catch((e) => {
    console.warn('無法保存資料集：', e);
    showToast('資料已載入，但無法保存到瀏覽器（下次需要重新選資料夾）', 5000);
  });
}

/* ---- 拖放資料夾 ---- */

async function entriesFromDataTransfer(dt) {
  const out = [];
  const items = dt.items ? [...dt.items] : [];
  const entries = items
    .filter((i) => i.kind === 'file')
    .map((i) => (i.webkitGetAsEntry ? i.webkitGetAsEntry() : null))
    .filter(Boolean);

  // 瀏覽器不支援 webkitGetAsEntry 時，退回單純的檔案清單
  if (entries.length === 0) {
    return [...(dt.files || [])].map((f) => ({ file: f, path: f.name }));
  }

  async function readAllEntries(reader) {
    const acc = [];
    for (;;) {
      const batch = await new Promise((res, rej) => reader.readEntries(res, rej));
      if (!batch.length) break;
      acc.push(...batch);
      if (acc.length > 20000) break; // 安全上限
    }
    return acc;
  }

  async function walk(entry, prefix) {
    if (entry.isFile) {
      const file = await new Promise((res, rej) => entry.file(res, rej));
      out.push({ file, path: prefix + entry.name });
    } else if (entry.isDirectory) {
      const children = await readAllEntries(entry.createReader());
      for (const child of children) await walk(child, `${prefix}${entry.name}/`);
    }
  }

  for (const e of entries) await walk(e, '');
  return out;
}

/* ============================================== 匯出與列印 === */

function downloadText(filename, text, mime = 'text/csv;charset=utf-8') {
  const blob = new Blob(['\ufeff', text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function csvEscape(v) {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function exportScoresCsv() {
  if (!state.dataset) return;
  const cols = scoreColumns();
  const list = sortedStudents(currentStudents(), state.sort.scores.key, state.sort.scores.dir);
  const header = cols.map((c) => c.label);

  const rows = list.map((s) => cols.map((c) => {
    if (c.key === 'id') return s.id;
    if (c.key === 'name') return s.name;
    if (c.key === 'className') return s.className;
    if (c.key === '__rank') {
      const r = rankOf(s);
      return r === null ? '' : r;
    }
    if (c.key === '__total') {
      const v = totalOf(s);
      return v === null ? '' : v;
    }
    if (c.key === '__avg') {
      const v = avgOf(s);
      return v === null ? '' : v;
    }
    if (c.key.startsWith('sub:')) {
      const v = getScore(s, c.key.slice(4));
      return v === null ? '缺考' : v;
    }
    if (c.key.startsWith('info:')) {
      const v = s.info ? s.info[c.key.slice(5)] : '';
      return v === undefined || v === null ? '' : v;
    }
    return '';
  }));

  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
  const f = state.filters;
  const name = `成績表_${f.year || '全部'}${f.term ? '_' + f.term : ''}${f.grade ? '_' + f.grade : ''}.csv`;
  downloadText(name, csv);
  showToast(`已匯出 ${list.length} 筆資料`);
}

function exportHeading(classLabel) {
  const parts = [
    state.filters.year || '全部學年',
    classLabel || state.filters.grade || '全部班級',
    state.filters.term || '全部學段',
    '學生成績',
  ];
  return {
    title: parts.join(' '),
    date: `匯出日期：${new Date().toLocaleDateString('zh-Hant', {
      year: 'numeric', month: '2-digit', day: '2-digit',
    })}`,
  };
}

function preparePdfRoot() {
  const root = $('#pdfExport');
  root.replaceChildren();
  document.body.classList.add('pdf-exporting');
  window.addEventListener('afterprint', () => {
    root.replaceChildren();
    document.body.classList.remove('pdf-exporting');
  }, { once: true });
  return root;
}

function printScores(allClasses = false) {
  if (!state.dataset) {
    showToast('請先載入成績資料，再匯出 PDF。');
    return;
  }
  const scope = baseStudents();
  const selectedClasses = state.filters.classes;
  const search = state.filters.search.trim().toLowerCase();
  const included = scope.filter((student) => {
    if (!allClasses && selectedClasses.size && !selectedClasses.has(student.className)) return false;
    if (search && !`${student.id} ${student.name}`.toLowerCase().includes(search)) return false;
    return true;
  });
  const classNames = [...new Set(included.map((student) => student.className))]
    .sort((a, b) => a.localeCompare(b, 'zh-Hant', { numeric: true }));
  if (!classNames.length) {
    showToast('目前篩選範圍沒有學生可匯出。');
    return;
  }

  const root = preparePdfRoot();
  const previousClasses = state.filters.classes;
  const previousSort = state.sort.scores;
  try {
    state.sort.scores = { key: 'id', dir: 1 };
    for (const className of classNames) {
      state.filters.classes = new Set([className]);
      renderScores();
      const page = document.createElement('section');
      page.className = 'pdf-class-page';
      const heading = exportHeading(className);
      page.innerHTML = `<header class="pdf-page-heading"><h1>${esc(heading.title)}</h1><span>${esc(heading.date)}</span></header>`;
      const table = $('#scoresTable').cloneNode(true);
      table.classList.add('pdf-score-table');
      const rowCount = Math.max(1, table.rows.length);
      const fontSize = Math.min(7, Math.max(3, (650 / rowCount - 1.5) / 1.05));
      table.style.setProperty('--pdf-font-size', `${fontSize}px`);
      page.append(table);
      root.append(page);
    }
  } finally {
    state.filters.classes = previousClasses;
    state.sort.scores = previousSort;
    renderScores();
  }
  window.print();
}

function printCompare() {
  if (!state.dataset) {
    showToast('請先載入成績資料，再匯出 PDF。');
    return;
  }
  const students = state.compare.scope === 'grade' ? baseStudents() : currentStudents();
  const classes = [...new Set(students.map((student) => student.className))];
  const classLabel = classes.length === 1
    ? classes[0]
    : (state.filters.grade ? `${state.filters.grade}全部班級` : '全部班級');
  const root = preparePdfRoot();
  const heading = exportHeading(classLabel);
  const title = document.createElement('header');
  title.className = 'pdf-page-heading';
  title.innerHTML = `<h1>${esc(heading.title)}</h1><span>${esc(heading.date)}</span>`;
  root.append(title);
  const content = $('#view-compare').cloneNode(true);
  content.id = 'pdfCompareContent';
  content.classList.add('pdf-compare-content');
  root.append(content);
  window.print();
}

function exportCompareCsv() {
  if (!state.dataset) return;
  const subject = state.compare.subject;
  if (!subject) { showToast('請先選擇科目'); return; }
  const inScope = state.compare.scope === 'grade' ? baseStudents() : currentStudents();
  const displaySubject = subjectDisplay(subject, inScope);
  const students = inScope.filter((s) => getScore(s, subject) !== null);
  const sorted = sortedStudents(students, `sub:${subject}`, -1);
  const overall = summarize(inScope.map((s) => getScore(s, subject)), state.settings.passLine);

  const header = ['全級排名', '學號', '姓名', '班級', displaySubject, '與全級平均差'];
  if (state.settings.showTotals) header.push('該生總分');
  const rows = sorted.map((s, i) => {
    const v = getScore(s, subject);
    const diff = overall.mean === null ? '' : Math.round((v - overall.mean) * 10) / 10;
    const row = [i + 1, s.id, s.name, s.className, v, diff];
    if (state.settings.showTotals) row.push(totalOf(s) ?? '');
    return row;
  });

  const csv = [header, ...rows].map((r) => r.map(csvEscape).join(',')).join('\r\n');
  downloadText(`單科排名_${displaySubject}_${state.filters.year || ''}${state.filters.term || ''}.csv`, csv);
  showToast(`已匯出「${displaySubject}」${sorted.length} 筆`);
}

/* ======================================================== 事件綁定 === */

function bindEvents() {
  /* --- 分頁 --- */
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
      document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
      tab.classList.add('active');
      state.view = tab.dataset.view;
      $(`#view-${state.view}`).classList.add('active');
      refresh();
    });
  });

  /* --- 載入資料 --- */
  const openPicker = () => $('#folderInput').click();
  $('#btnLoadFolder').addEventListener('click', openPicker);
  $('#btnEmptyLoad').addEventListener('click', openPicker);
  $('#btnReload').addEventListener('click', () => {
    showToast('基於瀏覽器安全限制，請重新選擇一次資料夾（已載入的資料仍在，不會消失）', 4200);
    setTimeout(openPicker, 150);
  });

  $('#folderInput').addEventListener('change', (e) => {
    const files = [...e.target.files];
    if (files.length === 0) return;
    const root = files[0].webkitRelativePath ? files[0].webkitRelativePath.split('/')[0] : '本機資料夾';
    loadFromFiles(files, root);
    e.target.value = ''; // 允許重選同一個資料夾
  });

  $('#btnLoadDemo').addEventListener('click', () => {
    const ds = buildDemoDataset();
    applyDataset(ds);
    saveDataset(ds).catch(() => {});
    showToast('已載入內建示範資料（3 個學年、6 個班級）。這不是你的真實資料。', 4600);
  });
  $('#btnEmptyDemo').addEventListener('click', () => $('#btnLoadDemo').click());

  /* --- 拖放 --- */
  const app = document.querySelector('.app');
  let dragDepth = 0;
  window.addEventListener('dragenter', (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    dragDepth++;
    document.body.style.outline = '3px dashed var(--primary)';
    document.body.style.outlineOffset = '-8px';
  });
  window.addEventListener('dragover', (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) e.preventDefault();
  });
  window.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) { document.body.style.outline = ''; document.body.style.outlineOffset = ''; }
  });
  window.addEventListener('drop', async (e) => {
    if (!e.dataTransfer || ![...e.dataTransfer.types].includes('Files')) return;
    e.preventDefault();
    dragDepth = 0;
    document.body.style.outline = '';
    document.body.style.outlineOffset = '';
    setLoading(true, '正在讀取拖入的檔案…', '');
    let entries;
    try {
      entries = await entriesFromDataTransfer(e.dataTransfer);
    } catch (err) {
      setLoading(false);
      showToast(`讀取拖放的檔案失敗：${err.message}`);
      return;
    }
    setLoading(false);
    if (entries.length === 0) { showToast('拖入的內容裡沒有檔案'); return; }
    const root = entries[0].path ? entries[0].path.split('/')[0] : '拖放的資料';
    await loadFromFiles(entries, root);
  });

  $('#btnCancelLoad').addEventListener('click', () => {
    if (state.abort) state.abort.abort();
  });

  /* --- 篩選 --- */
  $('#selYear').addEventListener('change', (e) => {
    state.filters.year = e.target.value;
    state.filters.term = '';
    state.filters.classes.clear();
    refresh();
  });
  $('#selTerm').addEventListener('change', (e) => {
    state.filters.term = e.target.value;
    state.filters.classes.clear();
    refresh();
  });
  $('#selGrade').addEventListener('change', (e) => {
    state.filters.grade = e.target.value;
    state.filters.classes.clear();
    refresh();
  });
  let searchTimer = null;
  $('#searchBox').addEventListener('input', (e) => {
    clearTimeout(searchTimer);
    const v = e.target.value;
    searchTimer = setTimeout(() => {
      state.filters.search = v;
      refresh();
    }, 180);
  });
  $('#btnAllClasses').addEventListener('click', () => {
    state.filters.classes = new Set(classesInScope());
    refresh();
  });
  $('#btnClearClasses').addEventListener('click', () => {
    state.filters.classes = new Set();
    refresh();
  });

  /* --- 成績總表：點欄排序 --- */
  $('#scoresTable').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-key]');
    if (!th) return;
    const key = th.dataset.key;
    if (state.sort.scores.key === key) {
      state.sort.scores.dir = -state.sort.scores.dir;
    } else {
      state.sort.scores.key = key;
      // 數值欄預設由高到低，文字欄預設由小到大
      state.sort.scores.dir = /^(sub:|__total|__avg)/.test(key) ? -1 : 1;
      if (key === '__rank') state.sort.scores.dir = 1;
    }
    renderScores();
  });

  $('#chkRecompute').addEventListener('change', (e) => {
    state.settings.recomputeTotals = e.target.checked;
    saveSettings(state.settings);
    renderScores();
  });
  $('#chkColorRow').addEventListener('change', (e) => {
    state.settings.colorWholeRow = e.target.checked;
    saveSettings(state.settings);
    renderScores();
  });

  $('#btnExportCsv').addEventListener('click', exportScoresCsv);
  $('#btnExportPdfScores').addEventListener('click', () => printScores());
  $('#btnExportPdfAllClasses').addEventListener('click', () => printScores(true));
  $('#btnExportPdfCompare').addEventListener('click', printCompare);
  document.querySelectorAll('[data-display-setting]').forEach((input) => {
    input.addEventListener('change', () => {
      const key = input.dataset.displaySetting;
      state.settings[key] = input.checked;
      document.querySelectorAll(`[data-display-setting="${key}"]`)
        .forEach((toggle) => { toggle.checked = input.checked; });
      saveSettings(state.settings);
      refresh();
    });
  });
  $('#btnConfirmImport').addEventListener('click', () => settleImportReview(true));
  $('#btnCancelImport').addEventListener('click', () => settleImportReview(false));
  $('#importReview').addEventListener('click', (event) => {
    if (event.target === $('#importReview')) settleImportReview(false);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && resolveImportReview) settleImportReview(false);
  });

  /* --- 比較頁 --- */
  $('#selSubject').addEventListener('change', (e) => {
    state.compare.subject = e.target.value;
    renderCompare();
  });
  $('#selSortMode').addEventListener('change', renderCompare);
  $('#selScope').addEventListener('change', (e) => {
    state.compare.scope = e.target.value;
    renderCompare();
  });
  $('#btnExportCompare').addEventListener('click', exportCompareCsv);

  /* --- 資料來源頁 --- */
  const clearData = async () => {
    if (!confirm('確定要清除已載入的成績資料嗎？（Excel 原始檔不會受影響）')) return;
    await clearDataset();
    state.dataset = null;
    refresh();
    showToast('已清除載入的資料');
  };
  $('#btnClearData').addEventListener('click', clearData);
  $('#btnClearData2').addEventListener('click', clearData);

  /* --- 設定頁 --- */
  $('#inpPassLine').addEventListener('change', (e) => {
    const v = Math.max(0, Math.min(100, Number(e.target.value) || 0));
    e.target.value = v;
    state.settings.passLine = v;
    saveSettings(state.settings);
    refresh();
  });

  $('#tierEditor').addEventListener('input', (e) => {
    const row = e.target.closest('.tier-row');
    if (!row) return;
    const i = Number(row.dataset.i);
    const t = state.settings.tiers[i];
    if (!t) return;

    if (e.target.classList.contains('t-min')) t.min = Number(e.target.value) || 0;
    else if (e.target.classList.contains('t-max')) {
      t.max = e.target.value === '' ? Infinity : Number(e.target.value);
    } else if (e.target.classList.contains('t-bg')) t.bg = e.target.value;
    else if (e.target.classList.contains('t-fg')) t.fg = e.target.value;
    else if (e.target.classList.contains('t-label')) t.label = e.target.value;

    saveSettings(state.settings);
    renderTierPreview();
  });
  // 顏色或區間改完才重繪表格，避免打字時一直重畫
  $('#tierEditor').addEventListener('change', () => {
    renderScores();
    renderCompare();
  });
  $('#tierEditor').addEventListener('click', (e) => {
    if (!e.target.classList.contains('t-del')) return;
    const row = e.target.closest('.tier-row');
    const i = Number(row.dataset.i);
    if (state.settings.tiers.length <= 1) { showToast('至少要保留一層'); return; }
    state.settings.tiers.splice(i, 1);
    saveSettings(state.settings);
    renderSettings();
    renderScores();
    renderCompare();
  });
  $('#btnAddTier').addEventListener('click', () => {
    const tiers = state.settings.tiers;
    const last = tiers[tiers.length - 1];
    const lo = last && Number.isFinite(Number(last.max)) ? Number(last.max) + 0.01 : (last ? Number(last.min) + 10 : 0);
    tiers.push({ min: Math.round(lo), max: Infinity, bg: '#e3f2fd', fg: '#0d47a1', label: '新層級' });
    // 讓新層級真的涵蓋到 ∞：把前一層的上界收到新層級下界之前
    if (tiers.length >= 2) {
      const prev = tiers[tiers.length - 2];
      if (prev.max === Infinity) prev.max = Math.round(lo) - 0.01;
    }
    saveSettings(state.settings);
    renderSettings();
    renderScores();
  });
  $('#btnResetTiers').addEventListener('click', () => {
    state.settings.tiers = structuredClone(DEFAULT_TIERS);
    saveSettings(state.settings);
    renderSettings();
    renderScores();
    renderCompare();
    showToast('顏色門檻已回復預設');
  });
  $('#btnPresetFive').addEventListener('click', () => {
    const pass = state.settings.passLine;
    state.settings.tiers = [
      { min: 0, max: pass - 0.01, bg: '#fde7e9', fg: '#c62828', label: '不及格', bold: true },
      { min: pass, max: pass + 9.99, bg: '#fff3e0', fg: '#e65100', label: '60–69' },
      { min: pass + 10, max: pass + 19.99, bg: '#fffde7', fg: '#9e7c00', label: '70–79' },
      { min: pass + 20, max: pass + 29.99, bg: '#e8f5e9', fg: '#2e7d32', label: '80–89' },
      { min: pass + 30, max: Infinity, bg: '#c8e6c9', fg: '#1b5e20', label: '90+', bold: true },
    ];
    saveSettings(state.settings);
    renderSettings();
    renderScores();
    renderCompare();
    showToast('已套用五色分層');
  });

  $('#btnResetAll').addEventListener('click', () => {
    if (!confirm('確定要把所有設定（門檻、及格線、科目）回復預設嗎？')) return;
    resetSettings();
    state.settings = structuredClone(DEFAULT_SETTINGS);
    document.querySelectorAll('[data-display-setting]').forEach((input) => {
      input.checked = !!state.settings[input.dataset.displaySetting];
    });
    renderSettings();
    refresh();
    showToast('已回復預設設定');
  });

  /* --- 鍵盤：Esc 關閉空狀態提示 --- */
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.dataset) $('#emptyState').hidden = true;
  });
}

/* ============================================================ 啟動 === */

async function init() {
  bindEvents();

  // 把設定值套到 UI
  $('#chkRecompute').checked = !!state.settings.recomputeTotals;
  $('#chkColorRow').checked = !!state.settings.colorWholeRow;
  document.querySelectorAll('[data-display-setting]').forEach((input) => {
    input.checked = !!state.settings[input.dataset.displaySetting];
  });
  $('#inpPassLine').value = state.settings.passLine;

  // 網址參數：?demo=1 直接載入示範資料、?view=compare 直接切到指定分頁
  // （方便做展示、截圖與自動化測試）
  const params = new URLSearchParams(location.search);
  const wantDemo = params.get('demo') === '1';
  const wantView = params.get('view');

  if (!wantDemo) {
    // 嘗試還原上次載入的資料
    const saved = await loadDataset();
    if (saved && saved.students && saved.students.length) {
      normalizeConductLabels(saved);
      state.dataset = saved;
      state.filters.year = saved.years[saved.years.length - 1] || '';
      const terms = [...new Set(saved.students.filter((s) => s.year === state.filters.year).map((s) => s.term))];
      state.filters.term = terms[0] || '';
      refresh();
      showToast('已還原上次載入的成績資料。若要更新，請重新選擇資料夾。', 4200);
    } else {
      refresh();
    }
  } else {
    applyDataset(buildDemoDataset());
    if (params.get('term')) state.filters.term = params.get('term');
    if (params.get('grade')) state.filters.grade = params.get('grade');
    refresh();
  }

  if (wantView && ['scores', 'compare', 'data', 'settings'].includes(wantView)) {
    const tab = document.querySelector(`.tab[data-view="${wantView}"]`);
    if (tab) tab.click();
  }

  // 註冊 Service Worker（離線可用）。file:// 開啟時不支援，直接略過。
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((e) => {
      console.warn('Service Worker 註冊失敗：', e);
    });
  }

  console.log('%c學生成績查詢系統 已啟動', 'color:#4f46e5;font-weight:700');
  console.log('若載入有問題，請在「資料來源」頁查看每一檔案的解析結果。');
}

window.addEventListener('error', (e) => {
  console.error(e.error || e.message);
});

init();
