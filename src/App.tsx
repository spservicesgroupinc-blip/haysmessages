import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { BarChart3, Hash, Info, Loader2, LogOut, Menu, MessageSquare, Plus, Search, Users, X } from 'lucide-react';
import { AuthScreen } from './components/AuthScreen';
import { BrandLogo } from './components/BrandLogo';
import { Avatar, Composer, MessageCard, MessageList } from './components/Chat';
import { Modal } from './components/Modal';
import { DeviceControls, PwaStatus } from './components/DeviceControls';
import { ApiError, backendUrl, loadSession, request, storeSession } from './lib/api';
import { clearSavedReads, offlineAccount } from './lib/offline';
import type { Bootstrap, Conversation, Message, Person, Session } from './lib/types';
import { mergeMessages, useMessages, type ApiCall } from './lib/useMessages';
import { createMessageAlerts } from './lib/messageAlerts';
import { listenSoundPreference, playMessageSound, prepareSound, soundEnabled } from './lib/notificationSound';

const errorText = (error: unknown) => error instanceof Error ? error.message : 'Something went wrong. Please try again.';
const SalesDashboard = lazy(() => import('./components/SalesDashboard'));
function conversationName(c: Conversation, people: Person[], email: string) {
  return c.kind === 'dm' ? people.find(p => p.email === c.members.find(m => m !== email))?.name || c.name : c.name;
}

export default function App() {
  const [session, setSession] = useState(loadSession);
  const sessionRef = useRef(session); sessionRef.current = session;
  const [notice, setNotice] = useState('');
  const changeSession = useCallback((next: Session | null) => {
    if (!next && sessionRef.current) void clearSavedReads(offlineAccount(sessionRef.current.user.email, backendUrl));
    storeSession(next);
    setSession(next);
  }, []);
  const expire = useCallback(() => {
    changeSession(null);
    setNotice('Your session has expired. Please sign in again.');
  }, [changeSession]);
  useEffect(() => {
    if (!session) return;
    const timeout = window.setTimeout(expire, Math.max(0, new Date(session.expiresAt).getTime() - Date.now()));
    return () => window.clearTimeout(timeout);
  }, [session, expire]);
  return <div className="app-frame"><PwaStatus />{!session ? <AuthScreen notice={notice} onSession={next => { setNotice(''); changeSession(next); }} /> : <Workspace key={session.token} session={session} onExpire={expire} onLogout={() => { setNotice(''); changeSession(null); }} />}</div>;
}

