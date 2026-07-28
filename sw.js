// B.T.C VPN — Service Worker (للتثبيت والعمل دون اتصال)
const CACHE = 'btc-vpn-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  // لا نتدخّل في طلبات الـ API (تبقى حيّة دائمًا)
  if (e.request.url.includes('/api/')) return;
  e.respondWith(
    caches.match(e.request).then(c => c || fetch(e.request).then(r => {
      const clone = r.clone();
      caches.open(CACHE).then(cache => cache.put(e.request, clone));
      return r;
    }).catch(() => caches.match('/index.html')))
  );
});
