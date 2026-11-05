import type { Message, Person } from './types';

function identity(message: Message) {
  return message.clientId ? JSON.stringify([message.conversationId, message.authorEmail, message.clientId]) : message.id;
}

export function mergeMessages(previous: Message[], incoming: Message[]) {
  const messages = new Map<string, Message>();
  for (const message of [...previous, ...incoming]) {
    const key = identity(message);
    const existing = messages.get(key);
    if (existing && !existing.pending && message.pending) continue;
    messages.set(key, message);
  }
  return [...messages.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

type SendApi = (action: string, payload: Record<string, unknown>) => Promise<Message>;

// One instance per signed-in workspace. Requests keep running when a chat or
// thread closes; pending messages remain available to every view of that space.
export function createDelivery(api: SendApi, user: Person, onDelivered: (message: Message) => void = () => {}) {
  let messages: Message[] = [];
  const listeners = new Set<() => void>();
  const inFlight = new Map<string, Promise<Message>>();
  const observed = new Map<string, Message>();
  function publish(message: Message) {
    messages = messages.filter(m => identity(m) !== identity(message));
    messages.push(message);
    // Retain pending/failed messages and a bounded set of recent confirmations.
    const recent = new Set(messages.filter(m => !m.pending).slice(-100));
    messages = messages.filter(m => m.pending || recent.has(m));
    listeners.forEach(listener => listener());
  }
  function observe(incoming: Message[]) {
    let changed = false;
    for (const message of incoming) {
      const key = identity(message);
      if (inFlight.has(key)) observed.set(key, message);
      const existing = messages.find(m => identity(m) === key);
      if (existing) {
        messages = messages.filter(m => identity(m) !== key);
        changed = true;
        if (existing.pending) onDelivered(message);
      }
    }
    if (changed) listeners.forEach(listener => listener());
  }
  function send(conversationId: string, body: string, clientId: string, parentId = ''): Promise<Message> {
    const optimistic: Message = { id: `pending:${clientId}`, conversationId, authorEmail: user.email, authorName: user.name, body, createdAt: new Date().toISOString(), updatedAt: '', deleted: false, parentId, reactions: {}, clientId, pending: 'sending' };
    const key = identity(optimistic);
    const running = inFlight.get(key);
    if (running) return running;
    const existing = messages.find(m => identity(m) === key);
    if (existing && !existing.pending) return Promise.resolve(existing);
    if (existing) optimistic.createdAt = existing.createdAt;
    publish(optimistic);
    const task = (async () => {
      try {
        const result = await api('sendMessage', { conversationId, parentId, body, clientId });
        const read = observed.get(key);
        if (!read) { publish(result); onDelivered(result); }
        return read || result;
      } catch (error) {
        // A read can prove delivery even when the original write response is lost.
        const read = observed.get(key);
        if (read) return read;
        publish({ ...optimistic, pending: 'failed', deliveryError: error instanceof Error ? error.message : 'Could not send.' });
        throw error;
      } finally { inFlight.delete(key); observed.delete(key); }
    })();
    inFlight.set(key, task);
    return task;
  }
  return {
    send, observe,
    getSnapshot: () => messages,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