function Workspace({ session, onExpire, onLogout }: { session: Session; onExpire: () => void; onLogout: () => void }) {
  const [data, setData] = useState<Bootstrap | null>(null);
  const [selected, setSelected] = useState(() => new URLSearchParams(window.location.search).get('conversation') || '');
  const [page, setPage] = useState<'messages' | 'sales'>(() => new URLSearchParams(window.location.search).get('page') === 'sales' ? 'sales' : 'messages');
  const [error, setError] = useState('');
  const [mobileNav, setMobileNav] = useState(false);
  const [desktop, setDesktop] = useState(() => window.matchMedia('(min-width:701px)').matches);
  const sidebarRef = useRef<HTMLElement>(null);
  const [create, setCreate] = useState<Conversation['kind'] | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);
  const [refresh, setRefresh] = useState(0);
  const mounted = useRef(true);
  const revision = useRef(0);
  const soundAccount = offlineAccount(session.user.email, backendUrl);
  const sounds = useRef(soundEnabled(soundAccount));
  const alerts = useRef(createMessageAlerts(session.user.email, () => { if (sounds.current) playMessageSound(); }));
  useEffect(() => {
    const stop = listenSoundPreference(soundAccount, enabled => { sounds.current = enabled; });
    const unlock = () => { if (sounds.current) void prepareSound(); };
    window.addEventListener('pointerdown', unlock); window.addEventListener('keydown', unlock);
    return () => { stop(); window.removeEventListener('pointerdown', unlock); window.removeEventListener('keydown', unlock); };
  }, [soundAccount]);
  useEffect(() => {
    const open = (event: Event) => {
      const id = (event as CustomEvent<{conversationId?:string}>).detail?.conversationId;
      if (typeof id !== 'string') return;
      if (data?.conversations.some(c => c.id === id)) { setSelected(id); setPage('messages'); setMobileNav(false); }
      else setError('This conversation is not available in your workspace.');
    };
    window.addEventListener('hays:open-conversation', open);
    return () => window.removeEventListener('hays:open-conversation', open);
  }, [data]);
  useEffect(() => {
    const device = navigator as Navigator & { setAppBadge?: (value: number) => Promise<void>; clearAppBadge?: () => Promise<void> };
    const unread = data?.conversations.reduce((total, c) => total + c.unread, 0) || 0;
    if (unread) void device.setAppBadge?.(unread).catch(() => {});
    else void device.clearAppBadge?.().catch(() => {});
  }, [data]);
  const api: ApiCall = useCallback(async <T,>(action: string, payload: Record<string, unknown> = {}, signal?: AbortSignal) => {
    try {
      const result = await request<T>(action, payload, session, signal);
      if (mounted.current && navigator.onLine && !signal?.aborted) {
        if (action === 'bootstrap') alerts.current.bootstrap((result as Bootstrap).conversations);
        if ((action === 'listMessages' || action === 'getThread') && !payload.query && !payload.before && !payload.beforeId) {
          alerts.current.messages(String(payload.conversationId), (result as {messages: Message[]}).messages, `${action}:${payload.conversationId}:${payload.parentId || ''}`);
        }
      }
      return result;
    }
    catch (e) {
      if (mounted.current && e instanceof ApiError && ['unauthorized', 'session_expired'].includes(e.code)) onExpire();
      throw e;
    }
  }, [session, onExpire]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    const media = window.matchMedia('(min-width:701px)');
    const changed = () => { setDesktop(media.matches); if (media.matches) setMobileNav(false); };
    media.addEventListener('change', changed);
    return () => media.removeEventListener('change', changed);
  }, []);
  useEffect(() => {
    if (!mobileNav || desktop) return;
    const previous = document.activeElement as HTMLElement | null;
    sidebarRef.current?.querySelector<HTMLElement>('button')?.focus();
    return () => previous?.focus();
  }, [mobileNav, desktop]);
  useEffect(() => {
    let stopped = false;
    let timer: number;
    const controller = new AbortController();
    async function load() {
      const version = revision.current;
      try {
        const next = await api<Bootstrap>('bootstrap', {}, controller.signal);
        if (stopped || version !== revision.current) return;
        setData(next); setError('');
        setSelected(previous => next.conversations.some(c => c.id === previous) ? previous : next.conversations.find(c => c.name === 'general')?.id || next.conversations[0]?.id || '');
      } catch (e) { if (!stopped) setError(errorText(e)); }
      finally { if (!stopped) timer = window.setTimeout(load, 15000); }
    }
    void load();
    return () => { stopped = true; controller.abort(); window.clearTimeout(timer); };
  }, [api, refresh]);
  const markRead = useCallback((id: string) => {
    alerts.current.read(id);
    revision.current++;
    setData(previous => previous && { ...previous, conversations: previous.conversations.map(c => c.id === id ? { ...c, unread: 0 } : c) });
  }, []);
  function choose(id: string) {
    setSelected(id); setPage('messages'); setMobileNav(false);
    const url = new URL(window.location.href); url.searchParams.set('conversation', id); url.searchParams.delete('page'); history.replaceState(null, '', url);
  }
  function showPage(next: 'messages' | 'sales') {
    setPage(next); setMobileNav(false);
    const url = new URL(window.location.href);
    if (next === 'sales') url.searchParams.set('page', 'sales'); else url.searchParams.delete('page');
    history.replaceState(null, '', url);
  }
  async function logout() {
    setLoggingOut(true);
    try { await api('logout'); onLogout(); }
    catch (e) { setError(`${errorText(e)} Sign-out was not completed; please retry.`); }
    finally { setLoggingOut(false); }
  }
  const user = data?.user || session.user;
  const people = data?.people || [];
  const active = data?.conversations.find(c => c.id === selected);
  return <div className="app-shell">
    {mobileNav && <button className="nav-scrim" tabIndex={-1} aria-label="Close navigation" onClick={() => setMobileNav(false)} />}
    <aside ref={sidebarRef} inert={!desktop && !mobileNav} className={`sidebar ${mobileNav ? 'open' : ''}`} role={!desktop && mobileNav ? 'dialog' : undefined} aria-modal={!desktop && mobileNav ? true : undefined} aria-label="Workspace navigation" onKeyDown={e => {
      if (desktop || !mobileNav) return;
      if (e.key === 'Escape') setMobileNav(false);
      if (e.key === 'Tab') {
        const controls = sidebarRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled)');
        const first = controls?.[0], last = controls?.[controls.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); }
      }
    }}>
      <div className="sidebar-brand"><BrandLogo size={32} sublabel="Team Messaging" tone="inverted" /><button className="icon-button mobile-only" aria-label="Close navigation" onClick={() => setMobileNav(false)}><X size={20} /></button></div>
      <div className="workspace-label"><span className="workspace-dot" /> Hays + Sons workspace</div>
      <nav className="workspace-pages" aria-label="Workspace pages"><button className={`workspace-page-link ${page === 'messages' ? 'active' : ''}`} aria-current={page === 'messages' ? 'page' : undefined} onClick={() => showPage('messages')}><MessageSquare size={17} /><span>Messages</span></button><button className={`workspace-page-link ${page === 'sales' ? 'active' : ''}`} aria-current={page === 'sales' ? 'page' : undefined} onClick={() => showPage('sales')}><BarChart3 size={17} /><span>Sales dashboard</span></button></nav>
      <button className="new-message button" onClick={() => setCreate('dm')}><Plus size={17} /> New conversation</button>
      <nav className="conversation-nav">
        {(['channel', 'group', 'dm'] as const).map(kind => <section className="nav-section" key={kind}>
          <div className="nav-heading"><h2>{kind === 'channel' ? 'Channels' : kind === 'group' ? 'Group messages' : 'Direct messages'}</h2><button className="icon-button" aria-label={`Create ${kind === 'dm' ? 'direct message' : kind}`} onClick={() => setCreate(kind)}><Plus size={15} /></button></div>
          {data?.conversations.filter(c => c.kind === kind).map(c => <button className={`conversation-link ${page === 'messages' && selected === c.id ? 'active' : ''}`} aria-current={page === 'messages' && selected === c.id ? 'page' : undefined} key={c.id} onClick={() => choose(c.id)}>
            {kind === 'channel' ? <Hash size={17} /> : kind === 'group' ? <Users size={17} /> : <Avatar small name={conversationName(c, people, user.email)} />}
            <span>{conversationName(c, people, user.email)}</span>{c.unread > 0 && <span className="unread" aria-label={`${c.unread} unread messages`}>{c.unread > 99 ? '99+' : c.unread}</span>}
          </button>)}
          {data && !data.conversations.some(c => c.kind === kind) && <p className="nav-empty">{kind === 'channel' ? 'Create your first channel.' : 'Start a conversation.'}</p>}
        </section>)}
      </nav>
      <DeviceControls session={session} />
      <div className="sidebar-footer"><Avatar small name={user.name} /><div><strong>{user.name}</strong><span>{user.role === 'admin' ? 'Administrator' : 'Team member'}</span></div><button className="icon-button" disabled={loggingOut} aria-label="Sign out" title="Sign out" onClick={() => void logout()}>{loggingOut ? <Loader2 size={17} className="spin" /> : <LogOut size={17} />}</button></div>
    </aside>
    <main className="workspace-main" inert={!desktop && mobileNav}>
      {error && <div className="workspace-error" role="alert"><span>{error}</span><button className="text-button" onClick={() => setRefresh(n => n + 1)}>Retry</button></div>}
      {page === 'sales' ? <Suspense fallback={<div className="workspace-empty" role="status"><Loader2 className="spin" /><p>Loading sales dashboard</p></div>}><SalesDashboard api={api} onMenu={() => setMobileNav(true)} /></Suspense> : active ? <ConversationView key={active.id} conversation={active} title={conversationName(active, people, user.email)} people={people} user={user} api={api} onRead={markRead} onMenu={() => setMobileNav(true)} /> : <div className="workspace-empty"><button className="icon-button mobile-only" aria-label="Open navigation" onClick={() => setMobileNav(true)}><Menu /></button>{!data ? <><Loader2 className="spin" /><h2>Loading your workspace</h2></> : <><MessageSquare size={36} /><h2>Welcome to your workspace</h2><p>Create a channel or message a teammate to get started.</p><button className="button primary" onClick={() => setCreate('channel')}>Create a channel</button></>}</div>}
    </main>
    {create && <CreateConversation kind={create} people={people} user={user} api={api} onClose={() => setCreate(null)} onCreated={c => {
      revision.current++;
      setData(previous => previous && { ...previous, conversations: [...previous.conversations.filter(existing => existing.id !== c.id), c] });
      choose(c.id); setCreate(null); setRefresh(n => n + 1);
    }} />}
  </div>;
}

