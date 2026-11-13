// Push only: no offline caching of accounts, documents, or financial data.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() || {}; } catch { /* Keep a safe generic message. */ }
  const url = typeof data.url === 'string' && data.url.startsWith('/') && !data.url.startsWith('//') ? data.url : '/member-dashboard';
  const text = (value, fallback, limit) => {
    const clean = typeof value === 'string' ? value.replace(/\s+/g, ' ').trim() : '';
    return clean ? (clean.length > limit ? clean.slice(0, limit - 1) + '…' : clean) : fallback;
  };
  const title = text(data.title, 'Incline · New notification', 80);
  const body = text(data.body, 'A new notification is available. Open Incline to view the details.', 180);
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icon-192.png', badge: '/icon-192.png',
    tag: data.tag || 'incline-update', data: { url },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/member-dashboard', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async windows => {
    const existing = windows.find(client => new URL(client.url).origin === target.origin);
    if (existing) { await existing.navigate(target.href); return existing.focus(); }
    return self.clients.openWindow(target.href);
  }));
});