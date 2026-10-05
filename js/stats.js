/**
 * stats.js — 統計與顏色工具
 */

/** 平均值；沒有有效值回傳 null。 */
export function mean(values) {
  const v = values.filter((x) => x !== null && x !== undefined && Number.isFinite(x));
  if (v.length === 0) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

/** 中位數。 */
export function median(values) {
  const v = values.filter((x) => x !== null && x !== undefined && Number.isFinite(x)).slice().sort((a, b) => a - b);
  if (v.length === 0) return null;
  const mid = Math.floor(v.length / 2);
  return v.length % 2 ? v[mid] : (v[mid - 1] + v[mid]) / 2;
}

/** 母體標準差（成績分析通常看母體，因為就是「這一班」的全體）。 */
export function stdev(values) {
  const v = values.filter((x) => x !== null && x !== undefined && Number.isFinite(x));
  if (v.length < 2) return null;
  const m = mean(v);
  const variance = v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length;
  return Math.sqrt(variance);
}

export function min(values) {
  const v = values.filter((x) => x !== null && x !== undefined && Number.isFinite(x));
  return v.length ? Math.min(...v) : null;
}

export function max(values) {
  const v = values.filter((x) => x !== null && x !== undefined && Number.isFinite(x));
  return v.length ? Math.max(...v) : null;
}

/** 及格率（分母只算有分數的人）。 */
export function passRate(values, passLine) {
  const v = values.filter((x) => x !== null && x !== undefined && Number.isFinite(x));
  if (v.length === 0) return null;
  return v.filter((x) => x >= passLine).length / v.length;
}

/**
 * 完整統計摘要。
 * @param {Array<number|null>} values
 * @param {number} passLine
 */
export function summarize(values, passLine) {
  const v = values.filter((x) => x !== null && x !== undefined && Number.isFinite(x));
  const m = mean(v);
  const sd = stdev(v);
  return {
    count: v.length,
    absent: values.length - v.length,
    mean: m,
    median: median(v),
    stdev: sd,
    min: min(v),
    max: max(v),
    passRate: passRate(v, passLine),
    // 變異係數：可以看出這一科的分數是「普遍接近」還是「落差很大」
    cv: m && sd !== null && m !== 0 ? sd / Math.abs(m) : null,
  };
}

/** 把數值依門檻分層，回傳對應的 tier 物件（找不到回傳 null）。 */
export function tierOf(value, tiers) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  for (const t of tiers) {
    const lo = Number(t.min);
    const hi = t.max === null || t.max === undefined || t.max === Infinity ? Infinity : Number(t.max);
    if (value >= lo && value <= hi) return t;
  }
  // 門檻有空隙時（例如使用者只設 0-59 和 90+），退回「最接近的下界」
  let fallback = null;
  for (const t of tiers) {
    const lo = Number(t.min);
    if (value >= lo && (!fallback || lo > Number(fallback.min))) fallback = t;
  }
  return fallback;
}

/** 數字格式化：整數不顯示小數，其餘最多兩位。 */
export function fmt(v, digits = 2) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(digits).replace(/\.?0+$/, '');
}

/** 百分比格式化。 */
export function pct(v, digits = 1) {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—';
  return `${(v * 100).toFixed(digits)}%`;
}

/**
 * 產生分佈直方圖的區間（固定 0-100 切成 10 段，方便跨科目互相比較）。
 */
export function histogram(values, bucketSize = 10) {
  const buckets = [];
  for (let lo = 0; lo < 100; lo += bucketSize) {
    buckets.push({ lo, hi: lo + bucketSize - (bucketSize === 10 ? 0.01 : 0), count: 0 });
  }
  for (const v of values) {
    if (v === null || v === undefined || !Number.isFinite(v)) continue;
    let i = Math.floor(v / bucketSize);
    if (i < 0) i = 0;
    if (i >= buckets.length) i = buckets.length - 1;
    buckets[i].count++;
  }
  return buckets;
}
