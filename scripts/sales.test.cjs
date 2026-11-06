const { test } = require('node:test');
const assert = require('node:assert/strict');
const loaded = import('../src/lib/sales.ts');
const jobs = [
  { jobNumber:'TEST-001',customer:'North',estimator:'One',division:'Structure',status:'Pending Sales',estimate:1000,receivedDate:'2026-08-01',insuranceCarrier:'Carrier',referredBy:'Source' },
  { jobNumber:'TEST-002',customer:'South',estimator:'Two',division:'Remodel',status:'Pending Sales',estimate:null,receivedDate:'2026-10-01',insuranceCarrier:'',referredBy:'' },
  { jobNumber:'TEST-003',customer:'West',estimator:'One',division:'Structure',status:'Closed',estimate:0,receivedDate:'',insuranceCarrier:'',referredBy:'' },
];

test('journal text preserves readable paragraphs and decodes exported entities without rendering markup', async () => {
  const { plainJournal } = await loaded;
  assert.equal(plainJournal('<p><strong>Spoke with customer.</strong></p><p>Awaiting signature &amp; deposit.</p>'), 'Spoke with customer.\nAwaiting signature & deposit.');
  assert.equal(plainJournal('Called<br/>Left voicemail.</br>Follow up Friday.'), 'Called\nLeft voicemail.\nFollow up Friday.');
  assert.equal(plainJournal('<div>&quot;Approved&quot; &#39;scope&#39; &#x2014; next week</div>'), '"Approved" \'scope\' — next week');
  assert.equal(plainJournal('<p> &nbsp; </p>'), '');
  assert.equal(plainJournal('<script>badCode()</script><style>body{display:none}</style><p>Customer update.</p>'), 'Customer update.');
  assert.equal(plainJournal('Email <owner@example.test> &lt;reply pending&gt;'), 'Email <owner@example.test> <reply pending>');
  assert.equal(plainJournal('Email <a@example.test> or <b@example.test>.'), 'Email <a@example.test> or <b@example.test>.');
  assert.equal(plainJournal('Unknown &#x110000; &#55296; &custom;'), 'Unknown &#x110000; &#55296; &custom;');
});

test('notes are searchable and pending-without-notes respects the existing filters', async () => {
  const { filterSales, emptySalesFilters } = await loaded;
  const rows = [
    { ...jobs[0], journalNote: '<p>Customer requested a revised scope &amp; pricing.</p>' },
    { ...jobs[1], journalNote: '<p>&nbsp;</p>' },
    { ...jobs[2], journalNote: '' },
    { ...jobs[0], jobNumber: 'NO-NOTE', journalNote: '' },
  ];
  assert.deepEqual(filterSales(rows, { ...emptySalesFilters, search: 'scope & pricing' }).map(j => j.jobNumber), ['TEST-001']);
  assert.equal(filterSales(rows, { ...emptySalesFilters, search: 'scope', estimator: 'Two' }).length, 0);
  assert.deepEqual(filterSales(rows, { ...emptySalesFilters, focus: 'no-notes' }).map(j => j.jobNumber), ['TEST-002', 'NO-NOTE']);
  assert.deepEqual(filterSales(rows, { ...emptySalesFilters, focus: 'no-notes', estimator: 'Two' }).map(j => j.jobNumber), ['TEST-002']);
});
test('sales filters and totals use report amounts, keep missing values distinct, and count age from calendar dates', async () => {
  const { ageDays, filterSales, salesSummary, emptySalesFilters, estimatorTotals, agingTotals } = await loaded;
  assert.equal(ageDays(jobs[0], '2026-10-06'), 66);
  assert.equal(ageDays(jobs[2], '2026-10-06'), null);
  assert.deepEqual(salesSummary(jobs, '2026-10-06'), {jobs:3,pending:2,value:1000,missing:1,aged:1,pendingValue:1000,unassigned:0,priced:2,average:500});
  assert.equal(filterSales(jobs,{...emptySalesFilters,estimates:'missing'}).length,1);
  assert.equal(filterSales(jobs,{...emptySalesFilters,estimates:'entered'}).length,2);
  assert.equal(filterSales(jobs,{...emptySalesFilters,search:'carrier',estimator:'One'}).length,1);
  assert.equal(filterSales(jobs,{...emptySalesFilters,from:'2026-10-01',to:'2026-10-01'}).length,1);
  assert.equal(filterSales(jobs,{...emptySalesFilters,from:'2026-10-02',to:'2026-10-01'}).length,0);
  assert.equal(estimatorTotals(jobs).find(g=>g.name==='One').priced,2);
  assert.equal(agingTotals(jobs,'2026-10-06').reduce((count,g)=>count+g.count,0),3);
});

