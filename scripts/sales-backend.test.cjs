const { test } = require('node:test');
const assert = require('node:assert/strict');
const { backend } = require('./helpers/backend.cjs');
const { salesRows, headers } = require('./helpers/sales.cjs');

test('sales data requires an active messaging session and reads only the configured report without changing it', () => {
  const b = backend({ salesRows });
  assert.equal(b.call('salesDashboard').code, 'unauthorized');
  const user = b.user('sales-reader@hays.test');
  const before = JSON.stringify(b.salesSheet.data);
  const report = b.ok('salesDashboard', { spreadsheetId: 'attacker-selected-sheet' }, user);
  assert.equal(report.jobs.length, 4);
  assert.equal(report.jobs[0].estimate, 1234.5);
  assert.equal(report.jobs[0].receivedDate, '2026-08-01');
  assert.equal(report.jobs[0].inspectedDate, '2026-08-05');
  assert.equal(report.jobs[1].estimate, null);
  assert.equal(report.jobs[2].estimate, 0, 'an entered zero is different from a missing estimate');
  assert.equal(report.jobs[3].estimate, null);
  assert.equal(report.jobs[3].receivedDate, '');
  assert.equal(report.quality.invalidDates, 1); assert.equal(report.quality.invalidEstimates, 1);
  assert.equal(report.source.timezone, 'America/Los_Angeles');
  assert.match(report.today, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(JSON.stringify(b.salesSheet.data), before);
  b.ok('logout', {}, user);
  assert.equal(b.call('salesDashboard', {}, user).code, 'session_expired');
});

test('sales schema follows column names, including when they move, and reports source configuration failures', () => {
  const reversed = salesRows.map(row => Array.from({length: headers.length}, (_, i) => row[headers.length - 1 - i] ?? ''));
  const b = backend({ salesRows: reversed }); const user = b.user('reader@hays.test');
  assert.equal(b.ok('salesDashboard', {}, user).jobs[0].jobNumber, 'TEST-001');
  b.properties.set('SALES_SHEET_NAME', 'missing tab');
  assert.equal(b.call('salesDashboard', {}, user).code, 'sales_configuration');
  b.properties.delete('SALES_SHEET_NAME');
  b.properties.set('SALES_SPREADSHEET_ID', 'missing spreadsheet');
  assert.equal(b.call('salesDashboard', {}, user).code, 'sales_access');
  b.properties.delete('SALES_SPREADSHEET_ID');
  b.salesSheet.data = [['Unrecognized heading']];
  assert.equal(b.call('salesDashboard', {}, user).code, 'sales_headers');
  b.salesSheet.data = [headers];
  assert.equal(b.ok('salesDashboard', {}, user).jobs.length, 0);
  b.salesSheet.getLastRow = () => 25001;
  assert.equal(b.call('salesDashboard', {}, user).code, 'sales_limit');
});

test('sales parsing handles dates, sheet serials, amounts and missing values without guessing', () => {
  const b = backend();
  assert.equal(b.context.salesDate_(46281.35, 'America/Los_Angeles'), '2026-09-16');
  assert.equal(b.context.salesDate_(new Date('2026-09-17T01:00:00Z'), 'America/Los_Angeles'), '2026-09-16');
  assert.equal(b.context.salesDate_('2026-09-16', 'UTC'), '2026-09-16');
  for (const value of ['2/30/26', 'unknown', '', NaN]) assert.equal(b.context.salesDate_(value, 'UTC'), '');
  for (const value of ['', null, 'TBD', true]) assert.equal(b.context.salesAmount_(value), null);
  assert.equal(b.context.salesAmount_('($12.50)'), -12.5);
  assert.equal(b.context.salesAmount_('0'), 0);
});
