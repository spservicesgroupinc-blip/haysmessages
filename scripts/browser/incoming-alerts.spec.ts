import { test, expect, type Page } from '@playwright/test';
import { account, connectWorkspace, signIn } from './workspace';

async function choose(page: Page, name: string) {
  const open = page.getByRole('button', { name: 'Open navigation' });
  if (await open.isVisible()) await open.click();
  await page.locator('.conversation-link').filter({ hasText: name }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}

test('another account receives a saved message and a pop-up within the foreground refresh window', async ({ page, browser }, info) => {
  await page.clock.install();
  const server = await connectWorkspace(page);
  await signIn(page);
  await expect(page.getByText('Start the conversation', { exact: true })).toBeVisible();
  await expect(page.getByRole('complementary', { name: 'Message alerts' })).toHaveCount(0);
  const senderContext = await browser.newContext({ viewport: { width: 1100, height: 900 } });
  try {
    const sender = await senderContext.newPage();
    await sender.route('https://script.google.com/**', async route => {
      const body = route.request().postDataJSON();
      await route.fulfill({ json: server.call(body.action, body, body.sessionToken ? { token: body.sessionToken } : undefined) });
    });
    await sender.goto('http://localhost:3002');
    await sender.getByRole('textbox', { name: 'Username', exact: true }).fill('one@hays.test');
    await sender.getByLabel('Password', { exact: true }).fill(account.password);
    await sender.getByRole('form', { name: 'Company sign in' }).getByRole('button', { name: 'Sign in', exact: true }).click();
    await expect(sender.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
    await sender.getByRole('textbox', { name: 'Message #general' }).fill('Crew is ready for the customer walkthrough.');
    await sender.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(sender.locator('.message-list article').filter({ hasText: 'Crew is ready for the customer walkthrough.' })).not.toHaveAttribute('aria-busy', 'true');
    await page.clock.runFor(2500);
    await expect(page.locator('.message-list article').filter({ hasText: 'Crew is ready for the customer walkthrough.' })).toHaveCount(1, { timeout: 1500 });
    const alerts = page.getByRole('complementary', { name: 'Message alerts' });
    await expect(alerts).toContainText('Teammate One');
    await expect(alerts).toContainText('Crew is ready for the customer walkthrough.');
    await page.clock.runFor(4500);
    await expect(alerts.getByRole('status')).toHaveCount(1);
    await page.screenshot({ path: `test-results/${info.project.name}-incoming-message-alert.png`, fullPage: true });
    await alerts.getByRole('button', { name: 'Dismiss message alert' }).click();
    await page.clock.runFor(6000);
    await expect(page.getByRole('complementary', { name: 'Message alerts' })).toHaveCount(0);
    await choose(page, 'sales');
    await page.getByRole('textbox', { name: 'Message #sales' }).fill('Draft stays while an alert arrives');
    await sender.getByRole('textbox', { name: 'Message #general' }).fill('Second walkthrough update');
    await sender.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(sender.locator('.message-list article').filter({ hasText: 'Second walkthrough update' })).not.toHaveAttribute('aria-busy', 'true');
    await page.clock.runFor(5500);
    await expect(page.getByRole('heading', { name: 'sales', exact: true })).toBeVisible();
    await page.getByRole('complementary', { name: 'Message alerts' }).getByRole('button', { name: 'Open conversation' }).click();
    await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
    await expect(page.locator('.message-list article').filter({ hasText: 'Second walkthrough update' })).toHaveCount(1);
    await choose(page, 'sales');
    await expect(page.getByRole('textbox', { name: 'Message #sales' })).toHaveValue('Draft stays while an alert arrives');
  } finally { await senderContext.close(); }
});

test('a slow read receipt does not hold up receiving the next message', async ({ page }) => {
  await page.clock.install();
  const server = await connectWorkspace(page);
  const sender = server.ok('login', { email: 'one@hays.test', password: account.password });
  const id = server.ok('bootstrap', {}, sender).conversations.find((c: {name: string}) => c.name === 'general').id;
  server.ok('sendMessage', { conversationId: id, body: 'Existing history', clientId: 'history' }, sender);
  let release: () => void = () => {};
  const gate = new Promise<void>(resolve => { release = resolve; });
  let receiptStarted = false;
  await page.route('https://script.google.com/**', async route => {
    if (route.request().postDataJSON().action === 'markRead') { receiptStarted = true; await gate; }
    await route.fallback();
  });
  try {
    await signIn(page);
    await expect.poll(() => receiptStarted).toBe(true);
    await expect(page.locator('.message-list article').filter({ hasText: 'Existing history' })).toHaveCount(1);
    await expect(page.getByRole('complementary', { name: 'Message alerts' })).toHaveCount(0);
    server.ok('sendMessage', { conversationId: id, body: 'New message while read receipt waits', clientId: 'while-receipt-waits' }, sender);
    await page.clock.runFor(2500);
    await expect(page.locator('.message-list article').filter({ hasText: 'New message while read receipt waits' })).toHaveCount(1, { timeout: 1500 });
  } finally { release(); }
});
