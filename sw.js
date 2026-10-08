/**
 * sw.js — Service Worker
 * ---------------------------------------------------------------------------
 * 只快取「程式本身」（HTML / CSS / JS / 圖示），讓這個 App 在沒有網路時也能開啟。
 *
 * 重要：這裡刻意不快取任何成績資料。
 *   - 成績資料是使用者在瀏覽器裡現場解析 Excel 得到的，本來就不經過網路。
 *   - 資料集存在 IndexedDB，由主程式自行管理，不歸 Service Worker 管。
 * 這樣可以確保：換了 Excel 內容，重新載入就一定是新的，不會被舊快取卡住。
 */

<<<<<<< HEAD
const CACHE = 'grade-app-shell-v3';
=======
const CACHE = 'grade-app-shell-v1';
>>>>>>> e1b79721076a5dbb3de0fe79d448fb57b1aa9069

const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/xlsx.js',
  './js/parse.js',
  './js/loader.js',
<<<<<<< HEAD
  './js/import-diff.js',
=======
>>>>>>> e1b79721076a5dbb3de0fe79d448fb57b1aa9069
  './js/store.js',
  './js/stats.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then(async (cache) => {
      // 逐一加入，個別檔案失敗不應該讓整個安裝失敗
      await Promise.all(SHELL.map((url) =>
        cache.add(new Request(url, { cache: 'reload' })).catch(() => {})));
      await self.skipWaiting();
    }),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // 只處理同源的 GET
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 網路優先：確保程式更新後立刻生效，離線時才用快取
  event.respondWith((async () => {
    try {
      const fresh = await fetch(req);
      if (fresh && fresh.ok && fresh.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(req, fresh.clone());
      }
      return fresh;
    } catch {
      const cached = await caches.match(req);
      if (cached) return cached;
      // 導覽請求離線時退回首頁
      if (req.mode === 'navigate') {
        const home = await caches.match('./index.html');
        if (home) return home;
      }
      return new Response('目前離線，而且這個資源沒有快取。', {
        status: 503,
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
      });
    }
  })());
});
