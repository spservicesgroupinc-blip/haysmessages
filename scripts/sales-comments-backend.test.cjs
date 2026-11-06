const { test } = require('node:test');
const assert = require('node:assert/strict');
const { backend } = require('./helpers/backend.cjs');
const { salesRows } = require('./helpers/sales.cjs');
const post = (body = 'Customer confirmed inspection.', clientId = 'comment-1', jobNumber = 'TEST-001') => ({ jobNumber, body, clientId });

test('sales comments require a session, validate jobs, derive authors and never edit the source report', () => {
  const b = backend({ salesRows }), user = b.user('writer@hays.test');
  const before = JSON.stringify(b.salesSheet.data);
  for (const action of ['salesCommentSummaries', 'listSalesComments', 'addSalesComment', 'deleteSalesComment']) assert.equal(b.call(action, post()).code, 'unauthorized');
  for (const payload of [post(''), post('x'.repeat(2001)), post('ok', ''), post('ok', 'wrong-job', 'missing')]) assert.equal(b.call('addSalesComment', payload, user).ok, false);
  assert.equal(b.call('addSalesComment', { ...post(), sourceKey: 'stale-source' }, user).code, 'sales_source_changed');
  const comment = b.ok('addSalesComment', { ...post(), authorEmail: 'fake@hays.test', authorName: 'Fake', spreadsheetId: 'fake' }, user);
  assert.equal(comment.authorEmail, user.user.email); assert.equal(comment.authorName, user.user.name);
  assert.equal(comment.jobNumber, 'TEST-001'); assert.ok(comment.id); assert.ok(Date.parse(comment.createdAt));
  const other = b.user('reader@hays.test');
  const result = b.ok('listSalesComments', { jobNumber: 'TEST-001' }, other);
  assert.equal(result.comments[0].id, comment.id);
  const summaries = b.ok('salesCommentSummaries', { jobNumbers: ['TEST-001', 'TEST-002'] }, other).summaries;
  assert.equal(summaries['TEST-001'].count, 1); assert.equal(summaries['TEST-001'].latest.id, comment.id); assert.equal(summaries['TEST-002'].count, 0);
  assert.equal(JSON.stringify(b.salesSheet.data), before);
  assert.equal(b.sheets.get('SalesComments').data.length, 2);
  b.ok('logout', {}, user); assert.equal(b.call('addSalesComment', post(), user).code, 'session_expired');
});

test('comment retries are idempotent and scoped to author, job and configured report, including after row reorder', () => {
  const b = backend({ salesRows }), user = b.user('writer@hays.test'), other = b.user('reader@hays.test');
  const first = b.ok('addSalesComment', post(), user);
  assert.equal(b.ok('addSalesComment', post(), user).id, first.id);
  assert.equal(b.call('addSalesComment', post('Changed bytes'), user).code, 'duplicate');
  assert.equal(b.call('addSalesComment', post('Other job', 'comment-1', 'TEST-002'), user).code, 'duplicate');
  assert.notEqual(b.ok('addSalesComment', post(), other).id, first.id);
  [b.salesSheet.data[1], b.salesSheet.data[2]] = [b.salesSheet.data[2], b.salesSheet.data[1]];
  assert.equal(b.ok('listSalesComments', { jobNumber: 'TEST-001' }, other).comments.length, 2);
  const originalSheetId = b.salesSheet.getSheetId; b.salesSheet.getSheetId = () => 12345;
  assert.equal(b.ok('listSalesComments', { jobNumber: 'TEST-001' }, user).comments.length, 0);
  b.salesSheet.getSheetId = originalSheetId;
  b.properties.set('SALES_SHEET_NAME', 'changed source');
  assert.equal(b.call('listSalesComments', { jobNumber: 'TEST-001' }, user).ok, false);
});

test('history pages remain stable for tied timestamps; only authors or admins can remove comments', () => {
  const b = backend({ salesRows }), author = b.user('writer@hays.test'), other = b.user('reader@hays.test'), admin = b.user('admin@hays.test', 'admin');
  for (let i=0; i<55; i++) b.ok('addSalesComment', post(`Comment ${i}`, `id-${i}`), author);
  const rows = b.sheets.get('SalesComments').data;
  for (const row of rows.slice(1)) row[7] = '2026-11-06T10:00:00.000Z';
  const page = b.ok('listSalesComments', { jobNumber: 'TEST-001' }, other);
  assert.equal(page.comments.length, 50); assert.equal(page.hasMore, true);
  const older = b.ok('listSalesComments', { jobNumber: 'TEST-001', beforeId: page.nextBeforeId }, other);
  assert.equal(older.comments.length, 5); assert.equal(older.hasMore, false);
  assert.equal(new Set([...page.comments, ...older.comments].map(c=>c.id)).size, 55);
  assert.equal(b.call('listSalesComments', { jobNumber: 'TEST-002', beforeId: page.nextBeforeId }, other).ok, false);
  const target = page.comments.at(-1);
  assert.equal(b.call('deleteSalesComment', { commentId: target.id }, other).code, 'forbidden');
  b.ok('deleteSalesComment', { commentId: target.id }, admin);
  b.ok('deleteSalesComment', { commentId: target.id }, admin);
  assert.equal(b.ok('listSalesComments', { jobNumber: 'TEST-001' }, author).comments.length, 50);
  assert.equal(b.ok('salesCommentSummaries', { jobNumbers: ['TEST-001'] }, author).summaries['TEST-001'].count, 54);
  b.ok('deleteSalesComment', { commentId: page.comments[0].id }, author);
  assert.equal(b.call('salesCommentSummaries', { jobNumbers: Array(26).fill('TEST-001') }, author).ok, false);
});

test('comment fields are stored as inert JSON, including formula-like names, IDs and job numbers', () => {
  const b = backend({ salesRows }), user = b.user('writer@hays.test');
  user.user.name = '=SUM(1,1)';
  b.salesSheet.data[1][0] = '=formula-job';
  const body = '=IMPORTXML("https://invalid.example", "x")';
  const comment = b.ok('addSalesComment', post(body, '=client', '=formula-job'), user);
  assert.equal(comment.body, body);
  const row = b.sheets.get('SalesComments').data[1];
  for (const index of [2,3,4,5,6]) assert.ok(!/^[=+\-@]/.test(row[index]));
  assert.equal(b.ok('addSalesComment', post(body, '=client', '=formula-job'), user).id, comment.id);
  assert.equal(b.ok('salesCommentSummaries', {jobNumbers: ['=formula-job']}, user).summaries['=formula-job'].latest.body, body);
});
