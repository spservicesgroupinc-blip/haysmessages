import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, BarChart3, CalendarDays, ChevronDown, CircleDollarSign, ClipboardList, Clock3, ExternalLink, Filter, Loader2, Menu, RefreshCw, Search, Users } from 'lucide-react';
import { Modal } from './Modal';
import { ApiError, backendUrl } from '../lib/api';
import type { ApiCall } from '../lib/useMessages';
import { ageDays, emptySalesFilters, estimatorTotals, filterSales, plainJournal, receivedTrend, salesDateRange, salesSummary, type SalesFilters, type SalesFocus, type SalesJob, type SalesPeriod, type SalesReport } from '../lib/sales';
import './sales.css';

const currencyFormat = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const money = (value: number) => currencyFormat.format(value);
const date = (value: string) => value ? dateFormat.format(new Date(`${value}T00:00:00Z`)) : 'Not entered';
const sourceUrl = (report: SalesReport) => `https://docs.google.com/spreadsheets/d/${encodeURIComponent(report.source.spreadsheetId)}/edit#gid=${report.source.sheetId}`;
const options = (jobs: SalesJob[], field: 'estimator' | 'division' | 'status') => [...new Set(jobs.map(job => job[field] || (field === 'status' ? 'Not entered' : 'Unassigned')))].sort();
const pageSize = 25;

