/* Service worker minimo.
 * La presenza di un handler `fetch` rende l'app installabile su Chrome/Android.
 * NON facciamo cache: un'app di finanza ha bisogno di dati sempre freschi, e
 * cachare il guscio rischierebbe di mostrare versioni vecchie. Restiamo in
 * passthrough (il browser fa la sua fetch normale). */
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) =>
  event.waitUntil(self.clients.claim()),
);
self.addEventListener("fetch", () => {
  /* passthrough: nessuna risposta gestita → rete normale */
});
