"use client";

import { useEffect } from "react";

/** Registra il service worker (necessario per l'installabilità PWA su Android). */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch(() => {
        /* non bloccante: se fallisce, l'app funziona comunque */
      });
    }
  }, []);
  return null;
}
