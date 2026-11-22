// sw.js — Service Worker: تخزين واجهة التطبيق للعمل دون اتصال
// عند تغيير الكود ارفع رقم الإصدار حتى يتحدث العملاء القدامى فورًا.
const CACHE_VERSION = 2;
const CACHE = `mosaadi-ai-v${CACHE_VERSION}`;
const CACHE_PREFIX = 'mosaadi-ai-';

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
      // إزالة كاشات مساعدي القديمة فقط — لا نلمس أي كاش آخر على النطاق
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith(CACHE_PREFIX) && k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin) return; // الطلبات الخارجية (APIs): شبكة فقط
  if (e.request.method !== 'GET') return;

  // التنقل بين الصفحات: الشبكة أولًا حتى تصل التحديثات فورًا، والكاش احتياط دون اتصال
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // باقي ملفات الواجهة: من الكاش فورًا مع تحديثه في الخلفية (stale-while-revalidate)
  e.respondWith(
    caches.match(e.request).then((hit) => {
      const network = fetch(e.request).then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, copy));
        return res;
      }).catch(() => hit);
      return hit || network;
    })
  );
});
