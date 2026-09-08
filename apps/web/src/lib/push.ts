'use client';

import { api } from './api';

export type PushState = 'unsupported' | 'no-vapid' | 'denied' | 'off' | 'on';

export function pushSupported(): boolean {
  return typeof window !== 'undefined' && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

/** Trạng thái hiện tại: đã bật / tắt / bị từ chối / chưa hỗ trợ / server chưa cấu hình VAPID */
export async function getPushState(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  const { publicKey } = await api<{ publicKey: string | null }>('/notifications/vapid-key');
  if (!publicKey) return 'no-vapid';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  return sub && Notification.permission === 'granted' ? 'on' : 'off';
}

/** Xin quyền + đăng ký push với server. Trả về trạng thái sau khi thực hiện. */
export async function enablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const { publicKey } = await api<{ publicKey: string | null }>('/notifications/vapid-key');
  if (!publicKey) return 'no-vapid';

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return permission === 'denied' ? 'denied' : 'off';

  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) {
    // applicationServerKey nhận trực tiếp chuỗi base64url (VAPID public key)
    sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: publicKey,
    });
  }
  const json = sub.toJSON();
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return 'off';
  await api('/notifications/subscribe', {
    method: 'POST',
    body: { endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } },
  });
  return 'on';
}

/** Huỷ đăng ký push trên thiết bị này */
export async function disablePush(): Promise<PushState> {
  if (!pushSupported()) return 'unsupported';
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (sub) {
    await api('/notifications/subscribe', { method: 'DELETE', body: { endpoint: sub.endpoint } });
    await sub.unsubscribe();
  }
  return 'off';
}
