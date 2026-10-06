import { test, expect } from '@playwright/test';
import { account, connectWorkspace } from './workspace';

test('an empty environment URL uses the default Apps Script connection and allows signup', async ({ page }, info) => {
  const server = await connectWorkspace(page);
  const endpoints: string[] = [];
  page.on('request', request => { if (request.url().startsWith('https://script.google.com/')) endpoints.push(request.url()); });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Sign in to your workspace.' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeEnabled();
  await expect(page.getByRole('textbox', { name: 'Username', exact: true })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /demo/i })).toHaveCount(0);
  await expect(page.locator('.app-shell')).toHaveCount(0);
  await page.screenshot({ path: `test-results/${info.project.name}-default-connection-login.png`, fullPage: true });
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill('New teammate');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill('first.signup@gmail.com');
  await page.getByLabel('Password', { exact: true }).fill('new member password');
  await expect(page.getByRole('textbox', { name: /invite/i })).toHaveCount(0);
  await page.getByRole('form', { name: 'Create company account' }).getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
  expect(server.sheets.get('Users').data.some((row: unknown[]) => row[0] === 'first.signup@gmail.com')).toBe(true);
  expect(endpoints).toContain('https://script.google.com/macros/s/AKfycbwkB2KIrVF3i3ZNM7TmFCUF1QkKWkJRj8aljoo-Stwz_ihD5eSfzUaec0t_pe4zCFrT5w/exec');
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

test('any email can create a Sheet-backed member account without an invite', async ({ page }) => {
  const server = await connectWorkspace(page);
  await page.goto('http://localhost:3002');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill('New teammate');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill('new.member@outlook.com');
  await page.getByLabel('Password', { exact: true }).fill('new member password');
  await expect(page.getByRole('textbox', { name: /invite/i })).toHaveCount(0);
  const submit = page.getByRole('form', { name: 'Create company account' }).getByRole('button', { name: 'Create account', exact: true });
  await submit.click();
  await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
  const row = server.sheets.get('Users').data.find((value: unknown[]) => value[0] === 'new.member@outlook.com');
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

test('Create account opens without waiting for registration settings', async ({ page }, info) => {
  await connectWorkspace(page);
  let discoveryRequests = 0;
  await page.route('https://script.google.com/**', async route => {
    if (route.request().postDataJSON().action === 'registrationInfo') {
      discoveryRequests++;
      await route.fulfill({ json: { ok: true, data: { enabled: false, requiresInvite: true, minPasswordLength: 10 } } });
    } else await route.fallback();
  });
  await page.goto('http://localhost:3002', { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeVisible();
  await page.screenshot({ path: `test-results/${info.project.name}-create-account-button.png`, fullPage: true });
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Join your team.' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: 'Your name' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: /invite/i })).toHaveCount(0);
  expect(discoveryRequests).toBe(0);
  await page.getByRole('button', { name: 'Back to sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Sign in to your workspace.' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create account', exact: true })).toBeVisible();
});

test('shows a duplicate-account error while keeping signup fields', async ({ page }) => {
  const server = await connectWorkspace(page);
  await page.goto('http://localhost:3002');
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await page.getByRole('textbox', { name: 'Your name' }).fill('New teammate');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill('new member password');
  await page.getByRole('form', { name: 'Create company account' }).getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('An account with that email already exists');
  await expect(page.getByRole('textbox', { name: 'Username', exact: true })).toHaveValue(account.email);
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('new member password');
  expect(server.sheets.get('Users').data).toHaveLength(5);
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
