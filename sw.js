// sw.js — Service Worker: تخزين واجهة التطبيق للعمل دون اتصال
const CACHE = 'mosaadi-ai-v1';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/app.js',
  './js/agent.js',
  './js/llm.js',
  './js/memory.js',
  './js/settings.js',
  './js/speech.js',
  './js/tasks.js',
  './js/tools.js',
  './manifest.webmanifest',
  './icon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// واجهة التطبيق: cache-first — الطلبات الخارجية (APIs): network-only
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // لا نخزن ردود الخدمات الخارجية
  e.respondWith(
    caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    }).catch(() => caches.match('./index.html')))
  );
});
