const { test } = require('node:test');
const assert = require('node:assert/strict');
const loaded = import('../src/lib/sales.ts');
const jobs = [
  { jobNumber:'TEST-001',customer:'North',estimator:'One',division:'Structure',status:'Pending Sales',estimate:1000,receivedDate:'2026-08-01',insuranceCarrier:'Carrier',referredBy:'Source' },
  { jobNumber:'TEST-002',customer:'South',estimator:'Two',division:'Remodel',status:'Pending Sales',estimate:null,receivedDate:'2026-10-01',insuranceCarrier:'',referredBy:'' },
  { jobNumber:'TEST-003',customer:'West',estimator:'One',division:'Structure',status:'Closed',estimate:0,receivedDate:'',insuranceCarrier:'',referredBy:'' },
];
test('sales filters and totals use report amounts, keep missing values distinct, and count age from calendar dates', async () => {
  const { ageDays, filterSales, salesSummary, emptySalesFilters, estimatorTotals, agingTotals } = await loaded;
  assert.equal(ageDays(jobs[0], '2026-10-06'), 66);
  assert.equal(ageDays(jobs[2], '2026-10-06'), null);
  assert.deepEqual(salesSummary(jobs, '2026-10-06'), {jobs:3,pending:2,value:1000,missing:1,aged:1});
  assert.equal(filterSales(jobs,{...emptySalesFilters,estimates:'missing'}).length,1);
  assert.equal(filterSales(jobs,{...emptySalesFilters,estimates:'entered'}).length,2);
  assert.equal(filterSales(jobs,{...emptySalesFilters,search:'carrier',estimator:'One'}).length,1);
  assert.equal(filterSales(jobs,{...emptySalesFilters,from:'2026-10-01',to:'2026-10-01'}).length,1);
  assert.equal(filterSales(jobs,{...emptySalesFilters,from:'2026-10-02',to:'2026-10-01'}).length,0);
  assert.equal(estimatorTotals(jobs).find(g=>g.name==='One').priced,2);
  assert.equal(agingTotals(jobs,'2026-10-06').reduce((count,g)=>count+g.count,0),3);
});
