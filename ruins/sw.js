// 離線快取：第三方套件（vendor/、icons/）先用快取，遊戲本體先抓網路、失敗才用快取，
// 這樣每次更新後重新整理就是最新版，沒網路時也還能開。
// 換了 vendor 檔案時，把 VER 加一。
const VER = 'rr-v1';
const CORE = ['./', 'index.html', 'css/style.css', 'js/config.js', 'js/sim.js', 'js/audio.js', 'js/auth.js', 'js/cloud.js', 'js/net.js', 'js/game.js', 'js/main.js',
  'vendor/three.min.js', 'vendor/peerjs.min.js', 'vendor/firebase-app-compat.js', 'vendor/firebase-auth-compat.js', 'icons/icon-192.png'];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VER).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== VER; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener('fetch', function (e) {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;            // Firebase、配對伺服器等外部連線不經過快取
  const isStatic = /\/(vendor|icons)\//.test(url.pathname);
  if (isStatic) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) { if (res.ok) { const cp = res.clone(); caches.open(VER).then(function (c) { c.put(req, cp); }); } return res; });
    }));
    return;
  }
  e.respondWith(fetch(req).then(function (res) {
    if (res.ok) { const cp = res.clone(); caches.open(VER).then(function (c) { c.put(req, cp); }); }
    return res;
  }).catch(function () {
    return caches.match(req, { ignoreSearch: true }).then(function (hit) { return hit || caches.match('index.html'); });
  }));
});
