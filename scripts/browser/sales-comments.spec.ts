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

test('job board posts team updates into the list, receives another author, reloads and removes own comments', async ({ page }, info) => {
  const rows = salesRows.map((row: unknown[]) => [...row]); rows[3][14] = 'Customer approved the schedule.';
  const server = await connectWorkspace(page, { salesRows: rows }); await signIn(page); await openSales(page);
  const sourceBefore = JSON.stringify(server.salesSheet.data);
  await page.getByRole('button', { name: 'Team comments for TEST-001', exact: true }).click();
  const board = page.getByRole('region', { name: 'Team comments for TEST-001', exact: true });
  await expect(board).toContainText('No team comments yet');
  await board.getByLabel('Add a team update').fill('Customer confirmed Tuesday inspection. Follow up with revised scope.');
  await board.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(board.locator('article')).toHaveCount(1);
  await expect(board.locator('article')).toContainText('Test teammate');
  await expect(board.getByLabel('Add a team update')).toHaveValue('');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  const row = page.getByRole('row').filter({ has: page.getByRole('button', { name: 'TEST-001', exact: true }) });
  await expect(row).toContainText('Customer confirmed Tuesday inspection.');
  await expect(row).toContainText('1 comment · View board');
  await expect(row).toContainText('Awaiting signature.');
  const other = server.ok('login', { email: 'one@hays.test', password: account.password });
  server.ok('addSalesComment', { jobNumber: 'TEST-001', body: 'Carrier approved the updated allowance.', clientId: 'other-comment' }, other);
  await expect(row).toContainText('Carrier approved the updated allowance.', { timeout: 15000 });
  await expect(row).toContainText('Teammate One');
  await expect(row).toContainText('2 comments · View board');
  await page.locator('.sales-body').evaluate(element => { element.scrollTop += element.querySelector('.sales-jobs')!.getBoundingClientRect().top - element.getBoundingClientRect().top; });
  await page.screenshot({ path: `test-results/${info.project.name}-sales-comment-list.png`, fullPage: true });
  await page.getByRole('button', { name: 'Team comments for TEST-001', exact: true }).click();
  await expect(board.locator('article')).toHaveCount(2);
  await expect(board.locator('article').first()).toContainText('Carrier approved');
  await board.getByLabel('Add a team update').fill('Draft survives closing this job');
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.getByRole('button', { name: 'Team comments for TEST-001', exact: true }).click();
  await expect(board.getByLabel('Add a team update')).toHaveValue('Draft survives closing this job');
  await page.screenshot({ path: `test-results/${info.project.name}-sales-comment-board.png`, fullPage: true });
  await board.getByRole('button', { name: 'Remove comment by Test teammate', exact: true }).click();
  await board.getByRole('button', { name: 'Remove comment', exact: true }).click();
  await expect(board.locator('article')).toHaveCount(1);
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('table', { name: 'Sales opportunities' })).toContainText('Carrier approved');
  await page.getByRole('button', { name: 'Team comments for TEST-002', exact: true }).click();
  await expect(page.getByRole('region', { name: 'Team comments for TEST-002', exact: true })).toContainText('No team comments yet');
  expect(JSON.stringify(server.salesSheet.data)).toBe(sourceBefore);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('lost responses keep the draft and retry with one saved comment; text is not interpreted as HTML', async ({ page }) => {
  const server = await connectWorkspace(page, { salesRows }); await signIn(page); await openSales(page);
  let attempts = 0; const ids: string[] = [];
  await page.route('https://script.google.com/**', async route => {
    const body = route.request().postDataJSON();
    if (body.action !== 'addSalesComment') { await route.fallback(); return; }
    ids.push(body.clientId);
    if (!attempts++) { server.ok(body.action, body, { token: body.sessionToken }); await route.abort('failed'); }
    else await route.fallback();
  });
  await page.getByRole('button', { name: 'Team comments for TEST-001', exact: true }).click();
  const board = page.getByRole('region', { name: 'Team comments for TEST-001', exact: true });
  const text = '=note <img src=x onerror="alert(1)">';
  await board.getByLabel('Add a team update').fill(text);
  await board.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(board.getByRole('alert')).toContainText('saved here for retry');
  await expect(board.getByLabel('Add a team update')).toHaveValue(text);
  await board.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(board.locator('article')).toHaveCount(1);
  await expect(board.locator('article p')).toHaveText(text);
  await expect(board.locator('article img')).toHaveCount(0);
  expect(ids).toHaveLength(2); expect(ids[1]).toBe(ids[0]);
  expect(server.sheets.get('SalesComments').data.length).toBe(2);
});

test('an old backend keeps source notes available and explains the comments update', async ({ page }) => {
  await connectWorkspace(page, { salesRows });
  await page.route('https://script.google.com/**', async route => {
    if (['salesCommentSummaries', 'listSalesComments', 'addSalesComment'].includes(route.request().postDataJSON().action)) await route.fulfill({ json: { ok: false, code: 'unknown_action', error: 'Unknown action requested.' } });
    else await route.fallback();
  });
  await signIn(page); await openSales(page);
  await expect(page.getByRole('table', { name: 'Sales opportunities' })).toContainText('Awaiting signature.');
  await expect(page.getByText(/Team comments need the updated Apps Script/)).toBeVisible();
  await page.getByRole('button', { name: 'Team comments for TEST-001', exact: true }).click();
  await page.getByLabel('Add a team update').fill('Retain this customer follow-up');
  await page.getByRole('button', { name: 'Post comment', exact: true }).click();
  await expect(page.getByLabel('Add a team update')).toHaveValue('Retain this customer follow-up');
  await expect(page.getByRole('region', { name: 'Team comments for TEST-001', exact: true }).getByRole('alert').last()).toContainText('version 8.5');
});


test('earlier comment history loads without duplicates and refresh returns to current updates', async ({ page }) => {
  const server = await connectWorkspace(page, { salesRows });
  const author = server.ok('login', { email: account.email, password: account.password });
  for (let i = 0; i < 55; i++) server.ok('addSalesComment', { jobNumber: 'TEST-001', body: `Follow-up ${i}`, clientId: `history-${i}` }, author);
  await signIn(page); await openSales(page);
  await page.getByRole('button', { name: 'Team comments for TEST-001', exact: true }).click();
  const board = page.getByRole('region', { name: 'Team comments for TEST-001', exact: true });
  await expect(board.locator('article')).toHaveCount(50);
  await board.getByRole('button', { name: 'Load earlier comments', exact: true }).click();
  await expect(board.locator('article')).toHaveCount(55);
  await expect(board.getByText('Follow-up 0', { exact: true })).toHaveCount(1);
  server.ok('addSalesComment', { jobNumber: 'TEST-001', body: 'Latest customer callback', clientId: 'latest-callback' }, author);
  await board.getByRole('button', { name: 'Refresh team comments', exact: true }).click();
  await expect(board.locator('article')).toHaveCount(50);
  await expect(board.locator('article').first()).toContainText('Latest customer callback');
});
