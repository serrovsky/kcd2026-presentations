// Offline support: precache everything, then network-first (3s timeout) so note edits
// show up whenever there is a connection, and the cached copy is used when there isn't.
const CACHE = 'host-v1';
const CORE = ['./', 'index.html', 'app.css', 'app.js', 'md.js', 'manifest.webmanifest',
  'icon.svg', 'icon-192.png', 'icon-512.png', 'data/schedule.json', 'notes/_general.md'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(CORE.map(u => new Request(u, { cache: 'reload' })));
    const data = await (await c.match('data/schedule.json')).json();
    const extra = new Set();
    for (const it of data.items) {
      if (it.notes) extra.add(it.notes);
      for (const p of it.speakers) if (p.photo) extra.add(p.photo);
    }
    await Promise.all([...extra].map(u => c.add(new Request(u, { cache: 'reload' })).catch(() => {})));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', e => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  // Navigations (incl. ?now=... rehearsal URLs) all map to the app shell.
  const key = req.mode === 'navigate' ? new Request(new URL('./', location).href) : new Request(url.origin + url.pathname);
  e.respondWith((async () => {
    const c = await caches.open(CACHE);
    const net = fetch(req, { cache: 'no-cache' }).then(r => {
      if (r.ok) c.put(key, r.clone());
      return r;
    });
    const cached = await c.match(key);
    if (!cached) return net;
    const timeout = new Promise(res => setTimeout(() => res(cached), 3000));
    return Promise.race([net.catch(() => cached), timeout]);
  })());
});
