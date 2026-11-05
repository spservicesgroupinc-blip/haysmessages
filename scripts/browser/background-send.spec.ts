import { test, expect, type Page } from '@playwright/test';
import { connectWorkspace, signIn } from './workspace';

async function choose(page: Page, name: string) {
  const open = page.getByRole('button', { name: 'Open navigation' });
  if (await open.isVisible()) await open.click();
  await page.locator('.conversation-link').filter({ hasText: name }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('pending messages remain visible across navigation and reconcile with polling before the write response returns', async ({ page }, info) => {
  const server = await connectWorkspace(page);
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let finish: () => void = () => {};
  const responseGate = new Promise<void>(resolve => { finish = resolve; });
  let written = false;
  await page.route('https://script.google.com/**', async route => {
    const body = route.request().postDataJSON();
    if (body.action !== 'sendMessage') { await route.fallback(); return; }
    await gate;
    const result = server.call(body.action, body, { token: body.sessionToken });
    written = true;
    await responseGate;
    await route.fulfill({ json: result });
  });
  try {
    await signIn(page);
    await page.getByRole('textbox', { name: 'Message #general' }).fill('Visible while sending in the background');
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const bubble = page.locator('article').filter({ hasText: 'Visible while sending in the background' });
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toContainText('Sending…');
    await page.screenshot({ path: `test-results/${info.project.name}-sending-message.png`, fullPage: true });
    await choose(page, 'sales'); await choose(page, 'general');
    await expect(bubble).toHaveCount(1);
    await expect(bubble).toContainText('Sending…');
    release(); await expect.poll(() => written).toBe(true);
    // Reopen the conversation to fetch the saved message while its send response is held.
    await choose(page, 'sales'); await choose(page, 'general');
    await expect(bubble).toHaveCount(1);
    await expect(bubble).not.toContainText('Sending…');
    finish();
    await expect(page.getByRole('textbox', { name: 'Message #general' })).toHaveValue('');
    await page.screenshot({ path: `test-results/${info.project.name}-background-send.png`, fullPage: true });
  } finally { release(); finish(); }
});

test('failed sends stay in the message list and retry once with the original identifier', async ({ page }) => {
  await connectWorkspace(page);
  const ids: string[] = [];
  await page.route('https://script.google.com/**', async route => {
    const body = route.request().postDataJSON();
    if (body.action !== 'sendMessage') { await route.fallback(); return; }
    ids.push(body.clientId);
    if (ids.length === 1) await route.abort('failed'); else await route.fallback();
  });
  await signIn(page);
  const composer = page.getByRole('textbox', { name: 'Message #general' });
  await composer.fill('Keep failed messages visible');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const bubble = page.locator('article').filter({ hasText: 'Keep failed messages visible' });
  await expect(bubble).toHaveCount(1);
  await expect(bubble).toContainText('Not sent');
  await expect(composer).toHaveValue('Keep failed messages visible');
  await bubble.getByRole('button', { name: 'Retry sending', exact: true }).click();
  await expect(bubble).not.toContainText('Not sent');
  await expect(composer).toHaveValue('');
  expect(ids).toHaveLength(2); expect(ids[1]).toBe(ids[0]);
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('thread replies remain visible after closing and reopening a thread while sending', async ({ page }) => {
  await connectWorkspace(page); await signIn(page);
  await page.getByRole('textbox', { name: 'Message #general' }).fill('Thread starting point');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const parent = page.locator('article').filter({ hasText: 'Thread starting point' });
  await parent.getByRole('button', { name: 'Reply', exact: true }).click();
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://script.google.com/**', async route => {
    if (route.request().postDataJSON().action === 'sendMessage') await gate;
    await route.fallback();
  });
  try {
    await page.getByRole('textbox', { name: 'Reply to thread' }).fill('Reply delivered in the background');
    await page.getByRole('complementary', { name: 'Message thread' }).getByRole('button', { name: 'Send message', exact: true }).click();
    const reply = page.getByRole('complementary', { name: 'Message thread' }).locator('article').filter({ hasText: 'Reply delivered in the background' });
    await expect(reply).toContainText('Sending…');
    await page.getByRole('button', { name: 'Close thread', exact: true }).click();
    await parent.getByRole('button', { name: '1 reply', exact: true }).click();
    await expect(reply).toContainText('Sending…');
    release();
    await expect(reply).not.toContainText('Sending…');
    await expect(reply).toHaveCount(1);
    await expect(page.getByRole('textbox', { name: 'Reply to thread' })).toHaveValue('');
  } finally { release(); }
});

test('chat controls and message bubbles fit narrow phones, tablets and desktops', async ({ page }, info) => {
  await connectWorkspace(page); await signIn(page);
  for (const width of info.project.name === 'mobile' ? [320, 768] : [1024, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.getByRole('button', { name: 'Conversation details' }).click();
    await expect(page.getByRole('button', { name: 'Delete chat space', exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole('button', { name: 'Close dialog' }).click();
  }
});
