import { clientsClaim } from 'workbox-core';
import { precacheAndRoute } from 'workbox-precaching';

self.skipWaiting();
clientsClaim();
precacheAndRoute(self.__WB_MANIFEST);

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch {
    payload = { title: "stash'd", body: event.data.text() };
  }

  const params = new URLSearchParams();
  if (payload.alertId) params.set('alert', payload.alertId);
  if (payload.friendId) params.set('stashFor', payload.friendId);
  if (payload.suggestedCondition) params.set('condition', payload.suggestedCondition);

  event.waitUntil(
    self.registration.showNotification(payload.title || "stash'd", {
      body: payload.body || '',
      icon: '/pwa-192.png',
      badge: '/pwa-192.png',
      tag: payload.tag || 'stashd-alert',
      renotify: false,
      data: { url: `/?${params.toString()}` },
      actions: [{ action: 'stash', title: `Stash for ${payload.friendName || 'them'}` }],
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const client of clients) {
        if ('focus' in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});
