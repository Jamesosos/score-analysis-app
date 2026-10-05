#!/usr/bin/env node
/**
 * syntax-check.mjs — 用 `node --check` 檢查所有前端 JS 的語法
 * ---------------------------------------------------------------------------
 * 為什麼需要這支腳本：
 *   js/ 底下的檔案是 ES module（.js 但使用 import/export），
 *   而 `node --check` 對 .js 會當成 CommonJS 來解析，因此會誤報。
 *   解法是先複製成 .mjs 再檢查。
 *
 * 這個步驟不能省。開發這個專案的過程中真的發生過一次：
 *   某個函式裡重複宣告了 `const subjects`，這是個致命語法錯誤，
 *   會讓「整個模組」都不執行 —— 畫面變成一片空白，而且 Console 只給一行訊息。
 *   瀏覽器不會告訴你哪裡寫錯，但 `node --check` 會精準指出行號。
 *
 * 用法：
 *   node tools/syntax-check.mjs
 *   npm run check
 */

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, readdirSync, statSync, copyFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, resolve, extname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

// 不需要檢查的目錄
const SKIP_DIRS = new Set(['node_modules', '.git', 'demo-data', 'icons', 'test']);
const CHECK_EXT = new Set(['.js', '.mjs', '.cjs']);

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.') {
      if (entry.isDirectory()) continue;
    }
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walk(full, out);
    } else if (CHECK_EXT.has(extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

/** 這個檔案是 ES module 嗎？（看有沒有頂層 import / export） */
function isEsm(file) {
  const src = readFileSync(file, 'utf8');
  return /^\s*(import|export)\s/m.test(src);
}

const files = walk(ROOT).sort();
if (files.length === 0) {
  console.log('沒有找到任何要檢查的 .js / .mjs 檔。');
  process.exit(0);
}

const tmp = mkdtempSync(join(tmpdir(), 'grade-syntax-'));
let pass = 0;
const failures = [];

console.log(`檢查 ${files.length} 個檔案…\n`);

for (const file of files) {
  const rel = relative(ROOT, file).replace(/\\/g, '/');
  const esm = isEsm(file);
  // ESM 語法必須用 .mjs 才能被 node --check 正確解析
  const target = esm ? join(tmp, basename(file).replace(/\.(js|cjs)$/, '') + '.mjs') : file;

  try {
    if (esm) copyFileSync(file, target);
    execFileSync(process.execPath, ['--check', target], { stdio: 'pipe' });
    pass++;
    console.log(`  OK    ${rel}${esm ? '  (ESM)' : ''}`);
  } catch (err) {
    const msg = (err.stderr || err.stdout || Buffer.from('')).toString().trim();
    failures.push({ rel, msg });
    console.log(`  FAIL  ${rel}`);
    for (const line of msg.split('\n').slice(0, 8)) console.log(`          ${line}`);
  }
}

rmSync(tmp, { recursive: true, force: true });

console.log('');
if (failures.length === 0) {
  console.log(`全部通過：${pass} / ${files.length}`);
  process.exit(0);
}

console.log(`有語法錯誤：通過 ${pass} / ${files.length}，失敗 ${failures.length}`);
console.log('\n失敗清單：');
for (const f of failures) console.log(`  ${f.rel}`);
console.log('\n提醒：一個語法錯誤就會讓整個模組不執行，畫面會整片空白。請優先修掉。');
process.exit(1);