function ConversationView({ conversation, title, people, user, api, onRead, onMenu }: { conversation: Conversation; title: string; people: Person[]; user: Person; api: ApiCall; onRead: (id: string) => void; onMenu: () => void }) {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [thread, setThread] = useState('');
  const [details, setDetails] = useState(false);
  const feed = useMessages(api, conversation.id, query, onRead);
  const draftKey = `${user.email}:${conversation.id}`;
  const members = conversation.kind === 'channel' ? people : people.filter(p => conversation.members.includes(p.email));
  return <div className="conversation-view">
    <header className="conversation-header"><button className="icon-button mobile-only" aria-label="Open navigation" onClick={onMenu}><Menu size={21} /></button><span className="conversation-symbol">{conversation.kind === 'channel' ? <Hash /> : conversation.kind === 'group' ? <Users /> : <MessageSquare />}</span><div className="conversation-title"><h1>{title}</h1><p>{conversation.description || (conversation.kind === 'channel' ? 'Keep everyone in the loop.' : `${members.length} teammates in this conversation`)}</p></div><button className="icon-button" aria-label="Conversation details" onClick={() => setDetails(true)}><Info size={20} /></button></header>
    <form className="search-bar" role="search" onSubmit={e => { e.preventDefault(); setQuery(search.trim()); }}><Search size={17} /><input aria-label="Search this conversation" placeholder="Search this conversation" value={search} onChange={e => { setSearch(e.target.value); if (!e.target.value) setQuery(''); }} maxLength={200} /><button className="text-button" type="submit">Search</button>{(search || query) && <button className="icon-button" type="button" aria-label="Clear search" onClick={() => { setSearch(''); setQuery(''); }}><X size={16} /></button>}</form>
    <div className="chat-panels"><div className="main-chat">
      {query && <div className="search-summary">Results for “{query}”</div>}
      {feed.error && <div className="workspace-error" role="alert"><span>{feed.error}</span><button className="text-button" onClick={feed.retry}>Retry</button></div>}
      <MessageList key={query} messages={feed.messages} user={user} query={query} hasMore={feed.hasMore} loading={feed.loading || feed.olderLoading} onOlder={() => void feed.loadOlder()} onThread={setThread} onAction={feed.mutate} />
      <div className="composer-wrap"><Composer key={draftKey} draftKey={draftKey} label={`Message ${conversation.kind === 'channel' ? '#' : ''}${title}`} onSend={feed.send} /></div>
    </div>{thread && <ThreadPanel key={thread} parentId={thread} conversationId={conversation.id} user={user} api={api} onClose={() => setThread('')} onUpdate={feed.update} />}</div>
    {details && <Modal title={title} onClose={() => setDetails(false)}><p className="muted">{conversation.description || 'A space to keep the team connected.'}</p><h3 className="members-heading">{members.length} {members.length === 1 ? 'teammate' : 'teammates'}</h3><div className="member-list">{members.map(person => <div className="member" key={person.email}><Avatar small name={person.name} /><div><strong>{person.name}{person.email === user.email ? ' (you)' : ''}</strong><span>{person.email}</span></div></div>)}</div></Modal>}
  </div>;
}

