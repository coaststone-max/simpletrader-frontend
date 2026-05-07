// SimpleTrader Service Worker — Push Notifications + Offline Cache
const CACHE = 'st-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// ── Push Notifications ────────────────────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return;
  let d;
  try { d = e.data.json(); } catch { d = { title: 'SimpleTrader', body: e.data.text() }; }

  const opts = {
    body:      d.body   || '',
    icon:      d.icon   || '/icon-192.png',
    badge:     '/icon-192.png',
    tag:       d.tag    || 'st-default',
    renotify:  true,
    data:      { url: d.url || '/' },
    vibrate:   [200, 100, 200],
    timestamp: Date.now(),
  };

  e.waitUntil(self.registration.showNotification(d.title || 'SimpleTrader', opts));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = e.notification.data?.url || '/';
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(all => {
      const win = all.find(c => c.url.startsWith(self.location.origin));
      if (win) return win.focus();
      return clients.openWindow(url);
    })
  );
});
