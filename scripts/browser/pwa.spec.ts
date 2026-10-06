import { test, expect, chromium, type Page } from '@playwright/test';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';

const origin = 'http://localhost:4174';
const user = { email: 'offline@hays.test', name: 'Offline teammate', role: 'admin' };
const session = { token: 'pwa-session', expiresAt: new Date(Date.now() + 3600000).toISOString(), user };
const date = new Date(Date.now() - 1000).toISOString();
const conversations = ['general', 'sales'].map(id => ({ id, name: id, description: 'Team updates', kind: 'channel', members: [], createdBy: 'SYSTEM', createdAt: date, lastActivity: date, unread: 0 }));
function example(id = 'general') { return { id: `message-${id}`, conversationId: id, authorEmail: user.email, authorName: user.name, body: `${id} saved team update`, createdAt: date, updatedAt: '', deleted: false, parentId: '', reactions: {}, clientId: `cached-${id}` }; }
async function mockWorkspace(page: Page, handler?: (action: string, payload: Record<string, unknown>) => unknown) {
  const messages = [example()];
  await page.addInitScript(value => localStorage.setItem('hays.messages.session.v1', JSON.stringify(value)), session);
  await page.route('https://script.google.com/**', async route => {
    const body = route.request().postDataJSON(); let data: unknown;
    const extra = handler?.(body.action, body);
    if (extra !== undefined) data = extra;
    else switch (body.action) {
      case 'registrationInfo': data = { enabled: true, requiresInvite: false, minPasswordLength: 10 }; break;
      case 'bootstrap': data = { user, people: [user], conversations }; break;
      case 'listMessages': data = { messages: body.conversationId === 'general' ? messages : [example('sales')], hasMore: false, nextBeforeId: 'message-general', readThrough: date }; break;
      case 'editMessage': messages[0] = { ...messages[0], body: body.body, updatedAt: new Date().toISOString() }; data = messages[0]; break;
      case 'markRead': case 'logout': data = { ok: true }; break;
      default: throw new Error(`Unexpected PWA action ${body.action}`);
    }
    await route.fulfill({ json: { ok: true, data } });
  });
}
async function ready(page: Page) {
  await page.goto(origin);
  await page.evaluate(async () => { await navigator.serviceWorker.ready; });
  await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}
async function openDeviceSettings(page: Page) {
  const menu = page.getByRole('button', { name: 'Open navigation' });
  if (await menu.isVisible()) await menu.click();
}

