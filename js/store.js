/**
 * store.js — 資料保存
 * ---------------------------------------------------------------------------
 * 資料集（可能上萬筆）存在 IndexedDB，設定（門檻、及格線）存在 localStorage。
 *
 * 為什麼要存起來：浏览器基於安全理由，每次重新整理後都不能自動重讀你的資料夾，
 * 所以我們把「已經解析好的」資料留在本機，下次打開就能直接看，不必重新選資料夾。
 * 注意：資料只存在你自己的電腦與瀏覽器裡，不會上傳到任何地方。
 */

const DB_NAME = 'grade-app';
const DB_VERSION = 1;
const STORE = 'dataset';
const KEY = 'current';

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('此瀏覽器不支援 IndexedDB，資料將不會被保存。'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
<<<<<<< HEAD
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
=======
    req.onsuccess = () => resolve(req.result);
>>>>>>> e1b79721076a5dbb3de0fe79d448fb57b1aa9069
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(mode, fn) {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    const store = t.objectStore(STORE);
    const req = fn(store);
    t.oncomplete = () => resolve(req ? req.result : undefined);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error('資料庫交易中止'));
  }));
}

/** 儲存資料集。 */
export async function saveDataset(dataset) {
  return tx('readwrite', (store) => store.put(dataset, KEY));
}

/** 讀取資料集；沒有則回傳 null。 */
export async function loadDataset() {
  try {
    const v = await tx('readonly', (store) => store.get(KEY));
    return v || null;
  } catch {
    return null;
  }
}

/** 清空資料集。 */
export async function clearDataset() {
  return tx('readwrite', (store) => store.delete(KEY));
}

/** 估算已使用的儲存空間（若瀏覽器支援）。 */
export async function storageEstimate() {
  if (navigator.storage && navigator.storage.estimate) {
    try {
      const e = await navigator.storage.estimate();
      return { usage: e.usage || 0, quota: e.quota || 0 };
    } catch { /* 忽略 */ }
  }
  return null;
}

/* --------------------------------------------------------------- 設定 --- */

const SETTINGS_KEY = 'grade-app-settings-v1';

/** 預設分數門檻（可被使用者在設定頁修改）。 */
export const DEFAULT_TIERS = [
  { min: 0, max: 59.99, bg: '#fde7e9', fg: '#c62828', label: '不及格', bold: true },
  { min: 60, max: 69.99, bg: '#fff3e0', fg: '#e65100', label: '尚可' },
  { min: 70, max: 79.99, bg: '#fffde7', fg: '#9e7c00', label: '中等' },
  { min: 80, max: 89.99, bg: '#e8f5e9', fg: '#2e7d32', label: '良好' },
  { min: 90, max: Infinity, bg: '#c8e6c9', fg: '#1b5e20', label: '優秀', bold: true },
];

export const DEFAULT_SETTINGS = {
  passLine: 60,
  tiers: DEFAULT_TIERS,
  subjectOrder: [],       // 手動排序的科目（優先於自動排序）
  disabledSubjects: [],   // 被排除、不當成科目的欄位
  forcedSubjects: [],     // 被強制當成科目的欄位
  recomputeTotals: false, // 是否用各科加總取代檔案中的總分
<<<<<<< HEAD
  colorWholeRow: false,   // 是否整列上色
  showTotals: false,      // 是否顯示總分相關欄位
  showPassRates: false,   // 是否顯示及格率（而不只分數格）
  showAverages: false,   // 是否顯示成績表下方的平均列
  showConductComponents: false, // 是否顯示基本操行與調整操行原欄
=======
  colorWholeRow: false,   // 是否整列上色（而不只分數格）
>>>>>>> e1b79721076a5dbb3de0fe79d448fb57b1aa9069
};

/** 讀取設定（與預設值合併，容忍舊版缺少欄位）。 */
export function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return structuredClone(DEFAULT_SETTINGS);
    const parsed = JSON.parse(raw);
    const merged = { ...structuredClone(DEFAULT_SETTINGS), ...parsed };
    // tiers 內的 Infinity 沒辦法用 JSON 存，讀回來要還原
    if (Array.isArray(merged.tiers)) {
      merged.tiers = merged.tiers.map((t) => {
        const rawMax = t.max;
        const isInfinite = rawMax === null || rawMax === undefined || rawMax === 'Infinity'
          || (typeof rawMax === 'string' && rawMax.trim() === '');
        return {
          ...t,
          min: Number(t.min) || 0,
          max: isInfinite ? Infinity : Number(rawMax),
        };
      });
    }
    return merged;
  } catch {
    return structuredClone(DEFAULT_SETTINGS);
  }
}

/** 儲存設定（Infinity 會被轉成 null 以通過 JSON）。 */
export function saveSettings(settings) {
  try {
    const serializable = {
      ...settings,
      tiers: (settings.tiers || []).map((t, i, arr) => ({
        ...t,
        max: i === arr.length - 1 && t.max === Infinity ? null : t.max,
      })),
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(serializable));
    return true;
  } catch {
    return false;
  }
}

export function resetSettings() {
  try { localStorage.removeItem(SETTINGS_KEY); } catch { /* 忽略 */ }
}
