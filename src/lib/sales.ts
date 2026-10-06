export interface SalesJob {
  id: string; sourceRow: number; jobNumber: string; customer: string; estimator: string;
  insuranceCarrier: string; primaryAdjuster: string; referredBy: string; foreman: string;
  receivedDate: string; division: string; inspectedDate: string; marketingPerson: string;
  estimate: number | null; status: string; closingReason: string; journalNote: string;
}
export interface SalesReport {
  source: { spreadsheetId: string; title: string; sheetName: string; sheetId: number; url: string; timezone: string };
  fetchedAt: string; today: string; jobs: SalesJob[];
  quality: { invalidDates: number; invalidEstimates: number; skippedRows: number };
}
export type SalesFocus = '' | 'missing' | 'aged' | 'unassigned';
export type SalesPeriod = 'all' | 'month' | '30days';
export interface SalesFilters { search: string; estimator: string; division: string; status: string; from: string; to: string; estimates: string; focus: SalesFocus }
export const emptySalesFilters: SalesFilters = { search: '', estimator: '', division: '', status: '', from: '', to: '', estimates: '', focus: '' };
export const isPending = (job: SalesJob) => /^pending\b/i.test(job.status.trim());
export function ageDays(job: SalesJob, today: string): number | null {
  if (!job.receivedDate) return null;
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${job.receivedDate}T00:00:00Z`)) / 86400000);
  return Number.isFinite(days) ? days : null;
}
export function filterSales(jobs: SalesJob[], filters: SalesFilters, today = '') {
  const search = filters.search.trim().toLowerCase();
  return jobs.filter(job => (!search || [job.jobNumber, job.customer, job.estimator, job.insuranceCarrier, job.referredBy].some(value => value.toLowerCase().includes(search)))
    && (!filters.estimator || (job.estimator || 'Unassigned') === filters.estimator)
    && (!filters.division || (job.division || 'Unassigned') === filters.division)
    && (!filters.status || (job.status || 'Not entered') === filters.status)
    && (!filters.from || (!!job.receivedDate && job.receivedDate >= filters.from))
    && (!filters.to || (!!job.receivedDate && job.receivedDate <= filters.to))
    && (filters.estimates !== 'missing' || job.estimate === null)
    && (filters.estimates !== 'entered' || job.estimate !== null)
    && (filters.focus !== 'missing' || job.estimate === null)
    && (filters.focus !== 'aged' || (isPending(job) && (ageDays(job, today) ?? -1) >= 30))
    && (filters.focus !== 'unassigned' || !job.estimator.trim()));
}
export function salesSummary(jobs: SalesJob[], today: string) {
  let pending = 0, value = 0, missing = 0, aged = 0, pendingValue = 0, unassigned = 0;
  for (const job of jobs) {
    const pendingJob = isPending(job);
    if (pendingJob) { pending++; pendingValue += job.estimate ?? 0; }
    value += job.estimate ?? 0;
    if (job.estimate === null) missing++;
    if (pendingJob && (ageDays(job, today) ?? -1) >= 30) aged++;
    if (!job.estimator.trim()) unassigned++;
  }
  const priced = jobs.length - missing;
  return { jobs: jobs.length, pending, value, missing, aged, pendingValue, unassigned, priced, average: priced ? value / priced : null };
}
export function estimatorTotals(jobs: SalesJob[], today = '') {
  const groups = new Map<string, { name: string; value: number; count: number; priced: number; aged: number }>();
  for (const job of jobs) {
    const name = job.estimator || 'Unassigned';
    const group = groups.get(name) || { name, value: 0, count: 0, priced: 0, aged: 0 };
    group.count++; group.value += job.estimate ?? 0;
    if (job.estimate !== null) group.priced++;
    if (isPending(job) && (ageDays(job, today) ?? -1) >= 30) group.aged++;
    groups.set(name, group);
  }
  return [...groups.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}
export function salesDateRange(period: SalesPeriod, today: string) {
  if (period === 'all' || !/^\d{4}-\d{2}-\d{2}$/.test(today)) return { from: '', to: '' };
  if (period === 'month') return { from: `${today.slice(0, 7)}-01`, to: today };
  const start = new Date(`${today}T00:00:00Z`);
  if (!Number.isFinite(start.getTime())) return { from: '', to: '' };
  start.setUTCDate(start.getUTCDate() - 29);
  return { from: start.toISOString().slice(0, 10), to: today };
}
// A snapshot can show when its jobs arrived, but cannot reconstruct past pipeline or revenue.
export function receivedTrend(jobs: SalesJob[], today: string) {
  const anchor = new Date(`${today}T00:00:00Z`);
  if (!Number.isFinite(anchor.getTime())) return [];
  const groups = Array.from({ length: 6 }, (_, index) => {
    const start = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() - 5 + index, 1));
    const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
    return { month: start.toISOString().slice(0, 7), label: start.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }), from: start.toISOString().slice(0, 10), to: index === 5 ? today : end, count: 0 };
  });
  const byMonth = new Map(groups.map(group => [group.month, group]));
  for (const job of jobs) {
    if (!job.receivedDate || job.receivedDate > today) continue;
    const group = byMonth.get(job.receivedDate.slice(0, 7));
    if (group) group.count++;
  }
  return groups;
}
export function agingTotals(jobs: SalesJob[], today: string) {
  const groups = ['0–7 days', '8–30 days', '31–60 days', '61+ days', 'Date missing', 'Future date'].map(name => ({ name, count: 0 }));
  for (const job of jobs) {
    const age = ageDays(job, today);
    groups[age === null ? 4 : age < 0 ? 5 : age <= 7 ? 0 : age <= 30 ? 1 : age <= 60 ? 2 : 3].count++;
  }
  return groups.filter((group, index) => index < 4 || group.count > 0);
}
// Journal notes are source text, including exported email markup. Never render them as HTML.
export function plainJournal(value: string) {
  return value.replace(/<\/?br\s*\/?\s*>/gi, '\n').replace(/<\/?(?:b|strong|div|p|span)[^>]*>/gi, '').replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>');
}
