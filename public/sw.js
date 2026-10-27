// Service worker mínimo: torna o site instalável. Não guarda nada em cache,
// por isso o site mostra sempre a versão mais recente.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {});
