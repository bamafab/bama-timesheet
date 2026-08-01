// m-qms-sw.js — minimal service worker for the BAMA QMS PWA.
// This is a LIVE-DATA app (auth tokens, SQL API, SharePoint), so we deliberately
// do NOT cache API or Graph responses. The SW exists to make the app installable
// and to give a usable shell if the page is opened offline. Strategy:
//   • App shell (html/css/manifest/icons): stale-while-revalidate.
//   • Everything else (API, Graph, shared.js, CDN): straight to network.
const SHELL = 'bama-qms-shell-v1';
const SHELL_ASSETS = [
  '/m-qms.html',
  '/m-qms.webmanifest',
  '/bama.css'
];

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_ASSETS).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== SHELL).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;                       // never touch POST/PUT
  const url = new URL(req.url);

  // Never cache dynamic/auth/data traffic — always live.
  const isApi   = url.hostname.includes('azurewebsites.net');
  const isGraph = url.hostname.includes('graph.microsoft.com') || url.hostname.includes('login.microsoftonline.com');
  const isCdn   = url.hostname.includes('cdnjs.cloudflare.com') || url.hostname.includes('fonts.g');
  if (isApi || isGraph) return;                            // pass through to network

  // App-shell files: stale-while-revalidate for instant open + background update.
  const isShell = SHELL_ASSETS.some(p => url.pathname === p || url.pathname.endsWith(p.replace('/', '')));
  if (isShell) {
    event.respondWith(
      caches.match(req).then(cached => {
        const net = fetch(req).then(res => {
          if (res && res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
          return res;
        }).catch(() => cached);
        return cached || net;
      })
    );
    return;
  }

  // shared.js and CDN libs: network-first, fall back to any cached copy.
  if (isCdn || url.pathname.endsWith('shared.js') || url.pathname.endsWith('steel-match.js') || url.pathname.endsWith('steel-sections.json')) {
    event.respondWith(fetch(req).catch(() => caches.match(req)));
  }
});
