import { useCallback, useEffect, useRef, useState } from 'react';
import { Loader2, MessageSquare, RefreshCw, Send, Trash2 } from 'lucide-react';
import type { Person } from '../lib/types';
import type { ApiCall } from '../lib/useMessages';
import { startPolling } from '../lib/polling';
import { ApiError, backendUrl } from '../lib/api';

export interface SalesComment {
  id: string; jobNumber: string; authorEmail: string; authorName: string;
  body: string; clientId: string; createdAt: string;
}
export interface CommentSummary { count: number; latest: SalesComment | null }
interface CommentPage { comments: SalesComment[]; hasMore: boolean; nextBeforeId: string }
const failure = (error: unknown) => error instanceof ApiError && error.code === 'unknown_action'
  ? 'Team comments need the updated Apps Script (version 8.5). Ask the workspace owner to publish it, then retry.'
  : error instanceof Error ? error.message : 'Could not load team comments. Please retry.';
const commentTime = (value: string) => new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

export function useSalesCommentSummaries(api: ApiCall, sourceKey: string, jobNumbers: string[], fetchedAt: string) {
  const [summaries, setSummaries] = useState<Record<string, CommentSummary>>({});
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const changed = useCallback(() => setRevision(n => n + 1), []);
  const numbers = JSON.stringify([...new Set(jobNumbers)]);
  useEffect(() => { setSummaries({}); }, [sourceKey]);
  useEffect(() => {
    if (!sourceKey || numbers === '[]') return;
    let stopped = false;
    const controller = new AbortController();
    const stop = startPolling(async () => {
      try {
        const result = await api<{ summaries: Record<string, CommentSummary> }>('salesCommentSummaries', { sourceKey, jobNumbers: JSON.parse(numbers) }, controller.signal);
        if (!stopped) { setSummaries(old => ({ ...old, ...result.summaries })); setError(''); }
      } catch (e) { if (!stopped) setError(failure(e)); return false; }
    }, { interval: 10000, hiddenInterval: 30000 });
    return () => { stopped = true; stop(); controller.abort(); };
  }, [api, sourceKey, numbers, fetchedAt, revision]);
  return { summaries, error, changed };
}

export function SalesCommentPreview({ jobNumber, summary, onOpen }: { jobNumber: string; summary?: CommentSummary; onOpen: () => void }) {
  return <div className="sales-comment-preview">
    {summary?.latest && <><div className="sales-comment-byline"><strong>{summary.latest.authorName}</strong><time dateTime={summary.latest.createdAt}>{commentTime(summary.latest.createdAt)}</time></div><p>{summary.latest.body}</p></>}
    <button className="text-button" aria-label={`Team comments for ${jobNumber}`} onClick={onOpen}><MessageSquare size={13} />{summary?.count ? `${summary.count} ${summary.count === 1 ? 'comment' : 'comments'} · View board` : 'Add team comment'}</button>
  </div>;
}

