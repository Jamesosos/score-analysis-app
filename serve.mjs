/**
 * serve.mjs — 零依賴的靜態伺服器
 * ---------------------------------------------------------------------------
 * 用途：讓這個 App 透過 http:// 開啟。
 *   - http:// 才能註冊 Service Worker（可安裝成 App、可離線）
 *   - 直接用 file:// 開啟 index.html 也能用，只是不能安裝成 App
 *
 * 用法：
 *   node serve.mjs            → http://127.0.0.1:8787
 *   node serve.mjs 9000       → 換 port
 */

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)));
const PORT = Number(process.argv[2]) || 8787;
const HOST = process.argv[3] || '127.0.0.1';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
  '.csv': 'text/csv; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

function send(res, status, body, headers = {}) {
  res.writeHead(status, {
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    ...headers,
  });
  res.end(body);
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://${req.headers.host || HOST}`);
    let pathname = decodeURIComponent(url.pathname);

    // --- 測試用端點：/slow?ms=N 會延遲 N 毫秒才回應 ---
    // 用途：測試頁把它放進 <img src="/slow?ms=8000">，藉此拖住 load 事件。
    // 這樣 headless 瀏覽器截取 DOM 時，非同步工作（尤其是 IndexedDB）已經用
    // 真實時間完成 —— 這是不使用 --virtual-time-budget 也能驗證儲存行為的方法
    // （虛擬時間會讓 IndexedDB 回呼永遠不觸發）。
    if (pathname === '/slow') {
      const ms = Math.min(60000, Math.max(0, Number(url.searchParams.get('ms')) || 1000));
      // 1x1 透明 GIF
      const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64');
      setTimeout(() => send(res, 200, gif, { 'Content-Type': 'image/gif' }), ms);
      return;
    }

    if (pathname.endsWith('/')) pathname += 'index.html';

    // 防止路徑跳脫出 ROOT
    const target = resolve(join(ROOT, normalize(pathname)));
    if (target !== ROOT && !target.startsWith(ROOT + sep)) {
      send(res, 403, '403 禁止存取');
      return;
    }

    let info;
    try {
      info = await stat(target);
    } catch {
      send(res, 404, `404 找不到：${pathname}`, { 'Content-Type': 'text/plain; charset=utf-8' });
      console.log(`404  ${pathname}`);
      return;
    }

    if (info.isDirectory()) {
      const indexFile = join(target, 'index.html');
      try {
        const body = await readFile(indexFile);
        send(res, 200, body, { 'Content-Type': MIME['.html'] });
        return;
      } catch {
        send(res, 403, '403 這是資料夾，而且沒有 index.html');
        return;
      }
    }

    const body = await readFile(target);
    const type = MIME[extname(target).toLowerCase()] || 'application/octet-stream';
    send(res, 200, body, { 'Content-Type': type });
    console.log(`200  ${pathname}  (${(info.size / 1024).toFixed(1)} KB)`);
  } catch (err) {
    console.error(err);
    send(res, 500, `500 伺服器錯誤：${err.message}`, { 'Content-Type': 'text/plain; charset=utf-8' });
  }
});

server.listen(PORT, HOST, () => {
  console.log('');
  console.log('  學生成績查詢系統 — 本機伺服器已啟動');
  console.log(`  請用瀏覽器開啟：  http://${HOST}:${PORT}/`);
  console.log('');
  console.log('  在同一個資料夾按 Ctrl+C 可以停止伺服器。');
  console.log('');
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\n  Port ${PORT} 已被占用。請改用：node serve.mjs ${PORT + 1}\n`);
  } else {
    console.error(err);
  }
  process.exit(1);
});
