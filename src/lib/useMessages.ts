import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message, Person } from './types';

export type ApiCall = <T>(action: string, payload?: Record<string, unknown>, signal?: AbortSignal) => Promise<T>;
interface Page { messages: Message[]; hasMore: boolean; nextBeforeId?: string; readThrough?: string }
export function mergeMessages(previous: Message[], incoming: Message[]) {
  const map = new Map(previous.map(m => [m.id, m]));
  incoming.forEach(m => map.set(m.id, m));
  return [...map.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}
export function useMessages(api: ApiCall, conversationId: string, query: string, onRead: (id: string) => void, user: Person) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [olderLoading, setOlderLoading] = useState(false);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const cursor = useRef<Record<string,string>>({});
  const epoch = useRef(0);
  const revision = useRef(0);
  const olderBusy = useRef(false);
  const readRef = useRef(onRead); readRef.current = onRead;
  const readThrough = useRef('');
  const report = (e: unknown) => e instanceof Error ? e.message : 'Could not load messages.';
  useEffect(() => {
    let stopped = false; let timer: number;
    const version = ++epoch.current;
    const controller = new AbortController();
    let first = true;
    setLoading(true); setMessages([]); setHasMore(false); setError('');
    cursor.current = {}; olderBusy.current = false; setOlderLoading(false);
    async function load() {
      const mutation = revision.current;
      try {
        const page = await api<Page>('listMessages', { conversationId, query }, controller.signal);
        if (stopped || mutation !== revision.current) return;
        setMessages(old => query || first ? page.messages : mergeMessages(old, page.messages));
        if (first) { setHasMore(page.hasMore); cursor.current = historyCursor(page); first = false; }
        setError('');
        const through = page.readThrough || page.messages.at(-1)?.createdAt;
        if (navigator.onLine && !query && document.visibilityState === 'visible' && through && through !== readThrough.current) {
          await api('markRead', { conversationId, through }, controller.signal);
          if (!stopped) { readThrough.current = through; readRef.current(conversationId); }
        }
      } catch (e) { if (!stopped) setError(report(e)); }
      finally { if (!stopped) { setLoading(false); timer = window.setTimeout(load, 8000); } }
    }
    void load();
    return () => { stopped = true; if (epoch.current === version) epoch.current++; controller.abort(); window.clearTimeout(timer); };
  }, [api, conversationId, query, refresh]);
  const visibleNow = useCallback((list: Message[]) => query ? list.filter(m => !m.deleted && m.body.toLowerCase().includes(query.toLowerCase())) : list, [query]);
  const update = useCallback((incoming: Message[]) => {
    revision.current++;
    setMessages(old => visibleNow(mergeMessages(old, incoming)));
  }, [visibleNow]);
  async function send(body: string, clientId: string) {
    const version = epoch.current;
    revision.current++;
    // Show the message immediately so the slow Apps Script round trip cannot
    // delay the conversation; the request replaces it once the server confirms.
    const optimistic: Message = { id: `pending:${clientId}`, conversationId, authorEmail: user.email, authorName: user.name, body, createdAt: new Date().toISOString(), updatedAt: '', deleted: false, parentId: '', reactions: {}, clientId, pending: 'sending' };
    setMessages(old => visibleNow(mergeMessages(old, [optimistic])));
    try {
      const message = await api<Message>('sendMessage', { conversationId, body, clientId });
      if (version === epoch.current) setMessages(old => visibleNow(mergeMessages(old.filter(m => m.id !== optimistic.id), [message])));
    } catch (error) {
      // Restore the previous view; Composer keeps the text for a retry with the same identifier.
      if (version === epoch.current) setMessages(old => old.filter(m => m.id !== optimistic.id));
      throw error;
    }
  }
  async function mutate(action: string, message: Message, value?: string) {
    const version = epoch.current;
    revision.current++;
    const next = await api<Message>(action, { messageId: message.id, body: value, emoji: value });
    if (version === epoch.current) update([next]);
  }
  async function loadOlder() {
    if (olderBusy.current || !hasMore || !Object.keys(cursor.current).length) return;
    olderBusy.current = true; setOlderLoading(true);
    const version = epoch.current;
    // Invalidate any refresh already in flight before extending history.
    revision.current++;
    try {
      const page = await api<Page>('listMessages', { conversationId, query, ...cursor.current });
      if (version !== epoch.current) return;
      setMessages(old => mergeMessages(page.messages, old));
      setHasMore(page.hasMore); cursor.current = historyCursor(page); setError('');
    } catch (e) { if (version === epoch.current) setError(report(e)); }
    finally { if (version === epoch.current) { olderBusy.current = false; setOlderLoading(false); } }
  }
  return { messages, hasMore, loading, olderLoading, error, send, mutate, update, loadOlder, retry: () => setRefresh(n => n + 1) };
}
function historyCursor(page:Page):Record<string,string> {
  if(page.nextBeforeId)return {beforeId:page.nextBeforeId};
  // Compatibility with the original deployed API. Version 2 uses IDs to handle tied timestamps.
  if(page.nextBeforeId===undefined&&page.messages[0])return {before:page.messages[0].createdAt};
  return {};
}
