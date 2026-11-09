'use client';

// Registers /sw.js for every visitor so CSS/JS and the last-seen pages survive a dropped connection
// (otherwise the browser can show a bare unstyled page offline). Failure to register is harmless.
import { useEffect } from 'react';

export function ServiceWorkerRegister() {
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);
  return null;
}
