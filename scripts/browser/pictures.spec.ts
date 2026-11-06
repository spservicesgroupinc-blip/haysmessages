import { test, expect, type Page } from '@playwright/test';
import { account, connectWorkspace, signIn } from './workspace';

async function fixture(page: Page, width = 640) {
  const data = await page.evaluate(width => {
    const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = 400;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#e9eff4'; ctx.fillRect(0, 0, width, 400);
    ctx.fillStyle = '#334155'; ctx.fillRect(50, 90, 520, 260);
    ctx.fillStyle = '#94a3b8'; ctx.fillRect(70, 110, 220, 220);
    ctx.fillStyle = '#f8fafc'; ctx.fillRect(310, 110, 240, 220);
    ctx.fillStyle = '#dc2626'; ctx.fillRect(330, 270, 200, 5);
    ctx.fillStyle = '#334155'; ctx.font = '24px sans-serif'; ctx.fillText('Site inspection · kitchen', 50, 55);
    return canvas.toDataURL('image/png').split(',')[1];
  }, width);
  return { name: 'site-inspection.png', mimeType: 'image/png', buffer: Buffer.from(data, 'base64') };
}
async function choose(page: Page, name: string) {
  const open = page.getByRole('button', { name: 'Open navigation' });
  if (await open.isVisible()) await open.click();
  await page.locator('.conversation-link').filter({ hasText: name }).click();
  await expect(page.getByRole('heading', { name, exact: true })).toBeVisible();
}
async function decoded(page: Page) {
  await expect.poll(() => page.locator('.message-picture img').first().evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
}

test('private pictures render during upload, reach another account, reload and work in threads', async ({ page, browser }, info) => {
  test.setTimeout(60000);
  const server = await connectWorkspace(page); await signIn(page);
  await page.getByLabel('Choose picture', { exact: true }).setInputFiles(await fixture(page));
  await expect(page.getByAltText('Selected picture')).toBeVisible();
  await choose(page, 'sales'); await choose(page, 'general');
  await expect(page.getByAltText('Selected picture')).toBeVisible();
  await page.getByRole('textbox', { name: 'Message #general' }).fill('Kitchen inspection — ready for review');
  let release = () => {}; const gate = new Promise<void>(resolve => { release = resolve; });
  await page.route('https://script.google.com/**', async route => {
    if (route.request().postDataJSON().action === 'uploadAttachment') await gate;
    await route.fallback();
  });
  try {
    await page.getByRole('button', { name: 'Send message', exact: true }).click();
    const bubble = page.locator('.message-list article').filter({ hasText: 'Kitchen inspection — ready for review' });
    await expect(bubble).toContainText('Uploading picture…'); await decoded(page);
    await choose(page, 'sales'); await choose(page, 'general');
    await expect(bubble).toContainText('Uploading picture…'); await decoded(page);
    release(); await expect(bubble).not.toHaveAttribute('aria-busy', 'true');
    expect(server.files.size).toBe(1);
    expect([...server.files.values()].every((file: any) => file.access === 'PRIVATE')).toBe(true);
    const stored = await page.evaluate(() => JSON.stringify({ ...localStorage, ...sessionStorage }));
    expect(stored).not.toContain('data:image');
    await page.screenshot({ path: `test-results/${info.project.name}-picture-message.png`, fullPage: true });
    await bubble.getByRole('button', { name: /Open picture:/ }).click();
    await expect(page.getByRole('dialog', { name: 'Picture', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Save picture' })).toHaveAttribute('download', 'site-inspection.png');
    await page.getByRole('button', { name: 'Close dialog' }).click();
    await page.reload(); await decoded(page);
    const recipientContext = await browser.newContext({ viewport: { width: 1050, height: 900 } });
    try {
      const recipient = await recipientContext.newPage();
      await recipient.route('https://script.google.com/**', async route => {
        const body = route.request().postDataJSON();
        await route.fulfill({ json: server.call(body.action, body, { token: body.sessionToken }) });
      });
      await recipient.goto('http://localhost:3002');
      await recipient.getByRole('textbox', { name: 'Username', exact: true }).fill('one@hays.test');
      await recipient.getByLabel('Password', { exact: true }).fill(account.password);
      await recipient.getByRole('form', { name: 'Company sign in' }).getByRole('button', { name: 'Sign in', exact: true }).click();
      await expect(recipient.getByText('Kitchen inspection — ready for review', { exact: true })).toBeVisible();
      await decoded(recipient);
    } finally { await recipientContext.close(); }
    await page.locator('.message-list article').getByRole('button', { name: 'Reply', exact: true }).click();
    const thread = page.getByRole('complementary', { name: 'Message thread' });
    await thread.getByLabel('Choose picture', { exact: true }).setInputFiles(await fixture(page));
    await expect(thread.getByAltText('Selected picture')).toBeVisible();
    await thread.getByRole('button', { name: 'Send message', exact: true }).click();
    await expect(thread.locator('.message-picture')).toHaveCount(2);
    await expect(thread.locator('article').last()).not.toHaveAttribute('aria-busy', 'true');
    expect(server.files.size).toBe(2);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  } finally { release(); }
});

test('a lost upload response and then a failed message send retry without duplicate files', async ({ page }) => {
  const server = await connectWorkspace(page); await signIn(page);
  let uploads = 0, sends = 0;
  await page.route('https://script.google.com/**', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'uploadAttachment' && ++uploads === 1) {
      server.ok(body.action, body, { token: body.sessionToken }); await route.abort('failed'); return;
    }
    if (body.action === 'sendMessage' && ++sends === 1) { await route.abort('failed'); return; }
    await route.fallback();
  });
  await page.getByLabel('Choose picture', { exact: true }).setInputFiles(await fixture(page));
  await expect(page.getByAltText('Selected picture')).toBeVisible();
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  const bubble = page.locator('.message-list article');
  await expect(bubble).toContainText('Not sent'); expect(server.files.size).toBe(1);
  await bubble.getByRole('button', { name: 'Retry sending', exact: true }).click();
  await expect.poll(() => sends).toBe(1); await expect(bubble).toContainText('Not sent');
  await bubble.getByRole('button', { name: 'Retry sending', exact: true }).click();
  await expect(bubble).not.toContainText('Not sent'); await expect(bubble).not.toHaveAttribute('aria-busy', 'true');
  await expect(bubble).toHaveCount(1); await expect(page.getByAltText('Selected picture')).toHaveCount(0);
  expect(uploads).toBe(2); expect(sends).toBe(2); expect(server.files.size).toBe(1);
  await page.reload(); await decoded(page);
});

test('legacy backend is blocked before upload and unsupported picture formats are recoverable', async ({ page }) => {
  await connectWorkspace(page); await signIn(page); let uploads = 0;
  await page.route('https://script.google.com/**', async route => {
    const body = route.request().postDataJSON();
    if (body.action === 'pictureConfig') { await route.fulfill({ json: { ok: false, code: 'bad_request', error: 'Unknown action' } }); return; }
    if (body.action === 'uploadAttachment') uploads++;
    await route.fallback();
  });
  await page.getByLabel('Choose picture', { exact: true }).setInputFiles({ name: 'unsafe.svg', mimeType: 'image/svg+xml', buffer: Buffer.from('<svg/>') });
  await expect(page.getByRole('alert')).toContainText('Choose a JPG');
  await page.getByLabel('Choose picture', { exact: true }).setInputFiles(await fixture(page, 3072));
  await expect(page.getByAltText('Selected picture')).toBeVisible();
  expect(await page.getByAltText('Selected picture').evaluate((img: HTMLImageElement) => img.naturalWidth)).toBe(2048);
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.locator('.message-list article')).toContainText('Apps Script needs an update');
  expect(uploads).toBe(0);
  await expect(page.getByAltText('Selected picture')).toBeVisible();
});