function ThreadPanel({ parentId, conversationId, user, api, onClose, onUpdate }: { parentId: string; conversationId: string; user: Person; api: ApiCall; onClose: () => void; onUpdate: (messages: Message[]) => void }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [refresh, setRefresh] = useState(0);
  const revision = useRef(0);
  const updateRef = useRef(onUpdate); updateRef.current = onUpdate;
  useEffect(() => {
    let stopped = false; let timer: number;
    const controller = new AbortController();
    async function load() {
      const version = revision.current;
      try {
        const result = await api<{ messages: Message[] }>('getThread', { conversationId, parentId }, controller.signal);
        if (!stopped && version === revision.current) { setMessages(result.messages); updateRef.current(result.messages); setError(''); }
      } catch (e) { if (!stopped) setError(errorText(e)); }
      finally { if (!stopped) { setLoading(false); timer = window.setTimeout(load, 8000); } }
    }
    void load();
    return () => { stopped = true; controller.abort(); window.clearTimeout(timer); };
  }, [api, parentId, conversationId, refresh]);
  function update(message: Message) { revision.current++; setMessages(old => mergeMessages(old, [message])); updateRef.current([message]); }
  async function send(body: string, clientId: string) { revision.current++; update(await api<Message>('sendMessage', { conversationId, parentId, body, clientId })); }
  async function mutate(action: string, message: Message, value?: string) { revision.current++; update(await api<Message>(action, { messageId: message.id, body: value, emoji: value })); }
  const parent = messages.find(m => m.id === parentId);
  return <aside className="thread-panel" aria-label="Message thread"><div className="thread-heading"><h2>Thread</h2><button className="icon-button" aria-label="Close thread" onClick={onClose}><X size={20} /></button></div><div className="thread-messages">
    {error && <p className="error" role="alert">{error} <button className="text-button" onClick={() => setRefresh(n => n + 1)}>Retry</button></p>}
    {loading ? <div className="chat-empty"><Loader2 className="spin" /></div> : !messages.length ? <p className="muted">This thread is unavailable.</p> : messages.map(m => <MessageCard key={m.id} message={m} user={user} onThread={() => {}} onAction={mutate} threadView />)}
  </div>{parent && !parent.deleted && <div className="composer-wrap"><Composer draftKey={`${user.email}:${conversationId}:${parentId}`} label="Reply to thread" onSend={send} /></div>}{parent?.deleted && <p className="thread-notice">The original message was removed. Existing replies remain available.</p>}</aside>;
}

