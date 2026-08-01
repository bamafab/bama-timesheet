// m-qms-sw.js — service worker for the BAMA mobile PWA.
// LIVE-DATA app (auth tokens, SQL API, SharePoint) so we never cache API/Graph.
// Caching strategy, tuned so installed users always get fresh code:
//   • App HTML  (m-qms.html): NETWORK-FIRST — a reopen with signal always pulls
//                the latest build; cached copy only as an offline fallback.
//   • shared.js / steel-match.js / steel-sections.json / CDN: network-first.
//   • CSS / manifest / icons: stale-while-revalidate (instant, refresh in bg).
// Bump SHELL when shipping SW logic changes so it re-activates.
const SHELL = 'bama-shell-v12';
const PRECACHE = ['/m-qms.html', '/m-qms.webmanifest', '/bama.css', '/bama-logo.png'];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(PRECACHE).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== SHELL).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Let the page tell a waiting SW to take over immediately (Update-now button).
self.addEventListener('message', (e) => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  const isApi   = url.hostname.includes('azurewebsites.net');
  const isGraph = url.hostname.includes('graph.microsoft.com') || url.hostname.includes('login.microsoftonline.com');
  const isCdn   = url.hostname.includes('cdnjs.cloudflare.com') || url.hostname.includes('fonts.g');
  if (isApi || isGraph) return;   // always live

  const isHtml = url.pathname.endsWith('m-qms.html') || url.pathname === '/' || req.mode === 'navigate';
  const isCode = url.pathname.endsWith('shared.js') || url.pathname.endsWith('steel-match.js') || url.pathname.endsWith('steel-sections.json');

  // HTML + code + CDN: network-first, cache the fresh copy, fall back offline.
  if (isHtml || isCode || isCdn) {
    event.respondWith(
      fetch(req).then(res => {
        if (res && res.ok && (isHtml)) { const copy = res.clone(); caches.open(SHELL).then(c => c.put('/m-qms.html', copy)); }
        return res;
      }).catch(() => caches.match(req).then(c => c || caches.match('/m-qms.html')))
    );
    return;
  }

  // CSS / manifest / icons: stale-while-revalidate.
  const isAsset = PRECACHE.some(p => url.pathname.endsWith(p.replace('/', ''))) || /\.(css|png|webmanifest|svg|woff2?)$/.test(url.pathname);
  if (isAsset) {
    event.respondWith(
      caches.match(req).then(cached => {
        const net = fetch(req).then(res => {
          if (res && res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
          return res;
        }).catch(() => cached);
        return cached || net;
      })
    );
  }
});
