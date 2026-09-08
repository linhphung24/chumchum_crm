/* Service worker: cache app shell để mở nhanh (KHÔNG cache API/socket) + Web Push */
const CACHE = 'chumchum-v2';
const PRECACHE = ['/', '/login', '/manifest.webmanifest', '/icon.svg', '/icon-192.png', '/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  // Bỏ qua API backend & websocket
  if (url.port === '4000' || url.protocol === 'wss:' || url.protocol === 'ws:') return;
  // Chỉ cache GET cùng origin
  if (event.request.method !== 'GET' || url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(event.request)
      .then((res) => {
        const copy = res.clone();
        caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return res;
      })
      .catch(() => caches.match(event.request).then((hit) => hit ?? caches.match('/'))),
  );
});

// ================= Web Push =================

self.addEventListener('push', (event) => {
  let payload = { title: '🐹 ChumChum CRM', body: 'Bạn có thông báo mới', url: '/inbox' };
  try {
    payload = { ...payload, ...event.data.json() };
  } catch {
    /* payload không phải JSON → dùng mặc định */
  }
  event.waitUntil(
    self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      tag: payload.url ?? 'chumchum',
      data: { url: payload.url ?? '/inbox' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url ?? '/inbox';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      // Ưu tiên focus cửa sổ đang mở rồi điều hướng tới đích
      for (const client of list) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client) client.navigate(url).catch(() => undefined);
          return;
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
