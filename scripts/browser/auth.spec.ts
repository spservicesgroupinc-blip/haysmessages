import { test, expect } from '@playwright/test';
import { account, connectWorkspace } from './workspace';

test('requires a company account and disables sign-in when no backend is configured', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to your workspace.' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText('Contact your administrator');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: /demo/i })).toHaveCount(0);
  await expect(page.locator('.app-shell')).toHaveCount(0);
});

test('removes old preview data and never restores a demo session', async ({ page }) => {
  await connectWorkspace(page);
  await page.addInitScript(() => {
    localStorage.setItem('hays.messages.session.v1', JSON.stringify({ token: 'local-demo', demo: true, expiresAt: new Date(Date.now() + 3600000).toISOString(), user: { email: 'you@hays.example', name: 'You', role: 'admin' } }));
    localStorage.setItem('hays.messages.demo.v1', JSON.stringify({ messages: [{ body: 'Old preview message' }] }));
    sessionStorage.setItem('hays.draft:you@hays.example:general', JSON.stringify({ body: 'Old preview draft', id: 'old-draft' }));
  });
  await page.goto('http://localhost:3002');
  await expect(page.getByRole('heading', { name: 'Sign in to your workspace.' })).toBeVisible();
  await expect(page.locator('.app-shell')).toHaveCount(0);
  expect(await page.evaluate(() => ({ session: localStorage.getItem('hays.messages.session.v1'), data: localStorage.getItem('hays.messages.demo.v1'), draft: sessionStorage.getItem('hays.draft:you@hays.example:general') }))).toEqual({ session: null, data: null, draft: null });
});

test('authenticates email and password through Apps Script, rejects wrong passwords, and signs out', async ({ page }, info) => {
  const server = await connectWorkspace(page);
  await page.goto('http://localhost:3002');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(account.email.toUpperCase());
  const password = page.getByLabel('Password', { exact: true });
  await password.fill('incorrect password');
  await page.getByRole('button', { name: 'Show password' }).click();
  await expect(password).toHaveAttribute('type', 'text');
  await page.getByRole('button', { name: 'Hide password' }).click();
  await expect(password).toHaveAttribute('type', 'password');
  const submit = page.getByRole('form', { name: 'Company sign in' }).getByRole('button', { name: 'Sign in', exact: true });
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('Incorrect email or password');
  await expect(page.locator('.app-shell')).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem('hays.messages.session.v1'))).toBeNull();
  await password.fill(account.password);
  await submit.click();
  await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
  await expect(page.locator('.message-list article')).toHaveCount(0);
  const stored = await page.evaluate(() => localStorage.getItem('hays.messages.session.v1'));
  expect(stored).not.toContain(account.password);
  expect(JSON.parse(stored!).user.email).toBe(account.email);
  await page.reload();
  await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
  const menu = page.getByRole('button', { name: 'Open navigation' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to your workspace.' })).toBeVisible();
  expect(server.sheets.get('Sessions').data).toHaveLength(1);
  expect(await page.evaluate(() => localStorage.getItem('hays.messages.session.v1'))).toBeNull();
  await page.screenshot({ path: `test-results/${info.project.name}-login.png`, fullPage: true });
});

test('creates a Sheet-backed member account only with a valid invite', async ({ page }) => {
  const server = await connectWorkspace(page);
  await page.goto('http://localhost:3002');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill('New teammate');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill('new@hays.test');
  await page.getByLabel('Password', { exact: true }).fill('new member password');
  await page.getByRole('textbox', { name: 'Company invite code' }).fill('incorrect invite');
  const submit = page.getByRole('form', { name: 'Create company account' }).getByRole('button', { name: 'Create account', exact: true });
  await submit.click();
  await expect(page.getByRole('alert')).toContainText('invite code is incorrect');
  await page.getByRole('textbox', { name: 'Company invite code' }).fill(server.properties.get('REGISTRATION_CODE'));
  await submit.click();
  await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
  const row = server.sheets.get('Users').data.find((value: unknown[]) => value[0] === 'new@hays.test');
  expect(row[2]).toBe('member');
  expect(row[4]).not.toBe('new member password');
});

test('existing accounts can sign in when account discovery is unavailable', async ({ page }) => {
  await connectWorkspace(page);
  await page.route('https://script.google.com/**', async route => {
    if (route.request().postDataJSON().action === 'registrationInfo') await route.abort('failed');
    else await route.fallback();
  });
  await page.goto('http://localhost:3002');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('form', { name: 'Company sign in' }).getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
});

test('an empty Google Sheet workspace shows onboarding and creates its first real channel', async ({ page }) => {
  const server = await connectWorkspace(page, { channels: false });
  await page.goto('http://localhost:3002');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('form', { name: 'Company sign in' }).getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome to your workspace' })).toBeVisible();
  await expect(page.locator('.conversation-link')).toHaveCount(0);
  await page.getByRole('button', { name: 'Create a channel', exact: true }).click();
  await page.getByRole('textbox', { name: 'Channel name' }).fill('company-updates');
  await page.getByRole('button', { name: 'Create conversation', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'company-updates', exact: true })).toBeVisible();
  expect(server.sheets.get('Conversations').data).toHaveLength(2);
  expect(server.sheets.get('Messages').data).toHaveLength(1);
});
