import { createRequire } from 'node:module';
import { expect, type Page } from '@playwright/test';

const require = createRequire(import.meta.url);
const { backend } = require('../helpers/backend.cjs');
export const account = { email: 'browser@hays.test', name: 'Test teammate', password: 'correct browser password' };

// Browser requests execute the real Code.gs against isolated Google service doubles.
// These accounts and messages exist only in the test process.
export async function connectWorkspace(page: Page, options: { channels?: boolean } = {}) {
  const server = backend(options);
  server.context.createUser(account.email, account.name, account.password, 'admin');
  for (const name of ['One', 'Two', 'Three']) {
    server.context.createUser(`${name.toLowerCase()}@hays.test`, `Teammate ${name}`, account.password, 'member');
  }
  await page.route('https://script.google.com/**', async route => {
    const body = route.request().postDataJSON();
    const result = server.call(body.action, body, body.sessionToken ? { token: body.sessionToken } : undefined);
    await route.fulfill({ json: result });
  });
  return server;
}

export async function signIn(page: Page) {
  await page.goto('http://localhost:3002');
  await page.getByRole('textbox', { name: 'Username', exact: true }).fill(account.email);
  await page.getByLabel('Password', { exact: true }).fill(account.password);
  await page.getByRole('form', { name: 'Company sign in' }).getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'general', exact: true })).toBeVisible();
}
