import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BarChart3, CalendarDays, CircleDollarSign, ClipboardList, Clock3, ExternalLink, Filter, Loader2, Menu, RefreshCw, Search } from 'lucide-react';
import { Modal } from './Modal';
import { ApiError, backendUrl } from '../lib/api';
import type { ApiCall } from '../lib/useMessages';
import { ageDays, agingTotals, emptySalesFilters, estimatorTotals, filterSales, plainJournal, salesSummary, type SalesFilters, type SalesJob, type SalesReport } from '../lib/sales';
import './sales.css';

const money = (value: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(value);
const date = (value: string) => value ? new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`)) : 'Not entered';
const sourceUrl = (report: SalesReport) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(report.source.spreadsheetId)}/edit#gid=${report.source.sheetId}`;
const options = (jobs: SalesJob[], field: 'estimator' | 'division' | 'status') => [...new Set(jobs.map(job => job[field] || (field === 'status' ? 'Not entered' : 'Unassigned')))].sort();

export default function SalesDashboard({ api, onMenu }: { api: ApiCall; onMenu: () => void }) {
  const [report, setReport] = useState<SalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unsupported, setUnsupported] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [filters, setFilters] = useState<SalesFilters>(emptySalesFilters);
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(0);
  const [detail, setDetail] = useState<SalesJob | null>(null);
  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    setLoading(true); setError(''); setUnsupported(false);
    void api<SalesReport>('salesDashboard', {}, controller.signal).then(next => {
      if (!stopped) { setReport(next); setPage(0); }
    }).catch(e => {
      if (stopped) return;
      setUnsupported(e instanceof ApiError && e.code === 'unknown_action');
      setError(e instanceof ApiError && e.code === 'unknown_action'
        ? 'The connected workspace rejected the sales report request. If you already published Code.gs version 7, update the hosted app to your latest Apps Script URL and reload it. Otherwise, publish the complete updated Code.gs and retry.'
        : !navigator.onLine ? 'Connect to the internet and refresh to load the latest sales report.'
        : e instanceof Error ? e.message : 'The sales report could not be loaded. Try refreshing.');
    }).finally(() => { if (!stopped) setLoading(false); });
    return () => { stopped = true; controller.abort(); };
  }, [api, refresh]);
  function change<K extends keyof SalesFilters>(key: K, value: SalesFilters[K]) { setFilters(previous => ({ ...previous, [key]: value })); setPage(0); }
  const jobs = useMemo(() => {
    const filtered = filterSales(report?.jobs || [], filters);
    return filtered.sort((a, b) => sort === 'estimate' ? (b.estimate ?? -Infinity) - (a.estimate ?? -Infinity) || a.jobNumber.localeCompare(b.jobNumber)
      : sort === 'oldest' ? (a.receivedDate || '9999').localeCompare(b.receivedDate || '9999') || a.jobNumber.localeCompare(b.jobNumber)
      : b.receivedDate.localeCompare(a.receivedDate) || a.jobNumber.localeCompare(b.jobNumber));
  }, [report, filters, sort]);
  const totals = salesSummary(jobs, report?.today || '');
  const estimators = estimatorTotals(jobs);
  const aging = agingTotals(jobs, report?.today || '');
  const maxValue = Math.max(...estimators.map(group => group.value), 1);
  const maxCount = Math.max(...aging.map(group => group.count), 1);
  const invalidRange = !!filters.from && !!filters.to && filters.from > filters.to;
  const filtered = Object.values(filters).some(Boolean);
  const visible = jobs.slice(page * 25, (page + 1) * 25);
  return <section className="sales-page" aria-label="Sales dashboard">
    <header className="sales-header">
      <button className="icon-button mobile-only" aria-label="Open navigation" onClick={onMenu}><Menu size={21} /></button>
      <div><span className="sales-eyebrow">HAYS + SONS / SALES</span><h1>Sales dashboard</h1><p>Estimates, open opportunities, and the next jobs to move forward.</p></div>
      <button className="button compact" disabled={loading} onClick={() => setRefresh(n => n + 1)}>{loading ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Refresh</button>
    </header>
    <div className="sales-body">
      {error && <div className="error sales-load-error" role="alert">{error} <button className="text-button" disabled={loading} onClick={() => setRefresh(n => n + 1)}>Retry</button></div>}
      {unsupported && <div className="notice sales-connection"><strong>Connected workspace</strong><a href={backendUrl} target="_blank" rel="noreferrer">{backendUrl}<ExternalLink size={13} /></a><p>This must be your latest deployment address. A version label alone does not verify that the sales request is implemented.</p></div>}
      {report && <div className="sales-source"><span><span className={`sales-source-dot ${error ? 'stale' : ''}`} />{error ? 'Showing last loaded report' : 'Connected to Google Sheets'}<span className="sales-updated"> · Loaded {new Date(report.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span></span><a href={sourceUrl(report)} target="_blank" rel="noreferrer">Open source sheet <ExternalLink size={13} /></a></div>}
      {loading && !report ? <div className="sales-empty" role="status"><Loader2 size={28} className="spin" /><h2>Loading your sales report</h2><p>Reading the latest jobs from your connected sheet.</p></div> : !report ? <div className="sales-empty"><BarChart3 size={36} /><h2>Connect your sales report</h2><p>The dashboard uses your existing sign-in and the supplied sales spreadsheet.</p><a className="button" href="https://docs.google.com/spreadsheets/d/1Ba1IEJEOb3ILhsZrOZSHCOT5-6pELnwGT-inUcVMcTk/edit" target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open sales sheet</a></div> : <>
        <div className="sales-filters" aria-label="Sales filters">
          <label className="sales-search"><Search size={17} /><input aria-label="Search sales jobs" placeholder="Search job, customer, or carrier" value={filters.search} onChange={e => change('search', e.target.value)} /></label>
          <label>Estimator<select aria-label="Estimator" value={filters.estimator} onChange={e => change('estimator', e.target.value)}><option value="">All estimators</option>{options(report.jobs, 'estimator').map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Division<select aria-label="Division" value={filters.division} onChange={e => change('division', e.target.value)}><option value="">All divisions</option>{options(report.jobs, 'division').map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Job status<select aria-label="Job status" value={filters.status} onChange={e => change('status', e.target.value)}><option value="">All statuses</option>{options(report.jobs, 'status').map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Estimate<select aria-label="Estimate" value={filters.estimates} onChange={e => change('estimates', e.target.value)}><option value="">All estimates</option><option value="entered">Amount entered</option><option value="missing">Not entered</option></select></label>
          <label>Received from<input type="date" value={filters.from} onChange={e => change('from', e.target.value)} /></label>
          <label>Received through<input type="date" value={filters.to} onChange={e => change('to', e.target.value)} /></label>
          {filtered && <button className="text-button" onClick={() => { setFilters(emptySalesFilters); setPage(0); }}><Filter size={14} /> Clear filters</button>}
        </div>
        {invalidRange && <p className="error" role="alert">The received-through date must be on or after the received-from date.</p>}
        <div className="sales-kpis">
          <div className="sales-kpi"><span><ClipboardList size={17} /> Pending sales jobs</span><strong>{totals.pending}</strong><small>{totals.jobs} jobs in this view</small></div>
          <div className="sales-kpi emphasis"><span><CircleDollarSign size={17} /> Known estimate value</span><strong>{money(totals.value)}</strong><small>Entered estimates · not booked revenue</small></div>
          <div className="sales-kpi"><span><ArrowUpRight size={17} /> Estimates not entered</span><strong>{totals.missing}</strong><small>Missing amounts excluded from value</small></div>
          <div className="sales-kpi"><span><Clock3 size={17} /> Received 30+ days ago</span><strong>{totals.aged}</strong><small>Age since received · no due date assumed</small></div>
        </div>
        {(report.quality.invalidDates > 0 || report.quality.invalidEstimates > 0 || report.quality.skippedRows > 0) && <p className="notice sales-quality">Source report: {report.quality.invalidDates} dates could not be read; {report.quality.invalidEstimates} amounts could not be read; {report.quality.skippedRows} rows without a job number were skipped. Unreadable values are shown as not entered.</p>}
        <div className="sales-charts">
          <section className="sales-card"><div className="sales-card-heading"><div><h2>Estimates by estimator</h2><p>Known value in the current view</p></div><CircleDollarSign size={18} /></div>
            {estimators.length ? <ul className="sales-bars">{estimators.map(group => <li key={group.name}><div><strong>{group.name}</strong><span>{money(group.value)}</span></div><div className="sales-track"><span style={{ width: `${Math.max(0, group.value) / maxValue * 100}%` }} /></div><small>{group.count} jobs · {group.priced} with amounts</small></li>)}</ul> : <p className="sales-chart-empty">No jobs match your filters.</p>}
          </section>
          <section className="sales-card"><div className="sales-card-heading"><div><h2>Age of opportunities</h2><p>Days since the job was received</p></div><CalendarDays size={18} /></div><ul className="sales-aging">{aging.map(group => <li key={group.name}><span>{group.name}</span><div className="sales-track"><span style={{ width: `${group.count / maxCount * 100}%` }} /></div><strong>{group.count}</strong></li>)}</ul></section>
        </div>
        <section className="sales-card sales-jobs"><div className="sales-card-heading"><div><h2>Sales opportunities <span>{jobs.length}</span></h2><p>Select a job to see its latest note and handoff details.</p></div><label className="sales-sort">Sort by<select aria-label="Sort sales jobs" value={sort} onChange={e => { setSort(e.target.value); setPage(0); }}><option value="newest">Newest received</option><option value="oldest">Oldest received</option><option value="estimate">Largest estimate</option></select></label></div>
          <div className="sales-table-scroll" role="region" aria-label="Sales opportunities table" tabIndex={0}><table className="sales-table"><thead><tr><th scope="col">Job / Customer</th><th scope="col">Estimator</th><th scope="col">Division</th><th scope="col">Status</th><th scope="col" className="sales-number">Estimate</th><th scope="col">Received / Age</th></tr></thead><tbody>{visible.map(job => {
            const age = ageDays(job, report.today);
            return <tr key={job.id}><td><button className="sales-job-link" onClick={() => setDetail(job)}>{job.jobNumber}<ArrowUpRight size={13} /></button><span className="sales-customer">{job.customer || 'Customer not entered'}</span></td><td>{job.estimator || 'Unassigned'}</td><td>{job.division || 'Unassigned'}</td><td><span className="sales-status">{job.status || 'Not entered'}</span></td><td className={`sales-number ${job.estimate === null ? 'sales-missing' : ''}`}>{job.estimate === null ? 'Not entered' : money(job.estimate)}</td><td>{date(job.receivedDate)}<small className={age !== null && age >= 30 ? 'sales-old' : ''}>{age === null ? 'Age unavailable' : age < 0 ? 'Future date' : `${age} ${age === 1 ? 'day' : 'days'} ago`}</small></td></tr>;
          })}</tbody></table></div>
          {!jobs.length && <div className="sales-table-empty">{report.jobs.length ? 'No jobs match these filters.' : 'The source report has no jobs yet.'}</div>}
          <div className="sales-table-footer"><span>{jobs.length ? `${page * 25 + 1}–${Math.min((page + 1) * 25, jobs.length)} of ${jobs.length} jobs` : '0 jobs'}{filtered ? ' · Filtered view' : ''}</span><div><button className="button compact" disabled={page === 0} onClick={() => setPage(n => n - 1)}>Previous</button><button className="button compact" disabled={(page + 1) * 25 >= jobs.length} onClick={() => setPage(n => n + 1)}>Next</button></div></div>
        </section>
        <p className="sales-footnote">Source: {report.source.sheetName}. Values reflect this report snapshot. Refresh after changes in Google Sheets.</p>
      </>}
    </div>
    {detail && report && <Modal title={detail.jobNumber} onClose={() => setDetail(null)}>
      <p className="sales-detail-customer">{detail.customer || 'Customer not entered'}</p><span className="sales-status">{detail.status || 'Not entered'}</span>
      <dl className="sales-details">{[
        ['Estimate', detail.estimate === null ? 'Not entered' : money(detail.estimate)], ['Estimator', detail.estimator], ['Division', detail.division], ['Received', date(detail.receivedDate)], ['Inspected', date(detail.inspectedDate)], ['Insurance carrier', detail.insuranceCarrier], ['Primary adjuster', detail.primaryAdjuster], ['Referred by', detail.referredBy], ['Foreman', detail.foreman], ['Marketing person', detail.marketingPerson], ['Reason for closing', detail.closingReason],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not entered'}</dd></div>)}</dl>
      <h3 className="members-heading">Latest journal note</h3><p className="sales-journal">{plainJournal(detail.journalNote) || 'No journal note entered.'}</p>
      <div className="modal-actions"><a className="button" href={`${sourceUrl(report)}&range=A${detail.sourceRow}:O${detail.sourceRow}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open in Google Sheets</a><button className="button primary" onClick={() => setDetail(null)}>Done</button></div>
    </Modal>}
  </section>;
}
