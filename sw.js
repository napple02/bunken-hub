// 文献ハブの Service Worker。画面のファイルを端末に控えて、オフラインでも台帳を開けるようにする。
// 自分のサイトのファイルは「ネットワーク優先（3秒で見切って控えを使う）」にして、更新が常に最新の組になるようにする。
// 論文の検索に使う外部 API（OpenAlex・Crossref など）には一切介入しない。フォントだけは控えを使い回す。
const CACHE = 'bunken-hub-shell-v1';
const FONTS = 'bunken-hub-fonts-v1';
const SHELL = ['./', 'index.html', 'style.css', 'theme.js', 'lib.js', 'app.js', 'pwa.js', 'manifest.webmanifest',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png', 'icons/favicon-32.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && k !== FONTS).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

function networkFirst(req, ms) {
  return new Promise((resolve) => {
    let done = false;
    const fallback = () => caches.match(req, { ignoreSearch: true }).then((hit) => hit || caches.match('index.html'));
    const timer = setTimeout(() => { if (!done) fallback().then((r) => { if (r && !done) { done = true; resolve(r); } }); }, ms);
    fetch(req).then((res) => {
      if (done) { if (res.ok) caches.open(CACHE).then((c) => c.put(req, res.clone())); return; }
      done = true; clearTimeout(timer);
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(req.mode === 'navigate' ? 'index.html' : req, copy)); }
      resolve(res);
    }).catch(() => { clearTimeout(timer); if (!done) { done = true; fallback().then((r) => resolve(r || Response.error())); } });
  });
}

function staleWhileRevalidate(req) {
  return caches.open(FONTS).then((c) => c.match(req).then((hit) => {
    const net = fetch(req).then((res) => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => hit);
    return hit || net;
  }));
}

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) { e.respondWith(networkFirst(req, 3000)); return; }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') e.respondWith(staleWhileRevalidate(req));
});
