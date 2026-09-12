import type { NotificationsStatusDto } from '@stashd/shared';
import { api } from './api';

export function pushSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    'Notification' in window &&
    'serviceWorker' in navigator &&
    'PushManager' in window
  );
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const output = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) output[i] = raw.charCodeAt(i);
  return output;
}

/**
 * Ask for permission, subscribe the device, and flip the server-side opt-in.
 * Returns the resulting status or throws a human-readable error.
 */
export async function enableStashAlerts(token: string): Promise<NotificationsStatusDto> {
  if (!pushSupported()) {
    throw new Error('This browser cannot show stash alerts. Add stash\u2019d to your home screen first.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error('Alerts stay off until you allow notifications.');
  }

  const status = await api.notificationsStatus(token);
  const registration = await navigator.serviceWorker.ready;

  if (status.pushConfigured && status.vapidPublicKey) {
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(status.vapidPublicKey),
      }));
    const json = subscription.toJSON();
    await api.subscribePush(token, {
      endpoint: subscription.endpoint,
      expirationTime: json.expirationTime ?? null,
      keys: {
        p256dh: json.keys?.p256dh ?? '',
        auth: json.keys?.auth ?? '',
      },
    });
  }

  await api.updateProfile(token, { stashAlertsEnabled: true });
  return api.notificationsStatus(token);
}

export async function disableStashAlerts(token: string): Promise<void> {
  try {
    const registration = await navigator.serviceWorker.ready;
    const existing = await registration.pushManager.getSubscription();
    if (existing) {
      await api.unsubscribePush(token, existing.endpoint);
      await existing.unsubscribe();
    }
  } catch {
    // Server-side opt-out below is what actually stops alerts.
  }
  await api.updateProfile(token, { stashAlertsEnabled: false });
}

/** Foreground fallback when push isn't configured: still surface as an OS notification. */
export async function showLocalAlert(alert: { title: string; body: string; friendId?: string }) {
  if (!pushSupported() || Notification.permission !== 'granted') return;
  const registration = await navigator.serviceWorker.ready;
  const params = new URLSearchParams();
  if (alert.friendId) params.set('stashFor', alert.friendId);
  await registration.showNotification(alert.title, {
    body: alert.body,
    icon: '/pwa-192.png',
    tag: 'stashd-alert-local',
    data: { url: `/?${params.toString()}` },
  });
}
