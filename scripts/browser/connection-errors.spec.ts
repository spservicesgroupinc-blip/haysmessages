import { test, expect } from '@playwright/test';
import { account, connectWorkspace, signIn } from './workspace';

test('HTML during sign-in identifies the endpoint and preserves credentials for a manual retry', async ({ page }) => {
  await connectWorkspace(page);
  let attempts = 0;
  await page.route('https://script.google.com/**', async route => {
    if (route.request().postDataJSON().action === 'login' && ++attempts === 1) {
      await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><html>Unexpected Google response</html>' });
    } else await route.fallback();
  });
  await page.goto('http://localhost:3002');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  const submit = page.getByRole('form', { name: 'Company sign in' }).getByRole('button', { name: 'Sign in', exact: true });
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('an HTML page for login (HTTP 200)');
  await expect(page.getByRole('alert')).toContainText('Connected workspace: https://script.google.com/macros/s/browser-test/exec');
  expect(attempts).toBe(1);
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue(account.password);
  await submit.click();
  await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
});

test('workspace and messages recover from temporary Google HTML responses', async ({ page }) => {
  await connectWorkspace(page);
  const attempts: Record<string, number> = {};
  await page.route('https://script.google.com/**', async route => {
    const { action } = route.request().postDataJSON();
    if (['bootstrap', 'listMessages'].includes(action)) {
      attempts[action] = (attempts[action] || 0) + 1;
      if (attempts[action] === 1) {
        await route.fulfill({ status: 503, contentType: 'text/html', body: '<html>Temporarily unavailable</html>' });
        return;
      }
    }
    await route.fallback();
  });
  await signIn(page);
  await expect(page.getByRole('textbox', { name: 'Message #general' })).toBeVisible();
  await expect(page.getByText('Start the conversation', { exact: true })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(attempts.bootstrap).toBe(2); expect(attempts.listMessages).toBe(2);
});

test('HTML after saving a message retains the draft and manual retry returns the same saved message', async ({ page }) => {
  const server = await connectWorkspace(page);
  const identifiers: string[] = [];
  await page.route('https://script.google.com/**', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'sendMessage') {
      identifiers.push(body.clientId);
      if (identifiers.length === 1) {
        server.ok(body.action, body, { token: body.sessionToken });
        await route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad Gateway</html>' });
        return;
      }
    }
    await route.fallback();
  });
  await signIn(page);
  const composer = page.getByRole('textbox', { name: 'Message #general' });
  await composer.fill('Message retained after Google HTML');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Your message is still here');
  await expect(composer).toHaveValue('Message retained after Google HTML');
  expect(identifiers).toHaveLength(1);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(composer).toHaveValue('');
  await expect.poll(() => identifiers.length).toBe(2);
  expect(identifiers[0]).toBe(identifiers[1]);
  expect(server.sheets.get('Messages').data).toHaveLength(2);
  await expect(page.locator('article').filter({ hasText: 'Message retained after Google HTML' })).toHaveCount(1);
});