function CreateConversation({ kind: initialKind, people, user, api, onClose, onCreated }: { kind: Conversation['kind']; people: Person[]; user: Person; api: ApiCall; onClose: () => void; onCreated: (c: Conversation) => void }) {
  const [kind, setKind] = useState(initialKind);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [members, setMembers] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(e: React.FormEvent) {
    e.preventDefault(); if (busy) return; setBusy(true); setError('');
    try { onCreated(await api<Conversation>('createConversation', { kind, name: kind === 'dm' ? people.find(p => p.email === members[0])?.name || 'Direct message' : name, description, members })); }
    catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  }
  return <Modal title="New conversation" onClose={onClose}><form className="form-stack" onSubmit={submit}><label>Conversation type<select disabled={busy} value={kind} onChange={e => { setKind(e.target.value as Conversation['kind']); setMembers([]); setError(''); }}><option value="dm">Direct message</option><option value="group">Group message</option><option value="channel">Channel</option></select></label>
    {kind !== 'dm' && <><label>{kind === 'channel' ? 'Channel name' : 'Group name'}<input value={name} onChange={e => setName(e.target.value)} placeholder={kind === 'channel' ? 'e.g. field-updates' : 'e.g. Northside project team'} maxLength={80} required disabled={busy} /></label><label>Description <span className="field-hint">(optional)</span><textarea rows={2} value={description} onChange={e => setDescription(e.target.value)} maxLength={300} disabled={busy} /></label></>}
    {kind !== 'channel' ? <fieldset className="people-picker"><legend>{kind === 'dm' ? 'Choose a teammate' : 'Choose up to 29 teammates'}</legend>{people.filter(p => p.email !== user.email).map(person => <label className="person-option" key={person.email}><input type={kind === 'dm' ? 'radio' : 'checkbox'} name="members" checked={members.includes(person.email)} disabled={busy || (kind === 'group' && members.length >= 29 && !members.includes(person.email))} onChange={e => setMembers(kind === 'dm' ? [person.email] : e.target.checked ? [...members, person.email] : members.filter(m => m !== person.email))} /><Avatar small name={person.name} /><span>{person.name}<small>{person.email}</small></span></label>)}{people.length < 2 && <p className="muted">Your teammates will appear here when they join.</p>}</fieldset> : <p className="muted">Channels are visible to everyone in the workspace.</p>}
    {error && <p className="error" role="alert">{error}</p>}<div className="modal-actions"><button type="button" className="button" disabled={busy} onClick={onClose}>Cancel</button><button className="button primary" disabled={busy || (kind !== 'channel' && !members.length) || (kind !== 'dm' && !name.trim())}>{busy ? <Loader2 className="spin" size={16} /> : <Plus size={16} />} {kind === 'dm' ? 'Start conversation' : 'Create conversation'}</button></div>
  </form></Modal>;
}