test('follow-up views honor all filters and exclude closed, future and undated jobs from pending aging', async () => {
  const { filterSales, salesSummary, emptySalesFilters, estimatorTotals } = await loaded;
  const rows = [
    {...jobs[0],jobNumber:'BOUNDARY',receivedDate:'2026-09-06',estimate:0},
    {...jobs[0],jobNumber:'RECENT',receivedDate:'2026-09-07'},
    {...jobs[0],jobNumber:'CLOSED',status:'Closed',receivedDate:'2026-01-01'},
    {...jobs[0],jobNumber:'FUTURE',receivedDate:'2026-10-07'},
    {...jobs[0],jobNumber:'UNDATED',receivedDate:''},
    {...jobs[1],jobNumber:'UNASSIGNED',estimator:'',receivedDate:'2026-08-01'},
  ];
  const today = '2026-10-06';
  assert.deepEqual(filterSales(rows,{...emptySalesFilters,focus:'aged'},today).map(row=>row.jobNumber),['BOUNDARY','UNASSIGNED']);
  assert.equal(filterSales(rows,{...emptySalesFilters,focus:'aged',estimator:'One'},today).length,1);
  assert.equal(filterSales(rows,{...emptySalesFilters,focus:'aged',from:'2026-09-07'},today).length,0);
  assert.equal(filterSales(rows,{...emptySalesFilters,focus:'missing'},today)[0].jobNumber,'UNASSIGNED');
  assert.equal(filterSales(rows,{...emptySalesFilters,focus:'unassigned'},today)[0].jobNumber,'UNASSIGNED');
  assert.equal(salesSummary(rows,today).aged,2);
  assert.equal(estimatorTotals(rows,today).find(group=>group.name==='One').aged,1);
  assert.equal(salesSummary([{...jobs[0],estimate:null}],today).average,null);
  assert.equal(salesSummary([{...jobs[0],estimate:0}],today).average,0);
  assert.equal(salesSummary([{...jobs[0],estimate:-50}, {...jobs[1],estimate:0}],today).average,-25);
  assert.equal(salesSummary([],today).average,null);
});

test('received presets span exactly 30 calendar days and monthly trends handle year boundaries and future dates', async () => {
  const { salesDateRange, receivedTrend, filterSales, emptySalesFilters } = await loaded;
  assert.deepEqual(salesDateRange('all','2026-10-06'),{from:'',to:''});
  assert.deepEqual(salesDateRange('month','2026-10-06'),{from:'2026-10-01',to:'2026-10-06'});
  assert.deepEqual(salesDateRange('30days','2026-10-06'),{from:'2026-09-07',to:'2026-10-06'});
  assert.deepEqual(salesDateRange('30days','2024-03-01'),{from:'2024-02-01',to:'2024-03-01'});
  const rows = ['2025-08-31','2025-09-01','2025-12-31','2026-01-01','2026-02-06','2026-02-07',''].map(receivedDate=>({...jobs[0],receivedDate}));
  const trend = receivedTrend(rows,'2026-02-06');
  assert.deepEqual(trend.map(group=>group.month),['2025-09','2025-10','2025-11','2025-12','2026-01','2026-02']);
  assert.deepEqual(trend.map(group=>group.count),[1,0,0,1,1,1]);
  assert.equal(trend[5].to,'2026-02-06');
  for (const group of trend) assert.equal(filterSales(rows,{...emptySalesFilters,from:group.from,to:group.to}).length,group.count);
  assert.deepEqual(receivedTrend(rows,''),[]);
});
