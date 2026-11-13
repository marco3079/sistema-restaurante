// Service worker mínimo: não faz cache, só repassa as requisições para a rede.
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  event.respondWith(fetch(event.request));
});

// Aviso do servidor (Web Push): mostra a notificação. Dado inválido vira uma notificação genérica.
self.addEventListener('push', (event) => {
  let dados = null;
  try {
    dados = event.data ? event.data.json() : null;
  } catch {
    dados = null;
  }
  const titulo = dados && typeof dados.titulo === 'string' && dados.titulo ? dados.titulo : 'Sistema de Restaurante';
  const corpo = dados && typeof dados.corpo === 'string' ? dados.corpo : '';
  const url = dados && typeof dados.url === 'string' && dados.url ? dados.url : '/';
  const marca = dados && typeof dados.marca === 'string' ? dados.marca : undefined;
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: corpo,
      icon: '/logo-simbolo-192.png',
      badge: '/logo-simbolo-192.png',
      tag: marca,
      data: { url },
    })
  );
});

// Toque na notificação: foca uma janela do site (indo para a tela do aviso) ou abre uma nova.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  // Só endereços do próprio site: qualquer outra coisa (ou URL inválida) vai para a raiz.
  let alvo;
  try {
    alvo = new URL(url, self.location.origin);
    if (alvo.origin !== self.location.origin) alvo = new URL('/', self.location.origin);
  } catch {
    alvo = new URL('/', self.location.origin);
  }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      for (const janela of janelas) {
        if ('focus' in janela) {
          return janela.navigate(alvo.href).then((nova) => (nova || janela).focus());
        }
      }
      return self.clients.openWindow(alvo.href);
    })
  );
});
