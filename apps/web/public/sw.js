/* BudgetFlow service worker (B8, screen 059a): installable app shell and Web Push display.
 *
 * What it caches, and what it never does:
 * - The app shell only: index.html, the hashed JS and CSS bundles, fonts, icons and the manifest.
 *   With no connection the app still starts and says it is offline.
 * - Never API responses (/api/*), the sign-in service or any other origin. Budgets, balances and
 *   approvals always come from the network, so a figure is never shown from an earlier visit as if
 *   it were current. Those requests are not intercepted at all.
 *
 * Bump SHELL_VERSION when this file's caching rules change; hashed bundles need no bump.
 */
const SHELL_VERSION = 'bf-shell-v1';
const SHELL_URLS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.ico',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
];
const STATIC_ASSET = /\.(?:js|mjs|css|woff2?|ttf|otf|svg|png|ico|webmanifest)$/;

/** Same-origin static files only; anything under /api or /health is never cached. */
function isCacheable(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api/') || url.pathname === '/health') return false;
  if (url.pathname === '/sw.js') return false;
  return STATIC_ASSET.test(url.pathname);
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_VERSION);
      await cache.addAll(SHELL_URLS);
      // The bundles index.html loads have hashed names; read them from the page itself.
      const html = await (await cache.match('/index.html')).text();
      const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)]
        .map((m) => new URL(m[1], self.location.origin))
        .filter(isCacheable)
        .map((u) => u.pathname);
      await cache.addAll([...new Set(assets)]);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== SHELL_VERSION) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // App navigations: the network first (a new release takes over at once), the cached shell when
  // there is no connection. The shell then shows the offline state; it holds no data.
  if (req.mode === 'navigate' && url.origin === self.location.origin) {
    if (url.pathname.startsWith('/api/')) return;
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          if (fresh.ok) {
            const cache = await caches.open(SHELL_VERSION);
            await cache.put('/index.html', fresh.clone());
          }
          return fresh;
        } catch {
          const cached = await caches.match('/index.html');
          return cached ?? Response.error();
        }
      })(),
    );
    return;
  }

  if (!isCacheable(url)) return; // API, sign-in and other origins: straight to the network.

  // Hashed bundles and other static files: cache first, filled on first use (lazy route chunks).
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      if (cached) return cached;
      const fresh = await fetch(req);
      if (fresh.ok && fresh.type === 'basic') {
        const cache = await caches.open(SHELL_VERSION);
        await cache.put(req, fresh.clone());
      }
      return fresh;
    })(),
  );
});

// Web Push (059c). The API encrypts { title, body, url, tag, deliveryId }; amounts are already left
// out unless the person chose to see them on the lock screen.
self.addEventListener('push', (event) => {
  let msg = {};
  try {
    msg = event.data ? event.data.json() : {};
  } catch {
    msg = { title: 'BudgetFlow', body: event.data ? event.data.text() : '' };
  }
  // Same-origin paths only: "//host" would leave the app.
  const url =
    typeof msg.url === 'string' && msg.url.startsWith('/') && !msg.url.startsWith('//')
      ? msg.url
      : '/notifications';
  event.waitUntil(
    self.registration.showNotification(String(msg.title || 'BudgetFlow'), {
      body: String(msg.body || ''),
      tag: msg.tag ? String(msg.tag) : undefined,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url, deliveryId: msg.deliveryId ?? null },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url ?? '/notifications', self.location.origin);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const w of windows) {
        if (new URL(w.url).origin === url.origin && 'focus' in w) {
          await w.focus();
          if ('navigate' in w) await w.navigate(url.href);
          return;
        }
      }
      await self.clients.openWindow(url.href);
    })(),
  );
});
