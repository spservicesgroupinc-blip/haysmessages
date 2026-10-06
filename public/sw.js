/* The production build replaces the version and explicit shell URLs below. */
const CACHE_PREFIX = 'hays-messages-shell-';
const CACHE_NAME = CACHE_PREFIX + '__HAYS_BUILD_VERSION__';
const PRECACHE_URLS = /* HAYS_PRECACHE */ ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/maskable-512.png', '/icons/apple-touch-icon.png'] /* END_HAYS_PRECACHE */;
const SHELL_PATHS = new Set(PRECACHE_URLS);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(PRECACHE_URLS)));
  // A replacement waits until the user chooses to update, preserving active drafts.
});
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys
    .filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME)
    .map(key => caches.delete(key)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin) return;
  if (request.mode === 'navigate' && !url.pathname.startsWith('/api/')) {
    event.respondWith(fetch(request).then(response => {
      if (!response.ok) throw new Error('Navigation unavailable');
      return response;
    }).catch(async () => {
      const shell = await caches.open(CACHE_NAME);
      return (await shell.match('/index.html', { ignoreVary: true })) || Response.error();
    }));
    return;
  }
  // Never cache authenticated API responses, arbitrary files, or cross-origin requests.
  if (!SHELL_PATHS.has(url.pathname) || url.search) return;
  // Module/CSS requests can include an Origin header absent during precaching.
  // Hosts such as Vite preview send Vary: Origin; the immutable public shell is
  // identical for these requests, so match its canonical path without Vary.
  event.respondWith(caches.open(CACHE_NAME).then(async cache =>
    (await cache.match(url.pathname, { ignoreVary: true })) || fetch(request)));
});

function identifier(value) { return typeof value === 'string' ? value.slice(0, 200) : ''; }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
self.addEventListener('push', event => {
  let payload = {};
  try { payload = object(event.data?.json()); } catch { /* Keep the generic privacy-preserving fallback. */ }
  const title = typeof payload.title === 'string' ? payload.title.slice(0, 150) : 'Hays + Sons Messages';
  const body = typeof payload.body === 'string' ? payload.body.slice(0, 400) : 'You have a new team message.';
  // The relay nests click identifiers in data. Older senders used flat fields.
  // A present nested field is authoritative even when invalid: never substitute
  // conflicting flat input for an identifier supplied by the relay envelope.
  const data = object(payload.data);
  const conversationId = identifier(Object.hasOwn(data, 'conversationId') ? data.conversationId : payload.conversationId);
  const messageId = identifier(Object.hasOwn(data, 'messageId') ? data.messageId : payload.messageId);
  event.waitUntil(self.registration.showNotification(title, {
    body,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    tag: messageId || conversationId || 'hays-team-message',
    data: { conversationId, messageId },
  }));
});
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const data = object(event.notification.data);
  const conversationId = identifier(data.conversationId);
  const messageId = identifier(data.messageId);
  const target = new URL('/', self.location.origin);
  if (conversationId) target.searchParams.set('conversation', conversationId);
  if (messageId) target.searchParams.set('message', messageId);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find(window => new URL(window.url).origin === self.location.origin);
    if (client) {
      await client.focus();
      client.postMessage({ type: 'OPEN_CONVERSATION', conversationId, messageId });
    } else {
      await self.clients.openWindow(target.href);
    }
  })());
});
