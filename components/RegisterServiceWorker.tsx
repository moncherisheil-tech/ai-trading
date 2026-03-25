'use client';

import { useEffect } from 'react';

/**
 * Registers the PWA service worker in production so the app can be installed
 * (e.g. "Add to Home Screen" on Android) and benefits from caching.
 */
export default function RegisterServiceWorker() {
  useEffect(() => {
    if (typeof window === 'undefined' || process.env.NODE_ENV !== 'production') return;
    if (!('serviceWorker' in navigator)) return;

    navigator.serviceWorker
      .register('/sw.js')
      .then((reg) => {
        if (reg.installing) return;
        reg.update();
      })
      .catch(() => {});
  }, []);

  return null;
}
