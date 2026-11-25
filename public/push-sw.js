// Se carga dentro del service worker de la PWA (workbox importScripts).
// Muestra los avisos push y abre la tarea al tocarlos.
self.addEventListener('push', (event) => {
  let datos = {};
  try {
    datos = event.data ? event.data.json() : {};
  } catch {
    datos = { titulo: 'Tablero Zero', detalle: event.data ? event.data.text() : '' };
  }
  const titulo = datos.titulo || 'Tablero Zero';
  event.waitUntil(
    self.registration.showNotification(titulo, {
      body: datos.detalle || '',
      icon: '/icono-192.png',
      badge: '/icono-192.png',
      lang: 'es-MX',
      tag: datos.tarea_id || undefined,
      data: { url: datos.tarea_id ? `/tarea/${datos.tarea_id}` : '/avisos' },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
      for (const c of lista) {
        if ('focus' in c) {
          c.navigate(url);
          return c.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});

// SEG-003: al activar esta versión, borrar cachés de versiones anteriores que guardaban datos autenticados.
// Se conservan el precache de Workbox (estructura de la app) y las fuentes.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((nombres) =>
      Promise.all(nombres.filter((n) => n === 'datos' || /supabase|rest-v1/i.test(n)).map((n) => caches.delete(n))),
    ),
  );
});