export function SalesCommentBoard({ api, sourceKey, jobNumber, user, onChanged }: { api: ApiCall; sourceKey: string; jobNumber: string; user: Person; onChanged: () => void }) {
  const storageKey = `hays.sales-comment:${backendUrl}:${user.email}:${sourceKey}:${jobNumber}`;
  const [draft, setDraft] = useState<{ body: string; id: string }>(() => {
    try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || 'null'); if (typeof saved?.body === 'string' && typeof saved?.id === 'string') return saved; } catch { /* Draft can stay in memory. */ }
    return { body: '', id: '' };
  });
  const [page, setPage] = useState<CommentPage>({ comments: [], hasMore: false, nextBeforeId: '' });
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [pending, setPending] = useState<SalesComment | null>(null);
  const [removing, setRemoving] = useState('');
  const [confirmRemove, setConfirmRemove] = useState('');
  const [error, setError] = useState('');
  const [writeError, setWriteError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const [history, setHistory] = useState(false);
  const mutation = useRef(0);
  const busy = useRef(false);
  function persist(value: { body: string; id: string }) {
    setDraft(value);
    try { if (value.body || value.id) sessionStorage.setItem(storageKey, JSON.stringify(value)); else sessionStorage.removeItem(storageKey); } catch { /* In-memory recovery remains available. */ }
  }
  useEffect(() => {
    let stopped = false;
    const controller = new AbortController();
    const stop = startPolling(async () => {
      if (busy.current || history) return;
      const version = mutation.current;
      try {
        const result = await api<CommentPage>('listSalesComments', { sourceKey, jobNumber }, controller.signal);
        if (!stopped && version === mutation.current) { setPage(result); setError(''); }
      } catch (e) { if (!stopped) setError(failure(e)); return false; }
      finally { if (!stopped) setLoading(false); }
    }, { interval: 5000, hiddenInterval: 30000 });
    return () => { stopped = true; stop(); controller.abort(); };
  }, [api, sourceKey, jobNumber, refresh, history]);
  async function post(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.body.trim() || busy.current) return;
    const body = draft.body.trim(), clientId = draft.id || crypto.randomUUID();
    persist({ body, id: clientId }); busy.current = true; mutation.current++;
    setSending(true); setWriteError('');
    setPending({ id: `pending:${clientId}`, jobNumber, authorEmail: user.email, authorName: user.name, body, clientId, createdAt: new Date().toISOString() });
    try {
      const result = await api<SalesComment>('addSalesComment', { sourceKey, jobNumber, body, clientId });
      setPage(old => ({ ...old, comments: [...old.comments.filter(c => c.id !== result.id), result] }));
      persist({ body: '', id: '' }); onChanged();
    } catch (e) { setWriteError(failure(e)); }
    finally { mutation.current++; busy.current = false; setSending(false); setPending(null); }
  }
  async function older() {
    if (loading || busy.current) return;
    busy.current = true; setLoading(true); setError(''); mutation.current++; const version = mutation.current;
    try {
      const result = await api<CommentPage>('listSalesComments', { sourceKey, jobNumber, beforeId: page.nextBeforeId });
      if (version === mutation.current) {
        setPage(old => ({ ...result, comments: [...result.comments, ...old.comments] })); setHistory(true);
      }
    } catch (e) { setError(failure(e)); }
    finally { mutation.current++; busy.current = false; setLoading(false); }
  }
  async function remove(comment: SalesComment) {
    if (busy.current) return;
    busy.current = true; mutation.current++; setRemoving(comment.id); setWriteError('');
    try {
      await api('deleteSalesComment', { sourceKey, commentId: comment.id });
      setPage(old => ({ ...old, comments: old.comments.filter(c => c.id !== comment.id) }));
      setConfirmRemove(''); onChanged();
    } catch (e) { setWriteError(failure(e)); }
    finally { mutation.current++; busy.current = false; setRemoving(''); }
  }
  const comments = pending ? [...page.comments, pending] : page.comments;
  return <section className="sales-comment-board" aria-label={`Team comments for ${jobNumber}`}>
    <div className="sales-board-heading"><div><h3><MessageSquare size={16} /> Team comments</h3><p>Shared with your team · Keep the next person up to date.</p></div><button type="button" className="icon-button" aria-label="Refresh team comments" disabled={loading || sending || !!removing} onClick={() => { setHistory(false); setRefresh(n => n + 1); }}><RefreshCw size={15} /></button></div>
    {error && <p className="error" role="alert">{error}</p>}
    {history && <p className="sales-board-history">Viewing earlier history. Refresh to return to the latest comments.</p>}
    <div className="sales-board-feed" role="log" aria-label="Job comment history" aria-live="polite" aria-relevant="additions text">
      {!comments.length && <p className="sales-board-empty">{loading ? 'Loading comments…' : error ? 'Comments are unavailable.' : 'No team comments yet. Add the first update.'}</p>}
      {[...comments].reverse().map(comment => <article className={`sales-board-comment ${comment.id.startsWith('pending:') ? 'pending' : ''}`} key={comment.id}>
        <div className="sales-comment-byline"><strong>{comment.authorName}</strong><time dateTime={comment.createdAt} title={new Date(comment.createdAt).toLocaleString()}>{commentTime(comment.createdAt)}</time>{comment.id.startsWith('pending:') ? <span className="pending-note"><Loader2 size={12} className="spin" /> Posting…</span> : (user.email === comment.authorEmail || user.role === 'admin') && <button type="button" className="icon-button" aria-label={`Remove comment by ${comment.authorName}`} disabled={sending || !!removing || loading} onClick={() => setConfirmRemove(comment.id)}><Trash2 size={13} /></button>}</div>
        <p>{comment.body}</p>
        {confirmRemove === comment.id && <div className="sales-comment-remove"><span>Remove this comment for everyone?</span><button type="button" className="text-button" disabled={!!removing} onClick={() => void remove(comment)}>{removing ? 'Removing…' : 'Remove comment'}</button><button type="button" className="text-button" disabled={!!removing} onClick={() => setConfirmRemove('')}>Cancel</button></div>}
      </article>)}
    </div>
    {page.hasMore && <button type="button" className="text-button" disabled={loading || sending || !!removing} onClick={() => void older()}>{loading ? 'Loading…' : 'Load earlier comments'}</button>}
    <form className="sales-comment-form" onSubmit={post}>
      <label htmlFor="sales-comment-draft">Add a team update</label>
      <textarea id="sales-comment-draft" value={draft.body} maxLength={2000} rows={3} disabled={sending} placeholder="Customer contact, follow-up, or next step…" onChange={e => persist({ body: e.target.value, id: e.target.value.trim() === draft.body.trim() ? draft.id : '' })} />
      <div><small>{draft.body.length}/2,000</small><button type="submit" className="button primary compact" disabled={sending || !!removing || loading || !draft.body.trim()}>{sending ? <Loader2 className="spin" size={14} /> : <Send size={14} />}{sending ? 'Posting…' : 'Post comment'}</button></div>
      {writeError && <p className="error" role="alert">{writeError} Your comment is saved here for retry.</p>}
    </form>
  </section>;
}
