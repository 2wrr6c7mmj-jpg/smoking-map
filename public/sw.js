// アプリ本体は端末に保存して電波がなくても起動できるようにし、地図タイルは見た分を一定数まで保存する
const VERSION = 'v2';
const SHELL = `kemuri-shell-${VERSION}`;
const TILES = 'kemuri-tiles';
const FONTS = 'kemuri-fonts';
const MAX_TILES = 800;
const SHELL_FILES = ['./', 'index.html', 'style.css', 'app.js', 'cells.js', 'store.js', 'manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png', 'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('kemuri-shell-') && k !== SHELL).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function trimTiles() {
  const c = await caches.open(TILES);
  const keys = await c.keys();
  for (const k of keys.slice(0, Math.max(0, keys.length - MAX_TILES))) await c.delete(k);
}

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET') return;

  if (url.hostname === 'tile.openstreetmap.org') {
    e.respondWith(
      caches.open(TILES).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok || res.type === 'opaque') {
          await c.put(e.request, res.clone());
          trimTiles();
        }
        return res;
      })
    );
    return;
  }

  // Google Fonts は一度読んだら端末に保存して使い回す
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    e.respondWith(
      caches.open(FONTS).then(async (c) => {
        const hit = await c.match(e.request);
        if (hit) return hit;
        const res = await fetch(e.request);
        if (res.ok || res.type === 'opaque') await c.put(e.request, res.clone());
        return res;
      })
    );
    return;
  }

  if (url.origin !== location.origin || url.pathname.includes('/api/')) return; // データは app.js 側で保存する

  // アプリ本体：ネットワークを優先し、つながらなければ保存分
  e.respondWith(
    fetch(e.request)
      .then((res) => {
        if (res.ok) caches.open(SHELL).then((c) => c.put(e.request, res.clone()));
        return res;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
