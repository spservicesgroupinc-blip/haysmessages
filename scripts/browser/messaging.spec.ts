import { test, expect, type Page } from '@playwright/test';
import { account, connectWorkspace, signIn } from './workspace';

async function workspace(page: Page) {
  const server = await connectWorkspace(page);
  await signIn(page);
  return server;
}
async function nav(page: Page) {
  const button = page.getByRole('button', { name: 'Open navigation' });
  if (await button.isVisible()) await button.click();
}
async function choose(page: Page, name: string) {
  await nav(page);
  await page.locator('.conversation-link').filter({ hasText: name }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('a missing notification module does not fail sending or retain a sent draft', async ({ page }) => {
  const server = await connectWorkspace(page, { withoutPushEnqueue: true });
  await signIn(page);
  const composer = page.getByRole('textbox', { name: 'Message #general' });
  await composer.fill('Saved without notification module');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(composer).toHaveValue('');
  const message = page.locator('article').filter({ hasText: 'Saved without notification module' });
  await expect(message).toHaveCount(1);
  await expect(page.getByRole('alert')).toHaveCount(0);
  await message.getByRole('button', { name: 'Reply', exact: true }).click();
  const reply = page.getByRole('textbox', { name: 'Reply to thread' });
  await reply.fill('Reply saved without notification module');
  await page.getByRole('complementary', { name: 'Message thread' }).getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(reply).toHaveValue('');
  await expect(page.getByText('Reply saved without notification module', { exact: true })).toBeVisible();
  expect(server.sheets.get('Messages').data).toHaveLength(3);
});

test('authenticated workspace sends, edits, reacts, replies, searches, deletes and persists messages', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  await workspace(page);
  if (info.project.name === 'desktop') await expect(page.getByRole('button', { name: 'Open navigation' })).toBeHidden();
  await page.getByRole('textbox', { name: 'Message #general' }).fill('Crew update from browser test');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const card = page.locator('article').filter({ hasText: 'Crew update from browser test' });
  await expect(card).toBeVisible();
  await card.getByRole('button', { name: 'Edit message' }).click();
  await card.getByRole('textbox', { name: 'Edit message' }).fill('Revised crew update');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const revised = page.locator('article').filter({ hasText: 'Revised crew update' });
  await revised.getByRole('button', { name: 'Add reaction' }).click();
  await revised.getByRole('button', { name: 'React heart', exact: true }).click();
  await expect(revised.getByRole('button', { name: 'React heart, 1' })).toHaveAttribute('aria-pressed', 'true');
  await revised.getByRole('button', { name: 'Reply', exact: true }).click();
  await page.getByRole('textbox', { name: 'Reply to thread' }).fill('The handoff is ready');
  await page.getByRole('complementary', { name: 'Message thread' }).getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText('The handoff is ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close thread' }).click();
  await expect(revised.getByRole('button', { name: '1 reply' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Search this conversation' }).fill('handoff is ready');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await expect(page.getByText('The handoff is ready', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Clear search' }).click();
  await revised.getByRole('button', { name: 'Delete message' }).click();
  await page.getByRole('button', { name: 'Remove message', exact: true }).click();
  const removed = page.locator('article').filter({ hasText: 'This message was removed.' });
  await expect(removed).toBeVisible();
  await removed.getByRole('button', { name: '1 reply' }).click();
  await expect(page.getByText('The handoff is ready', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Reply to thread' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Close thread' }).click();
  await page.reload();
  await expect(page.getByText('This message was removed.', { exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-workspace.png`, fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test('creates channels, direct and group conversations, preserves drafts and signs out', async ({ page }) => {
  await workspace(page);
  await page.getByRole('textbox', { name: 'Message #general' }).fill('Unsent draft');
  await choose(page, 'sales');
  await choose(page, 'general');
  await expect(page.getByRole('textbox', { name: 'Message #general' })).toHaveValue('Unsent draft');
  await nav(page); await page.getByRole('button', { name: 'Create channel', exact: true }).click();
  await page.getByRole('textbox', { name: 'Channel name' }).fill('field-updates');
  await page.getByRole('button', { name: 'Create conversation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'field-updates', exact: true })).toBeVisible();
  await nav(page); await page.getByRole('button', { name: 'Create direct message', exact: true }).click();
  await page.getByRole('radio', { name: 'Teammate One' }).check();
  await page.getByRole('button', { name: 'Start conversation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Teammate One', exact: true })).toBeVisible();
  await nav(page); await page.getByRole('button', { name: 'Create group', exact: true }).click();
  await page.getByRole('textbox', { name: 'Group name' }).fill('Field crew');
  await page.getByRole('checkbox', { name: 'Teammate Two' }).check();
  await page.getByRole('checkbox', { name: 'Teammate Three' }).check();
  await page.getByRole('button', { name: 'Create conversation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Field crew', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Conversation details' }).click();
  await expect(page.getByRole('heading', { name: '3 teammates' })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await nav(page); await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to your workspace.' })).toBeVisible();
});

test('loads older messages with tied timestamps and searches paginated results', async ({ page }) => {
  const server = await workspace(page);
  const session = server.ok('login', { email: account.email, password: account.password });
  const conversationId = server.ok('bootstrap', {}, session).conversations.find((c: {name: string}) => c.name === 'general').id;
  for (let i = 0; i < 125; i++) server.ok('sendMessage', { conversationId, body: `Pagination update ${i}`, clientId: `test-${i}` }, session);
  server.sheets.get('Messages').data.slice(1).forEach((row: unknown[]) => { row[5] = new Date(Date.now() - 1000).toISOString(); });
  await page.reload();
  await page.locator('.message-list').evaluate(e => { e.scrollTop = 0; });
  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(page.getByText('Pagination update 0', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Load earlier messages' })).toHaveCount(0);
  await page.getByRole('textbox', { name: 'Search this conversation' }).fill('Pagination update');
  await page.getByRole('button', { name: 'Search', exact: true }).click();
  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(page.locator('.message-list article')).toHaveCount(125);
});

test('configured login preserves failed-send draft, retries the same identifier and handles expiry', async ({ page }) => {
  const user = { email: 'test@hays.test', name: 'Test teammate', role: 'admin' };
  const session = { token: 'browser-session', expiresAt: new Date(Date.now() + 3600000).toISOString(), user };
  const conversation = { id: 'general', name: 'general', description: 'Company updates', kind: 'channel', members: [], createdBy: 'SYSTEM', createdAt: new Date().toISOString(), lastActivity: new Date().toISOString(), unread: 0 };
  const messages: Record<string, unknown>[] = []; const identifiers: string[] = []; let expired = false;
  await page.route('https://script.google.com/**', async route => {
    const body = route.request().postDataJSON(); let data: unknown;
    if (expired && body.sessionToken) { await route.fulfill({ json: { ok: false, error: 'Your session has expired. Please sign in again.', code: 'session_expired' } }); return; }
    switch (body.action) {
      case 'registrationInfo': data = { enabled: true, requiresInvite: false, minPasswordLength: 10 }; break;
      case 'login': data = session; break;
      case 'bootstrap': data = { user, people: [user], conversations: [conversation] }; break;
      case 'listMessages': data = { messages, hasMore: false, nextBeforeId: messages[0]?.id || '', readThrough: messages.at(-1)?.createdAt || '' }; break;
      case 'markRead': case 'logout': data = { ok: true }; break;
      case 'sendMessage': {
        identifiers.push(body.clientId);
        if (!messages.length) messages.push({ id: 'sent', conversationId: 'general', authorEmail: user.email, authorName: user.name, body: body.body, createdAt: new Date().toISOString(), updatedAt: '', deleted: false, parentId: '', reactions: {}, clientId: body.clientId });
        if (identifiers.length === 1) { await route.abort('failed'); return; }
        data = messages[0]; break;
      }
      default: throw new Error(`Unexpected action ${body.action}`);
    }
    await route.fulfill({ json: { ok: true, data } });
  });
  await page.goto('http://localhost:3002');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('fake browser password');
  await page.locator('form').getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
  const composer = page.getByRole('textbox', { name: 'Message #general' });
  await composer.fill('Retry without duplication');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your message is still here');
  await expect(composer).toHaveValue('Retry without duplication');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(composer).toHaveValue('');
  expect(identifiers).toHaveLength(2); expect(identifiers[0]).toBe(identifiers[1]);
  await expect(page.locator('article').filter({ hasText: 'Retry without duplication' })).toHaveCount(1);
  expired = true;
  await composer.fill('Expired session');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('form').getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toContainText('Your session has expired');
});

test('ignores stale conversation responses and supports the original deployed pagination API', async ({ page }) => {
  const user = { email: 'legacy@hays.test', name: 'Legacy teammate', role: 'member' };
  const session = { token: 'legacy-session', expiresAt: new Date(Date.now() + 3600000).toISOString(), user };
  const now = new Date().toISOString();
  const conversations = ['general', 'sales'].map(id => ({ id, name: id, description: '', kind: 'channel', members: [], createdBy: 'SYSTEM', createdAt: now, lastActivity: now, unread: 0 }));
  const messages = Array.from({ length: 110 }, (_, i) => ({ id: `sales-${i}`, conversationId: 'sales', authorEmail: user.email, authorName: user.name, body: `Sales history ${i}`, createdAt: new Date(Date.now() - (111 - i) * 1000).toISOString(), updatedAt: '', deleted: false, parentId: '', reactions: {}, clientId: `legacy-${i}` }));
  let releaseGeneral: () => void = () => {};
  const generalGate = new Promise<void>(resolve => { releaseGeneral = resolve; });
  let generalStarted = false, generalFinished = false;
  const receipts: string[] = [];
  await page.route('https://script.google.com/**', async route => {
    const body = route.request().postDataJSON(); let data: unknown;
    switch (body.action) {
      case 'registrationInfo': data = { enabled: false, requiresInvite: false, minPasswordLength: 10 }; break;
      case 'bootstrap': data = { user, people: [user], conversations }; break;
      case 'listMessages': {
        if (body.conversationId === 'general') {
          generalStarted = true; await generalGate;
          try { await route.fulfill({ json: { ok: true, data: { messages: [{ ...messages[0], id: 'stale', conversationId: 'general', body: 'Stale general response' }], hasMore: false } } }); }
          catch { /* Switching conversation intentionally aborts this request. */ }
          generalFinished = true; return;
        }
        const candidates = messages.filter(m => !body.before || m.createdAt < body.before);
        data = { messages: candidates.slice(-100), hasMore: candidates.length > 100 }; break;
      }
      case 'markRead': receipts.push(body.through); data = { ok: true }; break;
      default: throw new Error(`Unexpected action ${body.action}`);
    }
    await route.fulfill({ json: { ok: true, data } });
  });
  await page.addInitScript(value => localStorage.setItem('hays.messages.session.v1', JSON.stringify(value)), session);
  await page.goto('http://localhost:3002');
  await expect.poll(() => generalStarted).toBe(true);
  await choose(page, 'sales');
  releaseGeneral();
  await expect.poll(() => generalFinished).toBe(true);
  await expect(page.locator('.message-list article')).toHaveCount(100);
  await expect(page.getByText('Stale general response', { exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Load earlier messages' }).click();
  await expect(page.locator('.message-list article')).toHaveCount(110);
  await expect(page.getByRole('button', { name: 'Load earlier messages' })).toHaveCount(0);
  await expect.poll(() => receipts.length).toBeGreaterThan(0);
  expect(receipts[0]).toBe(messages.at(-1)?.createdAt);
});