export default function SalesDashboard({ api, onMenu }: { api: ApiCall; onMenu: () => void }) {
  const [report, setReport] = useState<SalesReport | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [unsupported, setUnsupported] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const [filters, setFilters] = useState<SalesFilters>(emptySalesFilters);
  const [advanced, setAdvanced] = useState(false);
  const [sort, setSort] = useState('newest');
  const [page, setPage] = useState(0);
  const [detailId, setDetailId] = useState<string | null>(null);

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

  function change<K extends keyof SalesFilters>(key: K, value: SalesFilters[K]) {
    setFilters(previous => ({ ...previous, [key]: value })); setPage(0);
  }
  function setRange(from: string, to: string) {
    setFilters(previous => ({ ...previous, from, to })); setPage(0);
  }
  function clearFilters() { setFilters(emptySalesFilters); setPage(0); }

  const today = report?.today || '';
  const jobs = useMemo(() => {
    const filtered = filterSales(report?.jobs || [], filters, today);
    return filtered.sort((a, b) => sort === 'estimate' ? (b.estimate ?? -Infinity) - (a.estimate ?? -Infinity) || a.jobNumber.localeCompare(b.jobNumber)
      : sort === 'oldest' ? (a.receivedDate || '9999').localeCompare(b.receivedDate || '9999') || a.jobNumber.localeCompare(b.jobNumber)
      : b.receivedDate.localeCompare(a.receivedDate) || a.jobNumber.localeCompare(b.jobNumber));
  }, [report, filters, sort, today]);
  const insights = useMemo(() => ({
    totals: salesSummary(jobs, today),
    estimators: estimatorTotals(jobs, today),
    trend: receivedTrend(jobs, today),
  }), [jobs, today]);
  // Quick-view counts retain the other filters, so switching focus remains predictable.
  const scopeTotals = useMemo(() => salesSummary(filterSales(report?.jobs || [], { ...filters, focus: '' }, today), today), [report, filters, today]);
  const filterOptions = useMemo(() => ({
    estimator: options(report?.jobs || [], 'estimator'),
    division: options(report?.jobs || [], 'division'),
    status: options(report?.jobs || [], 'status'),
  }), [report]);
  const { totals, estimators, trend } = insights;
  const maxValue = estimators.reduce((max, group) => Math.max(max, group.value), 1);
  const maxReceived = trend.reduce((max, group) => Math.max(max, group.count), 1);
  const receivedCount = trend.reduce((count, group) => count + group.count, 0);
  const period = (['all', 'month', '30days'] as const).find(value => {
    const range = salesDateRange(value, today);
    return range.from === filters.from && range.to === filters.to;
  }) || 'custom';
  const extraFilterCount = [filters.division, filters.status, filters.estimates, period === 'custom' ? 'dates' : ''].filter(Boolean).length;
  const invalidRange = !!filters.from && !!filters.to && filters.from > filters.to;
  const filtered = Object.values(filters).some(Boolean);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(jobs.length / pageSize) - 1));
  const visible = jobs.slice(currentPage * pageSize, (currentPage + 1) * pageSize);
  const detail = report?.jobs.find(job => job.id === detailId);
  const focusViews: { value: SalesFocus; label: string; count: number }[] = [
    { value: '', label: 'All jobs', count: scopeTotals.jobs },
    { value: 'missing', label: 'Missing estimates', count: scopeTotals.missing },
    { value: 'aged', label: 'Pending 30+ days', count: scopeTotals.aged },
    { value: 'unassigned', label: 'Unassigned', count: scopeTotals.unassigned },
  ];

  return <section className="sales-page" aria-label="Sales dashboard">
    <header className="sales-header">
      <button className="icon-button mobile-only" aria-label="Open navigation" onClick={onMenu}><Menu size={21} /></button>
      <div><span className="sales-eyebrow">HAYS + SONS / SALES</span><h1>Sales dashboard</h1><p>Your pipeline at a glance. See what needs to move next.</p></div>
      <button className="button compact" disabled={loading} onClick={() => setRefresh(n => n + 1)}>{loading ? <Loader2 size={15} className="spin" /> : <RefreshCw size={15} />} Refresh</button>
    </header>
    <div className="sales-body" aria-busy={loading}>
      {error && <div className="error sales-load-error" role="alert">{error} <button className="text-button" disabled={loading} onClick={() => setRefresh(n => n + 1)}>Retry</button></div>}
      {unsupported && <div className="notice sales-connection"><strong>Connected workspace</strong><a href={backendUrl} target="_blank" rel="noreferrer">{backendUrl}<ExternalLink size={13} /></a><p>This must be your latest deployment address. A version label alone does not verify that the sales request is implemented.</p></div>}
      {report && <div className="sales-source"><span role="status"><span className={`sales-source-dot ${error ? 'stale' : ''}`} />{loading ? 'Refreshing report…' : error ? 'Showing last loaded report' : 'Connected to Google Sheets'}<span className="sales-updated" title={new Date(report.fetchedAt).toLocaleString('en-US', { timeZone: 'America/Indianapolis' })}> · Loaded {new Date(report.fetchedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Indianapolis' })} ET</span></span><a href={sourceUrl(report)} target="_blank" rel="noreferrer">Open source sheet <ExternalLink size={13} /></a></div>}
      {loading && !report ? <div className="sales-empty" role="status"><Loader2 size={28} className="spin" /><h2>Loading your sales report</h2><p>Reading the latest jobs from your connected sheet.</p></div> : !report ? <div className="sales-empty"><BarChart3 size={36} /><h2>Connect your sales report</h2><p>The dashboard uses your existing sign-in and the supplied sales spreadsheet.</p><a className="button" href="https://docs.google.com/spreadsheets/d/1Ba1IEJEOb3ILhsZrOZSHCOT5-6pELnwGT-inUcVMcTk/edit" target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open sales sheet</a></div> : <>
        <div className="sales-filters" aria-label="Sales filters">
          <label className="sales-search"><span className="sr-only">Search sales jobs</span><Search size={17} /><input aria-label="Search sales jobs" placeholder="Search job, customer, or carrier" value={filters.search} onChange={e => change('search', e.target.value)} /></label>
          <label>Estimator<select aria-label="Estimator" value={filters.estimator} onChange={e => change('estimator', e.target.value)}><option value="">All estimators</option>{filterOptions.estimator.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Received<select aria-label="Received range" value={period} onChange={e => { const range = salesDateRange(e.target.value as SalesPeriod, today); setRange(range.from, range.to); }}><option value="all">All time</option><option value="month">This month</option><option value="30days">Last 30 days</option><option value="custom" disabled>Custom dates</option></select></label>
          <button className={`button compact sales-filter-toggle ${extraFilterCount ? 'has-filters' : ''}`} aria-expanded={advanced} aria-controls="sales-extra-filters" onClick={() => setAdvanced(value => !value)}><Filter size={14} /> More filters{extraFilterCount > 0 && <span>{extraFilterCount}</span>}<ChevronDown size={14} className={advanced ? 'rotated' : ''} /></button>
          {filtered && <button className="text-button sales-clear" onClick={clearFilters}>Clear filters</button>}
        </div>
        <div id="sales-extra-filters" className="sales-extra-filters" hidden={!advanced}>
          <label>Division<select aria-label="Division" value={filters.division} onChange={e => change('division', e.target.value)}><option value="">All divisions</option>{filterOptions.division.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Job status<select aria-label="Job status" value={filters.status} onChange={e => change('status', e.target.value)}><option value="">All statuses</option>{filterOptions.status.map(value => <option key={value}>{value}</option>)}</select></label>
          <label>Estimate<select aria-label="Estimate" value={filters.estimates} onChange={e => change('estimates', e.target.value)}><option value="">All estimates</option><option value="entered">Amount entered</option><option value="missing">Not entered</option></select></label>
          <label>Received from<input type="date" value={filters.from} onChange={e => change('from', e.target.value)} /></label>
          <label>Received through<input type="date" value={filters.to} onChange={e => change('to', e.target.value)} /></label>
        </div>
        {invalidRange && <p className="error" role="alert">The received-through date must be on or after the received-from date.</p>}
        <div className="sales-focus" role="group" aria-label="Quick job views"><span>Quick view</span>{focusViews.map(view => <button key={view.value} className={filters.focus === view.value ? 'active' : ''} aria-pressed={filters.focus === view.value} onClick={() => change('focus', view.value)}>{view.label}<span>{view.count}</span></button>)}</div>
        <div className="sales-overview-label"><h2>Overview</h2><span aria-live="polite">{jobs.length} of {report.jobs.length} jobs{filtered ? ' · Filtered view' : ''}</span></div>
        <div className="sales-kpis">
          <div className="sales-kpi"><span><ClipboardList size={17} /> Pending sales jobs</span><strong>{totals.pending}</strong><small>{money(totals.pendingValue)} in entered estimates</small></div>
          <div className="sales-kpi emphasis"><span><CircleDollarSign size={17} /> Known estimate value</span><strong>{money(totals.value)}</strong><small>{totals.average === null ? 'No amounts entered' : `${money(totals.average)} average entered estimate`}<br />Estimates, not booked revenue</small></div>
          <div className="sales-kpi"><span><ArrowUpRight size={17} /> Estimates not entered</span><strong>{totals.missing}</strong><small>{totals.jobs ? `${Math.round(totals.priced / totals.jobs * 100)}% of jobs have an amount` : 'No jobs in this view'}<br />Entered $0 amounts are included</small></div>
          <div className="sales-kpi"><span><Clock3 size={17} /> Pending 30+ days</span><strong>{totals.aged}</strong><small>Pending jobs received 30+ days ago<br />Review for the next follow-up</small></div>
        </div>
        {(report.quality.invalidDates > 0 || report.quality.invalidEstimates > 0 || report.quality.skippedRows > 0) && <p className="notice sales-quality">Source report: {report.quality.invalidDates} dates could not be read; {report.quality.invalidEstimates} amounts could not be read; {report.quality.skippedRows} rows without a job number were skipped. Unreadable values are shown as not entered.</p>}
        <div className="sales-charts">
          <section className="sales-card"><div className="sales-card-heading"><div><h2>Estimator overview</h2><p>Entered estimates and follow-up workload · select to filter</p></div><Users size={18} /></div>
            {estimators.length ? <ul className="sales-bars">{estimators.map(group => <li key={group.name}><button className="sales-estimator" aria-label={`Filter estimator: ${group.name}`} aria-pressed={filters.estimator === group.name} onClick={() => change('estimator', filters.estimator === group.name ? '' : group.name)}><span className="sales-estimator-heading"><strong>{group.name}</strong><span>{money(group.value)}</span></span><span className="sales-track"><span style={{ width: `${Math.max(0, group.value) / maxValue * 100}%` }} /></span><small>{group.count} jobs · {group.count - group.priced} missing estimates{group.aged > 0 ? ` · ${group.aged} pending 30+ days` : ''}</small></button></li>)}</ul> : <p className="sales-chart-empty">No jobs match your filters.</p>}
          </section>
          <section className="sales-card"><div className="sales-card-heading"><div><h2>Jobs received</h2><p>Last 6 months in this view · select a month to filter</p></div><CalendarDays size={18} /></div>
            <div className="sales-trend-summary"><strong>{receivedCount}</strong><span>jobs received{trend.length ? ` · ${trend[0].month.slice(0, 4)}${trend[0].month.slice(0, 4) !== trend[5].month.slice(0, 4) ? `–${trend[5].month.slice(0, 4)}` : ''}` : ''}</span></div>
            <div className="sales-trend" role="group" aria-label="Jobs received by month">{trend.map((group, index) => <button key={group.month} aria-label={`Received ${group.month}: ${group.count} jobs`} aria-pressed={filters.from === group.from && filters.to === group.to} className={index === 5 ? 'current' : ''} onClick={() => setRange(filters.from === group.from && filters.to === group.to ? '' : group.from, filters.from === group.from && filters.to === group.to ? '' : group.to)}><strong>{group.count}</strong><span className="sales-trend-column"><span style={{ height: `${group.count / maxReceived * 100}%` }} /></span><span>{group.label}</span></button>)}</div>
            <p className="sales-chart-note">Current month through {date(today)}. Counts use received dates from this snapshot{receivedCount === 0 ? '; none fall in these months' : ''}.</p>
          </section>
        </div>
        <section className="sales-card sales-jobs"><div className="sales-card-heading"><div><h2>Sales opportunities <span>{jobs.length}</span></h2><p>Select a job for its latest note, contacts, and source row.</p></div><label className="sales-sort">Sort by<select aria-label="Sort sales jobs" value={sort} onChange={e => { setSort(e.target.value); setPage(0); }}><option value="newest">Newest received</option><option value="oldest">Oldest received</option><option value="estimate">Largest estimate</option></select></label></div>
          <div className="sales-table-scroll" role="region" aria-label="Sales opportunities table" tabIndex={0}><table className="sales-table"><thead><tr><th scope="col">Job / Customer</th><th scope="col">Estimator</th><th scope="col">Division</th><th scope="col">Status</th><th scope="col" className="sales-number">Estimate</th><th scope="col">Received / Age</th></tr></thead><tbody>{visible.map(job => {
            const age = ageDays(job, today);
            return <tr key={job.id}><td><button className="sales-job-link" onClick={() => setDetailId(job.id)}>{job.jobNumber}<ArrowUpRight size={13} /></button><span className="sales-customer">{job.customer || 'Customer not entered'}</span></td><td>{job.estimator || 'Unassigned'}</td><td>{job.division || 'Unassigned'}</td><td><span className="sales-status">{job.status || 'Not entered'}</span></td><td className={`sales-number ${job.estimate === null ? 'sales-missing' : ''}`}>{job.estimate === null ? 'Not entered' : money(job.estimate)}</td><td>{date(job.receivedDate)}<small className={age !== null && age >= 30 ? 'sales-old' : ''}>{age === null ? 'Age unavailable' : age < 0 ? 'Future date' : `${age} ${age === 1 ? 'day' : 'days'} ago`}</small></td></tr>;
          })}</tbody></table></div>
          {!jobs.length && <div className="sales-table-empty"><p>{report.jobs.length ? 'No jobs match these filters.' : 'The source report has no jobs yet.'}</p>{filtered && <button className="text-button" onClick={clearFilters}>Reset view</button>}</div>}
          <div className="sales-table-footer"><span>{jobs.length ? `${currentPage * pageSize + 1}–${Math.min((currentPage + 1) * pageSize, jobs.length)} of ${jobs.length} jobs` : '0 jobs'}{filtered ? ' · Filtered view' : ''}</span><div><button className="button compact" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button><button className="button compact" disabled={(currentPage + 1) * pageSize >= jobs.length} onClick={() => setPage(currentPage + 1)}>Next</button></div></div>
        </section>
        <p className="sales-footnote">Source: {report.source.sheetName}. All metrics follow your filters. Dates use the sheet’s time zone ({report.source.timezone}). Refresh after changes in Google Sheets.</p>
      </>}
    </div>
    {detail && report && <Modal title={detail.jobNumber} onClose={() => setDetailId(null)}>
      <p className="sales-detail-customer">{detail.customer || 'Customer not entered'}</p><span className="sales-status">{detail.status || 'Not entered'}</span>
      <dl className="sales-details">{[
        ['Estimate', detail.estimate === null ? 'Not entered' : money(detail.estimate)], ['Estimator', detail.estimator], ['Division', detail.division], ['Received', date(detail.receivedDate)], ['Inspected', date(detail.inspectedDate)], ['Insurance carrier', detail.insuranceCarrier], ['Primary adjuster', detail.primaryAdjuster], ['Referred by', detail.referredBy], ['Foreman', detail.foreman], ['Marketing person', detail.marketingPerson], ['Reason for closing', detail.closingReason],
      ].map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value || 'Not entered'}</dd></div>)}</dl>
      <h3 className="members-heading">Latest journal note</h3><p className="sales-journal">{plainJournal(detail.journalNote) || 'No journal note entered.'}</p>
      <div className="modal-actions"><a className="button" href={`${sourceUrl(report)}&range=A${detail.sourceRow}:O${detail.sourceRow}`} target="_blank" rel="noreferrer"><ExternalLink size={15} /> Open in Google Sheets</a><button className="button primary" onClick={() => setDetailId(null)}>Done</button></div>
    </Modal>}
  </section>;
}

