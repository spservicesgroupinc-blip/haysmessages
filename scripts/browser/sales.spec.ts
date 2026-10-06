import { test, expect, type Page } from '@playwright/test';
import { createRequire } from 'node:module';
import { connectWorkspace, signIn } from './workspace';
const require = createRequire(import.meta.url);
const { salesRows } = require('../helpers/sales.cjs');
async function openSales(page: Page) {
  const menu = page.getByRole('button', { name: 'Open navigation' });
  if (await menu.isVisible()) await menu.click();
  await page.getByRole('navigation', { name: 'Workspace pages' }).getByRole('button', { name: 'Sales dashboard' }).click();
  await expect(page.getByRole('heading', { name: 'Sales dashboard', exact: true })).toBeVisible();
}

test('sales dashboard reads the authenticated sheet, filters totals, refreshes and preserves chat drafts', async ({ page }, info) => {
  const server = await connectWorkspace(page, { salesRows });
  await signIn(page);
  await page.getByRole('textbox', { name: 'Message #general' }).fill('Draft to preserve while reviewing sales');
  await openSales(page);
  await expect(page.locator('.sales-kpi').filter({hasText:'Known estimate value'})).toContainText('$1,234.50');
  await expect(page.locator('.sales-kpi').filter({hasText:'Estimates not entered'})).toContainText('2');
  await expect(page.getByRole('button', { name: 'TEST-001' })).toBeVisible();
  await expect(page.getByRole('link', {name:'Open source sheet'})).toHaveAttribute('href', /1Ba1IEJEOb3ILhsZrOZSHCOT5-6pELnwGT-inUcVMcTk/);
  await page.screenshot({ path:`test-results/${info.project.name}-sales-dashboard.png`,fullPage:true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByLabel('Estimator', {exact:true}).selectOption('Estimator Two');
  await expect(page.locator('.sales-kpi').filter({hasText:'Known estimate value'})).toContainText('$0.00');
  await expect(page.getByRole('button', {name:'TEST-001'})).toHaveCount(0);
  await page.getByRole('button', {name:'Clear filters'}).click();
  await page.getByRole('textbox', {name:'Search sales jobs'}).fill('North customer');
  await expect(page.getByRole('button', {name:'TEST-002'})).toHaveCount(0);
  await page.getByRole('button', {name:'TEST-001'}).click();
  await expect(page.getByRole('dialog').getByText('Awaiting signature.', {exact:false})).toBeVisible();
  await expect(page.locator('.sales-journal b')).toHaveCount(0);
  await page.getByRole('button', {name:'Done',exact:true}).click();
  await page.getByRole('button', {name:'Clear filters'}).click();
  await page.getByRole('button', {name:'TEST-003'}).click();
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
  await expect(page.getByRole('alert')).toContainText('version 7');
  await expect(page.locator('.sales-kpi')).toHaveCount(0);
  await page.unroute('https://script.google.com/**', oldBackend);
  await page.getByRole('button', {name:'Retry',exact:true}).click();
  await expect(page.getByRole('button', {name:'TEST-001'})).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
