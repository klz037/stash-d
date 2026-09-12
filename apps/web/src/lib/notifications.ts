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
  if (!notificationsSupported()) {
    throw new Error('This browser cannot show notifications.');
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      permission === 'denied'
        ? 'Notifications are blocked for this site. Allow them in the address bar, then try again.'
        : 'Alerts stay off until you allow notifications.',
    );
  }

  const status = await api.notificationsStatus(token);
  const registration = pushSupported() ? await activeRegistration() : null;

  if (registration && status.pushConfigured && status.vapidPublicKey) {
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
    const registration = await activeRegistration();
    const existing = await registration?.pushManager.getSubscription();
    if (existing) {
      await api.unsubscribePush(token, existing.endpoint);
      await existing.unsubscribe();
    }
  } catch {
    // Server-side opt-out below is what actually stops alerts.
  }
  await api.updateProfile(token, { stashAlertsEnabled: false });
}

/** Whether this browser can show OS notifications at all (no push server needed). */
export function notificationsSupported(): boolean {
  return typeof window !== 'undefined' && 'Notification' in window;
}

export type LocalAlertResult = 'shown' | 'denied' | 'unsupported';

/** Resolves with the active registration, or null if the worker isn't up (e.g. `vite dev`). */
async function activeRegistration(timeoutMs = 1500): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  try {
    const existing = await navigator.serviceWorker.getRegistration();
    if (existing?.active) return existing;
    return await Promise.race([
      navigator.serviceWorker.ready,
      new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
    ]);
  } catch {
    return null;
  }
}

/**
 * Show an alert as a real OS notification on this computer. Goes through the
 * service worker when one is active (so clicks route through `notificationclick`),
 * otherwise falls back to the page-level Notification API.
 */
export async function showLocalAlert(alert: {
  id?: string;
  title: string;
  body: string;
  friendId?: string;
  friendName?: string;
  suggestedCondition?: string;
}): Promise<LocalAlertResult> {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'granted') {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return 'denied';
  }

  const params = new URLSearchParams();
  if (alert.friendId) params.set('stashFor', alert.friendId);
  if (alert.suggestedCondition) params.set('condition', alert.suggestedCondition);
  if (alert.id && !alert.id.startsWith('preview-')) params.set('alert', alert.id);
  const url = `/?${params.toString()}`;
  const options: NotificationOptions = {
    body: alert.body,
    icon: '/pwa-192.png',
    badge: '/pwa-192.png',
    tag: `stashd-alert-${alert.id ?? Date.now()}`,
    data: { url },
  };

  const registration = await activeRegistration();
  if (registration) {
    try {
      await registration.showNotification(alert.title, options);
      return 'shown';
    } catch {
      // Fall through to the page-level API.
    }
  }

  const notification = new Notification(alert.title, options);
  notification.onclick = () => {
    window.focus();
    window.location.assign(url);
    notification.close();
  };
  return 'shown';
}
