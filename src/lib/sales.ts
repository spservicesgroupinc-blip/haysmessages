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
export interface SalesFilters { search: string; estimator: string; division: string; status: string; from: string; to: string; estimates: string }
export const emptySalesFilters: SalesFilters = { search: '', estimator: '', division: '', status: '', from: '', to: '', estimates: '' };
export function ageDays(job: SalesJob, today: string): number | null {
  if (!job.receivedDate) return null;
  const days = Math.floor((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${job.receivedDate}T00:00:00Z`)) / 86400000);
  return Number.isFinite(days) ? days : null;
}
export function filterSales(jobs: SalesJob[], filters: SalesFilters) {
  const search = filters.search.trim().toLowerCase();
  return jobs.filter(job => (!search || [job.jobNumber, job.customer, job.estimator, job.insuranceCarrier, job.referredBy].some(value => value.toLowerCase().includes(search)))
    && (!filters.estimator || (job.estimator || 'Unassigned') === filters.estimator)
    && (!filters.division || (job.division || 'Unassigned') === filters.division)
    && (!filters.status || (job.status || 'Not entered') === filters.status)
    && (!filters.from || (!!job.receivedDate && job.receivedDate >= filters.from))
    && (!filters.to || (!!job.receivedDate && job.receivedDate <= filters.to))
    && (filters.estimates !== 'missing' || job.estimate === null)
    && (filters.estimates !== 'entered' || job.estimate !== null));
}
export function salesSummary(jobs: SalesJob[], today: string) {
  return {
    jobs: jobs.length,
    pending: jobs.filter(job => /^pending\b/i.test(job.status)).length,
    value: jobs.reduce((total, job) => total + (job.estimate ?? 0), 0),
    missing: jobs.filter(job => job.estimate === null).length,
    aged: jobs.filter(job => (ageDays(job, today) ?? -1) >= 30).length,
  };
}
export function estimatorTotals(jobs: SalesJob[]) {
  const groups = new Map<string, { name: string; value: number; count: number; priced: number }>();
  for (const job of jobs) {
    const name = job.estimator || 'Unassigned';
    const group = groups.get(name) || { name, value: 0, count: 0, priced: 0 };
    group.count++; group.value += job.estimate ?? 0;
    if (job.estimate !== null) group.priced++;
    groups.set(name, group);
  }
  return [...groups.values()].sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
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
