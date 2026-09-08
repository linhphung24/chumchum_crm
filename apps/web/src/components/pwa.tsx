'use client';

import { useEffect } from 'react';

/** Đăng ký service worker để cài PWA lên màn hình chính */
export function PwaRegister() {
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    }
  }, []);
  return null;
}
