import { useCallback, useEffect, useRef, useState } from 'react';
import type { Message, Person, PreparedPicture } from './types';
import { useDelivery } from '../components/MessageDelivery';
import { mergeMessages } from './delivery';
import { startPolling } from './polling';
import { isCachedRead } from './api';
export { mergeMessages } from './delivery';

export type ApiCall = <T>(action: string, payload?: Record<string, unknown>, signal?: AbortSignal) => Promise<T>;
interface Page { messages: Message[]; hasMore: boolean; nextBeforeId?: string; readThrough?: string }
export function useMessages(api: ApiCall, conversationId: string, query: string, onRead: (id: string, through: string) => void, user: Person) {
  const { send: deliver, observe, outgoing } = useDelivery();
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
    let stopped = false, markingRead = false;
    let readRetryAt = 0;
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
        observe(page.messages);
        setMessages(old => query || first ? page.messages : mergeMessages(old, page.messages));
        if (first) { setHasMore(page.hasMore); cursor.current = historyCursor(page); first = false; }
        setError('');
        const through = page.readThrough || page.messages.at(-1)?.createdAt;
        if (navigator.onLine && !isCachedRead(page) && !query && document.visibilityState === 'visible' && through && through !== readThrough.current && !markingRead && Date.now() >= readRetryAt) {
          markingRead = true;
          void api('markRead', { conversationId, through }, controller.signal).then(() => {
            if (!stopped) { readThrough.current = through; readRef.current(conversationId, through); }
          }).catch(() => { readRetryAt = Date.now() + 5000; }).finally(() => { markingRead = false; });
        }
        return !isCachedRead(page);
      } catch (e) { if (!stopped) setError(report(e)); return false; }
      finally { if (!stopped) setLoading(false); }
    }
    const stopPolling = startPolling(load, { interval: 2000, hiddenInterval: 15000 });
    return () => { stopped = true; stopPolling(); if (epoch.current === version) epoch.current++; controller.abort(); };
  }, [api, conversationId, query, refresh, observe]);
  const visibleNow = useCallback((list: Message[]) => query ? list.filter(m => !m.deleted && m.body.toLowerCase().includes(query.toLowerCase())) : list, [query]);
  const update = useCallback((incoming: Message[]) => {
    revision.current++;
    observe(incoming);
    setMessages(old => visibleNow(mergeMessages(old, incoming)));
  }, [visibleNow, observe]);
  async function send(body: string, clientId: string, picture?: PreparedPicture) {
    const version = epoch.current;
    revision.current++;
    const message = await deliver(conversationId, body, clientId, '', picture);
    if (version === epoch.current) update([message]);
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
  return { messages: visibleNow(mergeMessages(outgoing.filter(m => m.conversationId === conversationId), messages)), hasMore, loading, olderLoading, error, send, mutate, update, loadOlder, retry: () => setRefresh(n => n + 1) };
}
function historyCursor(page:Page):Record<string,string> {
  if(page.nextBeforeId)return {beforeId:page.nextBeforeId};
  // Compatibility with the original deployed API. Version 2 uses IDs to handle tied timestamps.
  if(page.nextBeforeId===undefined&&page.messages[0])return {before:page.messages[0].createdAt};
  return {};
}