test('production manifest is installable, icons are real PNGs, and the sign-in page reloads offline', async ({ page, context }) => {
  await page.route('https://script.google.com/**', route => route.fulfill({ json: { ok: true, data: { enabled: false, requiresInvite: false, minPasswordLength: 10 } } }));
  await ready(page);
  const cdp = await context.newCDPSession(page);
  const manifest = await cdp.send('Page.getAppManifest');
  expect(manifest.errors).toEqual([]);
  const parsed = JSON.parse(manifest.data);
  expect(parsed.display).toBe('standalone'); expect(parsed.start_url).toBe('/');
  for (const icon of [...parsed.icons, { src: '/icons/apple-touch-icon.png', sizes: '180x180' }]) {
    const response = await page.request.get(origin + icon.src);
    const bytes = await response.body();
    expect([...bytes.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    expect(`${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`).toBe(icon.sizes);
  }
  // Playwright's isolated contexts cannot offer installation; all app-related checks still apply.
  expect((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors.filter(error => error.errorId !== 'in-incognito')).toEqual([]);
  await cdp.detach();
  await expect(page.getByRole('heading', { name: 'Sign in to your workspace.' })).toBeVisible();
  await context.setOffline(true);
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Sign in to your workspace.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Username', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => navigator.onLine)).toBe(false);
  await expect(page.getByRole('status')).toContainText('Offline view');
  const cached = await page.evaluate(async () => (await caches.keys()).filter(name => name.startsWith('hays-messages-shell-')));
  expect(cached).toHaveLength(1);
});

test('saved company messages include edits offline, failed sends retain drafts, logout clears private cache', async ({ page, context }) => {
  await mockWorkspace(page); await ready(page);
  await expect(page.getByText('general saved team update', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Edit message' }).click();
  await page.getByRole('textbox', { name: 'Edit message' }).fill('Edited and saved for offline');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByText('Edited and saved for offline', { exact: true })).toBeVisible();
  await context.setOffline(true); await page.reload();
  await expect(page.getByText('Edited and saved for offline', { exact: true })).toBeVisible();
  const composer = page.getByRole('textbox', { name: 'Message #general' });
  await composer.fill('Keep this draft until reconnect');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(composer).toHaveValue('Keep this draft until reconnect');
  await expect(page.getByRole('alert')).toContainText('offline');
  await page.reload(); await expect(composer).toHaveValue('Keep this draft until reconnect');
  await context.setOffline(false);
  await openDeviceSettings(page); await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to your workspace.' })).toBeVisible();
  const records = await page.evaluate(async () => new Promise<number>((resolve, reject) => {
    const request = indexedDB.open('hays-offline-v1', 1);
    request.onsuccess = () => { const db = request.result; const count = db.transaction('reads').objectStore('reads').count(); count.onsuccess = () => { resolve(count.result); db.close(); }; count.onerror = () => reject(count.error); };
    request.onerror = () => reject(request.error);
  }));
  expect(records).toBe(0);
});

test('installation uses a user action', async ({ page }) => {
  await page.route('https://script.google.com/**', route => route.fulfill({ json: { ok: true, data: { enabled: false } } }));
  await ready(page);
  await page.evaluate(() => {
    const event = new Event('beforeinstallprompt', { cancelable: true });
    Object.assign(event, { prompt: async () => { (window as unknown as { prompted: boolean }).prompted = true; }, userChoice: Promise.resolve({ outcome: 'accepted', platform: 'web' }) });
    window.dispatchEvent(event);
  });
  expect(await page.evaluate(() => !!(window as unknown as { prompted: boolean }).prompted)).toBe(false);
  await page.getByRole('button', { name: 'Install app', exact: true }).click();
  expect(await page.evaluate(() => (window as unknown as { prompted: boolean }).prompted)).toBe(true);
  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(page.getByRole('button', { name: 'Install app', exact: true })).toHaveCount(0);
});

test('notification opt-in and opt-out persist subscription only after explicit user action', async ({ page, context }) => {
  await context.grantPermissions(['notifications'], { origin });
  let subscriptions = 0, unsubscriptions = 0;
  const endpoint = 'https://fcm.googleapis.com/fcm/send/browser-test';
  const publicKey = Buffer.from([4, ...Array(64).fill(1)]).toString('base64url');
  await mockWorkspace(page, (action, payload) => {
    if (action === 'pushConfig') return { enabled: true, publicKey };
    if (action === 'subscribePush') { subscriptions++; expect((payload.subscription as { endpoint: string }).endpoint).toBe(endpoint); return { ok: true }; }
    if (action === 'unsubscribePush') { unsubscriptions++; expect(payload.endpoint).toBe(endpoint); return { ok: true }; }
    if (action === 'pushStatus') return { enabled: true, subscribed: subscriptions > unsubscriptions, publicKey };
    return undefined;
  });
  await ready(page);
  await page.evaluate(endpoint => {
    let active = false;
    const subscription = { endpoint, toJSON: () => ({ endpoint, keys: { p256dh: 'browser-public-key', auth: 'browser-auth' } }), unsubscribe: async () => { active = false; return true; } };
    PushManager.prototype.getSubscription = async () => active ? subscription as unknown as PushSubscription : null;
    PushManager.prototype.subscribe = async () => { active = true; return subscription as unknown as PushSubscription; };
  }, endpoint);
  expect(subscriptions).toBe(0);
  await openDeviceSettings(page); await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await page.getByRole('button', { name: 'Enable notifications', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Notifications are enabled' })).toBeVisible();
  expect(subscriptions).toBe(1);
  await page.getByRole('button', { name: 'Test device alert', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Test alert sent' })).toBeVisible();
  await expect.poll(() => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).length)).toBe(1);
  const silent = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications())[0].silent);
  expect(silent).toBe(false);
  await page.getByRole('button', { name: 'Turn off notifications', exact: true }).click();
  await expect(page.getByRole('status').filter({ hasText: 'turned off' })).toBeVisible();
  expect(unsubscriptions).toBe(1);
});

test('native service-worker push displays an alert and safely opens the selected conversation', async ({ page, context }) => {
  await mockWorkspace(page); await context.grantPermissions(['notifications'], { origin }); await ready(page);
  const cdp = await context.newCDPSession(page);
  let registrationId = '';
  cdp.on('ServiceWorker.workerRegistrationUpdated', event => { registrationId = event.registrations.find(r => r.scopeURL === origin + '/')?.registrationId || registrationId; });
  await cdp.send('ServiceWorker.enable');
  await expect.poll(() => registrationId).not.toBe('');
  await cdp.send('ServiceWorker.deliverPushMessage', { origin, registrationId, data: JSON.stringify({ title: 'Hays + Sons Messages', body: 'You have a new team message.', data: { conversationId: 'sales', messageId: 'background-test' } }) });
  await expect.poll(() => page.evaluate(async () => (await (await navigator.serviceWorker.ready).getNotifications()).length)).toBe(1);
  const notification = await page.evaluate(async () => {
    const [notice] = await (await navigator.serviceWorker.ready).getNotifications();
    return { title: notice.title, body: notice.body, data: notice.data };
  });
  expect(notification.title).toBe('Hays + Sons Messages'); expect(notification.data.conversationId).toBe('sales');
  const worker = context.serviceWorkers()[0];
  await worker.evaluate(async () => {
    const windows = await (self as unknown as { clients: { matchAll: (options: object) => Promise<Array<{postMessage:(data:object)=>void}>> } }).clients.matchAll({ type: 'window' });
    windows[0]?.postMessage({ type: 'OPEN_CONVERSATION', conversationId: 'sales', messageId: 'background-test' });
  });
  await expect(page.getByRole('heading', { name: 'sales', exact: true })).toBeVisible();
  await expect(page.getByText('sales saved team update', { exact: true })).toBeVisible();
});

test('iPhone installation guidance explains home-screen notification requirements', async ({ page }) => {
  await page.addInitScript(() => Object.defineProperty(navigator, 'userAgent', { get: () => 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile Safari/604.1' }));
  await mockWorkspace(page); await ready(page);
  await openDeviceSettings(page); await page.getByRole('button', { name: 'Notifications', exact: true }).click();
  await expect(page.getByText('Add this app to your home screen', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: 'Installation instructions' }).click();
  await expect(page.getByText('Open the published app in Safari.', { exact: true })).toBeVisible();
  await expect(page.getByText('notifications require iOS/iPadOS 16.4', { exact: false })).toBeVisible();
});

test('normal desktop browser profile meets native installation criteria', async ({}, info) => {
  test.skip(info.project.name !== 'desktop', 'Desktop installation audit uses a persistent desktop profile.');
  const browser = await chromium.launchPersistentContext(info.outputPath('install-profile'), { channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage();
    await mockWorkspace(page);
    await ready(page);
    const cdp = await browser.newCDPSession(page);
    expect((await cdp.send('Page.getAppManifest')).errors).toEqual([]);
    expect((await cdp.send('Page.getInstallabilityErrors')).installabilityErrors).toEqual([]);
    await cdp.detach();
  } finally { await browser.close(); }
});

test('a new service worker waits for confirmation and preserves drafts through an update', async ({ page }) => {
  const root = resolve('dist');
  const initialWorker = await readFile(resolve(root, 'sw.js'), 'utf8');
  let workerSource = initialWorker;
  const server = http.createServer(async (request, response) => {
    try {
      const path = new URL(request.url || '/', 'http://localhost').pathname;
      const file = resolve(root, path === '/' ? 'index.html' : '.' + path);
      if (!file.startsWith(root + sep)) { response.writeHead(404); response.end(); return; }
      const body = path === '/sw.js' ? workerSource : await readFile(file);
      const mime: Record<string, string> = { '.js': 'application/javascript', '.html': 'text/html', '.css': 'text/css', '.webmanifest': 'application/manifest+json', '.png': 'image/png', '.svg': 'image/svg+xml' };
      response.writeHead(200, { 'Content-Type': mime[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
      response.end(body);
    } catch { response.writeHead(404); response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    await mockWorkspace(page);
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Preview server did not start.');
    await page.goto(`http://127.0.0.1:${address.port}`);
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
    await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
    const composer = page.getByRole('textbox', { name: 'Message #general' });
    await composer.fill('Keep my draft while updating');
    workerSource = initialWorker.replace(/const CACHE_NAME = CACHE_PREFIX \+ '[^']+';/, "const CACHE_NAME = CACHE_PREFIX + 'test-next-release';");
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())!.update(); });
    await expect(page.getByRole('status').filter({ hasText: 'new version' })).toBeVisible();
    await expect(composer).toHaveValue('Keep my draft while updating');
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.getRegistration())?.waiting)).toBe(true);
    await page.getByRole('button', { name: 'Update app', exact: true }).click();
    await Promise.all([page.waitForEvent('domcontentloaded'), page.getByRole('button', { name: 'Update now', exact: true }).click()]);
    await expect(composer).toHaveValue('Keep my draft while updating');
    await expect(page.getByRole('status').filter({ hasText: 'new version' })).toHaveCount(0);
    const cachesAfter = await page.evaluate(async () => (await caches.keys()).filter(name => name.startsWith('hays-messages-shell-')));
    expect(cachesAfter).toEqual(['hays-messages-shell-test-next-release']);
  } finally { await new Promise<void>(resolve => server.close(() => resolve())); }
});
