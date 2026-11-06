import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { account, connectWorkspace, signIn } from './workspace';
const require = createRequire(import.meta.url);
const { salesRows } = require('../helpers/sales.cjs');
async function openSales(page: Page) {
  const menu = page.getByRole('button', { name: 'Open navigation' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Workspace pages' }).getByRole('button', { name: 'Sales dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Sales dashboard', exact: true })).toBeVisible();
}

test('latest customer notes are visible in the list, searchable, and first in job details', async ({ page }, info) => {
  const errors: string[] = []; page.on('pageerror', error => errors.push(error.message));
  const rows = salesRows.map((row: unknown[]) => [...row]);
  rows[1][14] = '<p><b>Customer requested revised scope &amp; pricing.</b></p><p>Called back and reviewed the kitchen repairs. Customer is comparing the revised allowance with the carrier before signing. Send the updated estimate after the flooring selection is confirmed.</p>';
  rows[2][14] = '<p>&nbsp;</p>';
  rows[3][14] = 'Customer approved the schedule.';
  const server = await connectWorkspace(page, { salesRows: rows });
  await signIn(page); await openSales(page);
  const opportunities = page.getByRole('table', { name: 'Sales opportunities' });
  await expect(opportunities.getByText('Customer requested revised scope & pricing.', { exact: false })).toBeVisible();
  await expect(opportunities.getByText('No note entered', { exact: true })).toHaveCount(2);
  await expect(page.getByRole('button', { name: 'Filter estimator: Estimator One' })).toBeHidden();
  await page.getByText('Estimator & received trends', { exact: true }).click();
  await expect(page.getByRole('button', { name: 'Filter estimator: Estimator One' })).toBeVisible();
  await page.getByText('Estimator & received trends', { exact: true }).click();
  await page.getByRole('textbox', { name: 'Search sales jobs' }).fill('scope & pricing');
  await expect(page.getByRole('button', { name: 'TEST-001', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'TEST-002', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Read note for TEST-001', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.locator('.sales-journal')).toContainText('flooring selection is confirmed.');
  expect(await dialog.evaluate(element => !!(element.querySelector('.sales-journal')!.compareDocumentPosition(element.querySelector('.sales-details')!) & Node.DOCUMENT_POSITION_FOLLOWING))).toBe(true);
  await expect(dialog.locator('.sales-journal b')).toHaveCount(0);
  await page.screenshot({ path: `test-results/${info.project.name}-sales-note-detail.png`, fullPage: true });
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByRole('button', { name: /Pending without notes/ }).click();
  await expect(page.getByRole('button', { name: 'TEST-002', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'TEST-004', exact: true })).toHaveCount(0);
  server.salesSheet.data[2][14] = 'Spoke with customer; inspection confirmed.';
  await page.getByRole('button', { name: 'Refresh', exact: true }).click();
  await expect(page.getByRole('button', { name: 'TEST-002', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  for (const width of info.project.name === 'mobile' ? [320, 768] : [1024, 1440]) {
    await page.setViewportSize({ width, height: 1000 });
    expect(await opportunities.evaluate(element => element.scrollWidth <= element.parentElement!.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  }
  await page.setViewportSize({ width: info.project.name === 'mobile' ? 390 : 1440, height: info.project.name === 'mobile' ? 844 : 1000 });
  if (info.project.name === 'mobile') await expect.poll(() => page.locator('.sidebar').evaluate(element => element.getBoundingClientRect().right)).toBeLessThanOrEqual(0);
  await page.getByLabel('Sort sales jobs').selectOption('oldest');
  await page.locator('.sales-body').evaluate(element => {
    const jobs = element.querySelector('.sales-jobs')!;
    element.scrollTop += jobs.getBoundingClientRect().top - element.getBoundingClientRect().top;
  });
  await page.screenshot({ path: `test-results/${info.project.name}-sales-notes.png`, fullPage: true });
  expect(errors).toEqual([]);
});

test('sales dashboard reads the authenticated sheet, filters totals, refreshes and preserves chat drafts', async ({ page }, info) => {
  const server = await connectWorkspace(page, { salesRows });
  await signIn(page);
  await page.getByRole('textbox', { name: 'Message #general' }).fill('Draft to preserve while reviewing sales');
  await openSales(page);
  await expect(page.locator('.sales-kpi').filter({hasText:'Known estimate value'})).toContainText('$1,234.50');
  await expect(page.locator('.sales-kpi').filter({hasText:'Estimates not entered'})).toContainText('2');
  await expect(page.getByRole('button', { name: 'TEST-001', exact:true })).toBeVisible();
  await expect(page.getByRole('link', {name:'Open source sheet'})).toHaveAttribute('href', /1Ba1IEJEOb3ILhsZrOZSHCOT5-6pELnwGT-inUcVMcTk/);
  await page.screenshot({ path:`test-results/${info.project.name}-sales-dashboard.png`,fullPage:true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel('Estimator', {exact:true}).selectOption('Estimator Two');
  await expect(page.locator('.sales-kpi').filter({hasText:'Known estimate value'})).toContainText('$0.00');
  await expect(page.getByRole('button', {name:'TEST-001', exact:true})).toHaveCount(0);
  await page.getByRole('button', {name:'Clear filters'}).click();
  await page.getByRole('textbox', {name:'Search sales jobs'}).fill('North customer');
  await expect(page.getByRole('button', {name:'TEST-002', exact:true})).toHaveCount(0);
  await page.getByRole('button', {name:'TEST-001', exact:true}).click();
  await expect(page.getByRole('dialog').getByText('Awaiting signature.', {exact:false})).toBeVisible();
  await expect(page.locator('.sales-journal b')).toHaveCount(0);
  await page.getByRole('button', {name:'Done',exact:true}).click();
  await page.getByRole('button', {name:'Clear filters'}).click();
  await page.getByRole('button', {name:'TEST-003', exact:true}).click();
  await expect(page.locator('.sales-journal')).toContainText('<img');
  await expect(page.locator('.sales-journal img')).toHaveCount(0);
  await page.getByRole('button', {name:'Done',exact:true}).click();
  server.salesSheet.data[2][11] = 2000;
  await page.getByRole('button', {name:'Refresh',exact:true}).click();
  await expect(page.locator('.sales-kpi').filter({hasText:'Known estimate value'})).toContainText('$3,234.50');
  await page.reload();
  await expect(page.getByRole('heading', {name:'Sales dashboard',exact:true})).toBeVisible();
  const menu = page.getByRole('button', {name:'Open navigation'});
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', {name:'Workspace pages'}).getByRole('button', {name:'Messages',exact:true}).click();
  await expect(page.getByRole('textbox', {name:'Message #general'})).toHaveValue('Draft to preserve while reviewing sales');
});

test('sales dashboard explains an older deployment and can recover without showing invented totals', async ({ page }) => {
  await connectWorkspace(page, { salesRows });
  const oldBackend = async (route: import('@playwright/test').Route) => {
    if (route.request().postDataJSON().action === 'salesDashboard') await route.fulfill({json:{ok:false,code:'unknown_action',error:'Unknown action.'}});
    else await route.fallback();
  };
  await page.route('https://script.google.com/**', oldBackend);
  await signIn(page); await openSales(page);
  await expect(page.getByRole('alert')).toContainText('version 8.1');
  await expect(page.getByRole('alert')).toContainText('latest Apps Script URL');
  await expect(page.locator('.sales-connection a')).toHaveAttribute('href', 'https://script.google.com/macros/s/browser-test/exec');
  await expect(page.locator('.sales-kpi')).toHaveCount(0);
  await page.unroute('https://script.google.com/**', oldBackend);
  await page.getByRole('button', {name:'Retry',exact:true}).click();
  await expect(page.getByRole('button', {name:'TEST-001', exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.locator('.sales-connection')).toHaveCount(0);
});

test('a retired hosting URL connects login and sales to the current workspace', async ({ page }) => {
  await connectWorkspace(page, { salesRows });
  const endpoints: string[] = [];
  page.on('request', request => { if (request.url().startsWith('https://script.google.com/')) endpoints.push(request.url()); });
  await page.addInitScript(() => localStorage.setItem('hays.messages.session.v1', JSON.stringify({ token: 'old-deployment-session', backendUrl: 'https://script.google.com/macros/s/AKfycbzcbutQRzBUyaY9tzR46tl3xGKFiG1hOOjl_u60oHg8EbkWwFQP9quxrFYoaKYiP1m41g/exec', expiresAt: new Date(Date.now() + 3600000).toISOString(), user: { email: 'browser@hays.test', name: 'Test teammate', role: 'admin' } })));
  await page.goto('http://localhost:3004');
  await expect(page.getByRole('heading', { name:'Sign in to your workspace.' })).toBeVisible();
  await page.getByRole('textbox', {name:'Username',exact:true}).fill(account.email);
  await page.getByLabel('Password', {exact:true}).fill(account.password);
  await page.getByRole('form', {name:'Company sign in'}).getByRole('button', {name:'Sign in',exact:true}).click();
  await expect(page.getByRole('heading', {name:'general',exact:true})).toBeVisible();
  await openSales(page);
  await expect(page.getByRole('button', {name:'TEST-001', exact:true})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(endpoints.length).toBeGreaterThan(0);
  expect([...new Set(endpoints)]).toEqual(['https://script.google.com/macros/s/AKfycbxK5yd7Xsh_o5pfyLqKBq3MpBKjp-8ia3v9M7QNp8UFtlUiZYEkvvqVzDdLuZVhCZZLEg/exec']);
});
