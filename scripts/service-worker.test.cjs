const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function worker() {
  const handlers = {}, seen = { matches: [], notifications: [], deleted: [], opened: [], messages: [], precache: [], skipped: 0, focused: 0 };
  const shell = { offline: true };
  const cache = { addAll: async urls => { seen.precache = [...urls]; }, match: async (path, options) => { seen.matches.push({ path, options }); return shell; } };
  let windows = [];
  const context = vm.createContext({ URL, Set, Promise, Response: { error: () => ({ error: true }) }, fetch: async () => { throw new Error('offline'); }, caches: { open: async () => cache, keys: async () => ['hays-messages-shell-old', 'unrelated-cache', 'hays-messages-shell-__HAYS_BUILD_VERSION__'], delete: async key => { seen.deleted.push(key); return true; } }, self: {
    location: { origin: 'https://hays.example' }, addEventListener: (type, handler) => { handlers[type] = handler; }, skipWaiting: () => { seen.skipped++; },
    registration: { showNotification: async (title, options) => { seen.notifications.push({ title, options }); } },
    clients: { claim: async () => {}, matchAll: async () => windows, openWindow: async url => { seen.opened.push(url); } },
  } });
  vm.runInContext(fs.readFileSync('public/sw.js', 'utf8'), context);
  async function dispatch(type, data = {}) {
    const waits = []; let response;
    handlers[type]({ ...data, waitUntil: promise => waits.push(promise), respondWith: promise => { response = promise; } });
    await Promise.all(waits); return response ? await response : undefined;
  }
  return { dispatch, seen, existing: () => { windows = [{ url: 'https://hays.example/', focus: async () => { seen.focused++; }, postMessage: data => seen.messages.push(data) }]; } };
}

test('worker precaches public shell and activates only its own current cache', async () => {
  const w = worker(); await w.dispatch('install');
  assert.ok(w.seen.precache.includes('/index.html')); assert.ok(w.seen.precache.includes('/icons/icon-512.png'));
  assert.equal(w.seen.skipped, 0, 'install never forces an update over an active draft');
  await w.dispatch('activate'); assert.deepEqual(w.seen.deleted, ['hays-messages-shell-old']);
  await w.dispatch('message', { data: { type: 'SKIP_WAITING' } }); assert.equal(w.seen.skipped, 1);
});

test('offline navigation falls back to shell; explicit assets ignore Origin variation', async () => {
  const w = worker();
  assert.deepEqual(await w.dispatch('fetch', { request: { method: 'GET', mode: 'navigate', url: 'https://hays.example/?conversation=sales' } }), { offline: true });
  assert.deepEqual(await w.dispatch('fetch', { request: { method: 'GET', mode: 'cors', url: 'https://hays.example/icons/icon-192.png' } }), { offline: true });
  assert.equal(w.seen.matches[0].options.ignoreVary, true); assert.equal(w.seen.matches[1].options.ignoreVary, true);
});

test('worker never intercepts authenticated APIs, cross-origin requests or arbitrary files', async () => {
  const w = worker();
  for (const request of [
    { method: 'POST', url: 'https://hays.example/api/messages' },
    { method: 'GET', mode: 'navigate', url: 'https://hays.example/api/messages' },
    { method: 'GET', url: 'https://script.google.com/macros/s/test/exec' },
    { method: 'GET', url: 'https://hays.example/private.json' },
    { method: 'GET', url: 'https://hays.example/icons/icon-192.png?secret=something' },
  ]) assert.equal(await w.dispatch('fetch', { request }), undefined);
  assert.equal(w.seen.matches.length, 0);
});

test('nested relay payload opens correct conversation, deduplicates retries and handles malformed push', async () => {
  const w = worker();
  await w.dispatch('push', { data: { json: () => ({ title: 'Team alert', body: 'New message', conversationId: 'wrong', data: { conversationId: 'sales', messageId: 'message-1' } }) } });
  const first = w.seen.notifications[0];
  assert.equal(first.options.data.conversationId, 'sales'); assert.equal(first.options.tag, 'message-1');
  for (const value of [null, [], { data: [] }]) await w.dispatch('push', { data: { json: () => value } });
  await w.dispatch('push', { data: { json: () => { throw new Error('invalid'); } } });
  assert.equal(w.seen.notifications.length, 5);
  assert.equal(w.seen.notifications.at(-1).options.body, 'You have a new team message.');
});

test('notification click opens only the app origin even if identifier resembles a remote URL', async () => {
  const w = worker(); let closed = false;
  await w.dispatch('notificationclick', { notification: { close: () => { closed = true; }, data: { conversationId: 'https://attacker.example/', messageId: 'id&extra=value' } } });
  assert.equal(closed, true);
  const url = new URL(w.seen.opened[0]); assert.equal(url.origin, 'https://hays.example');
  assert.equal(url.searchParams.get('conversation'), 'https://attacker.example/');
  assert.equal(url.searchParams.get('message'), 'id&extra=value');
});

test('notification click focuses an existing app and sends its conversation identifier', async () => {
  const w = worker(); w.existing();
  await w.dispatch('notificationclick', { notification: { close: () => {}, data: { conversationId: 'sales', messageId: 'message-1' } } });
  assert.equal(w.seen.focused, 1); assert.equal(w.seen.opened.length, 0);
  assert.equal(w.seen.messages[0].type, 'OPEN_CONVERSATION'); assert.equal(w.seen.messages[0].conversationId, 'sales');
});
