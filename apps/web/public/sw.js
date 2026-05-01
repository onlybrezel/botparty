self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', (event) => {
  const version = new URL(self.location.href).searchParams.get('v') || 'dev';
  const activePrefix = `botparty-${version}`;
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys
        .filter((key) => key.startsWith('botparty-') && key !== activePrefix)
        .map((key) => caches.delete(key)),
    )).then(() => self.clients.claim()),
  );
});
