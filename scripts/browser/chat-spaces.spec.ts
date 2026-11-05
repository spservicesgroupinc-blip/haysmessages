import { test, expect, type Page } from '@playwright/test';
import { account, connectWorkspace, signIn } from './workspace';

async function nav(page: Page) {
  const open = page.getByRole('button', { name: 'Open navigation' });
  if (await open.isVisible()) await open.click();
}

async function addChannel(page: Page, name: string) {
  await nav(page);
  await page.getByRole('button', { name: 'Add chat space', exact: true }).click();
  await page.getByRole('textbox', { name: 'Channel name' }).fill(name);
  await page.getByRole('button', { name: 'Create conversation', exact: true }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('adds, cancels and deletes a chat space, then stays deleted after reload and clears cached history', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', e => errors.push(e.message));
  const server = await connectWorkspace(page);
  await signIn(page);
  await addChannel(page, 'project-handoff');
  await page.getByRole('textbox', { name: 'Message #project-handoff' }).fill('Retained project history');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText('Retained project history', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Conversation details' }).click();
  await page.screenshot({ path: `test-results/${info.project.name}-manage-chat-space.png`, fullPage: true });
  await page.getByRole('button', { name: 'Delete chat space', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Delete chat space?' })).toContainText('project-handoff');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(page.getByText('Retained project history', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Delete chat space', exact: true }).click();
  await page.getByRole('button', { name: 'Delete for everyone', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
  await expect(page).not.toHaveURL(/conversation=/);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
  await nav(page);
  await expect(page.locator('.conversation-link').filter({ hasText: 'project-handoff' })).toHaveCount(0);
  const removed = server.sheets.get('Conversations').data.find((row: string[]) => row[1] === 'project-handoff');
  const cachedIds = await page.evaluate(() => new Promise<string[]>((resolve, reject) => {
    const request = indexedDB.open('hays-offline-v1', 1);
    request.onsuccess = () => {
      const db = request.result;
      const rows = db.transaction('reads').objectStore('reads').getAll();
      rows.onsuccess = () => { resolve(rows.result.map(row => row.payload.conversationId || '')); db.close(); };
      rows.onerror = () => { db.close(); reject(rows.error); };
    };
    request.onerror = () => reject(request.error);
  }));
  expect(cachedIds).not.toContain(removed[0]);
  await page.screenshot({ path: `test-results/${info.project.name}-chat-spaces.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('members can delete their own spaces, see permissions on other channels and leave groups', async ({ page }) => {
  const server = await connectWorkspace(page);
  server.sheets.get('Users').data.find((row: string[]) => row[0] === account.email)[2] = 'member';
  const owner = server.ok('login', { email: 'one@hays.test', password: account.password });
  server.ok('createConversation', { kind: 'group', name: 'Field crew', members: [account.email] }, owner);
  await signIn(page);
  await page.getByRole('button', { name: 'Conversation details' }).click();
  await expect(page.getByRole('button', { name: 'Delete chat space', exact: true })).toHaveCount(0);
  await expect(page.getByText('Only the creator or an administrator can delete this chat space.')).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await addChannel(page, 'my-project');
  await page.getByRole('button', { name: 'Conversation details' }).click();
  await expect(page.getByRole('button', { name: 'Delete chat space', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await nav(page);
  await page.locator('.conversation-link').filter({ hasText: 'Field crew' }).click();
  await page.getByRole('button', { name: 'Conversation details' }).click();
  await page.getByRole('button', { name: 'Leave group', exact: true }).click();
  await page.getByRole('button', { name: 'Leave this group', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
  const remaining = server.ok('bootstrap', {}, owner).conversations.find((c: {name: string}) => c.name === 'Field crew');
  expect(remaining.members).not.toContain(account.email);
  expect(remaining.members).toContain(owner.user.email);
});

test('deletion failures keep the space open and explain when the backend needs updating', async ({ page }) => {
  await connectWorkspace(page);
  await page.route('https://script.google.com/**', async route => {
    if (route.request().postDataJSON().action === 'deleteConversation') {
      await route.fulfill({ json: { ok: false, code: 'unknown_action', error: 'Unknown action requested.' } });
    } else await route.fallback();
  });
  await signIn(page);
  await page.getByRole('button', { name: 'Conversation details' }).click();
  await page.getByRole('button', { name: 'Delete chat space', exact: true }).click();
  await page.getByRole('button', { name: 'Delete for everyone', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('backend update');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  await page.getByRole('button', { name: 'Close dialog' }).click();
  await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
});

test('a delayed workspace response cannot restore a deleted space in the offline cache', async ({ page }) => {
  await page.clock.install();
  const server = await connectWorkspace(page);
  await signIn(page);
  await expect(page.getByRole('heading', { name: 'Start the conversation', exact: true })).toBeVisible();
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let held = false;
  let finished = false;
  await page.route('https://script.google.com/**', async route => {
    const body = route.request().postDataJSON();
    if (body.action !== 'bootstrap' || held) { await route.fallback(); return; }
    const result = server.call('bootstrap', body, { token: body.sessionToken });
    held = true;
    await gate;
    await route.fulfill({ json: result });
    finished = true;
  });
  try {
    await page.clock.runFor(16000);
    await expect.poll(() => held).toBe(true);
    await page.getByRole('button', { name: 'Conversation details' }).click();
    await page.getByRole('button', { name: 'Delete chat space', exact: true }).click();
    await page.getByRole('button', { name: 'Delete for everyone', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'sales', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Start the conversation', exact: true })).toBeVisible();
    release();
    await expect.poll(() => finished).toBe(true);
    const names = await page.evaluate(() => new Promise<string[]>((resolve, reject) => {
      const request = indexedDB.open('hays-offline-v1', 1);
      request.onsuccess = () => {
        const db = request.result;
        const rows = db.transaction('reads').objectStore('reads').getAll();
        rows.onsuccess = () => { resolve(rows.result.filter(row => row.action === 'bootstrap').flatMap(row => row.data.conversations.map((c: {name: string}) => c.name))); db.close(); };
        rows.onerror = () => { db.close(); reject(rows.error); };
      };
      request.onerror = () => reject(request.error);
    }));
    expect(names).not.toContain('general');
  } finally { release(); }
});
