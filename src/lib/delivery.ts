import type { Message, Person, PreparedPicture, PictureAttachment } from './types';

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

type SendApi = <T>(action: string, payload?: Record<string, unknown>, signal?: AbortSignal) => Promise<T>;

// One instance per signed-in workspace. Requests keep running when a chat or
// thread closes; pending messages remain available to every view of that space.
export function createDelivery(api: SendApi, user: Person, onDelivered: (message: Message) => void = () => {}) {
  let messages: Message[] = [];
  const listeners = new Set<() => void>();
  const inFlight = new Map<string, Promise<Message>>();
  const pictures = new Map<string, { picture: PreparedPicture; uploaded?: PictureAttachment }>();
  const drafts = new Map<string, PreparedPicture>();
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
      pictures.delete(key);
      const existing = messages.find(m => identity(m) === key);
      if (existing) {
        messages = messages.filter(m => identity(m) !== key);
        changed = true;
        if (existing.pending) onDelivered(message);
      }
    }
    if (changed) listeners.forEach(listener => listener());
  }
  function send(conversationId: string, body: string, clientId: string, parentId = '', picture?: PreparedPicture): Promise<Message> {
    const optimistic: Message = { id: `pending:${clientId}`, conversationId, authorEmail: user.email, authorName: user.name, body, createdAt: new Date().toISOString(), updatedAt: '', deleted: false, parentId, reactions: {}, clientId, pending: 'sending' };
    const key = identity(optimistic);
    const running = inFlight.get(key);
    if (running) return running;
    const existing = messages.find(m => identity(m) === key);
    if (existing && !existing.pending) return Promise.resolve(existing);
    if (existing) optimistic.createdAt = existing.createdAt;
    if (picture && !pictures.has(key)) pictures.set(key, { picture });
    const job = pictures.get(key);
    if (job) { optimistic.localPicture = job.picture.preview; optimistic.deliveryStage = job.uploaded ? 'sending' : 'uploading'; }
    publish(optimistic);
    const task = (async () => {
      try {
        if (job && !job.uploaded) {
          let config: { privateStorage: boolean; maxBytes: number };
          try { config = await api('pictureConfig'); }
          catch (error) {
            if (/unknown action/i.test(error instanceof Error ? error.message : '') || (error as {code?:string}).code === 'unknown_action') throw new Error('The Apps Script needs an update before pictures can be sent. Ask the workspace owner to publish version 8.4 or later.');
            throw error;
          }
          if (config.privateStorage !== true) throw new Error('The Apps Script needs an update for private picture uploads.');
          if (job.picture.size > config.maxBytes) throw new Error('This picture is too large for the workspace.');
          const { preview: _preview, name, ...data } = job.picture;
          job.uploaded = await api<PictureAttachment>('uploadAttachment', { conversationId, parentId, clientId, fileName: name, ...data });
          optimistic.attachment = job.uploaded; optimistic.deliveryStage = 'sending'; publish({ ...optimistic });
        }
        const result = await api<Message>('sendMessage', { conversationId, parentId, body, clientId, ...(job ? { attachmentId: job.uploaded!.id } : {}) });
        if (job) { result.localPicture = job.picture.preview; pictures.delete(key); }
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
    retry: (message: Message) => send(message.conversationId, message.body, message.clientId, message.parentId),
    getPictureDraft: (key: string) => drafts.get(key),
    setPictureDraft: (key: string, picture?: PreparedPicture) => { if (picture) drafts.set(key, picture); else drafts.delete(key); },
    loadPicture: (messageId: string, signal: AbortSignal) => api<{name:string;mimeType:string;size:number;base64:string}>('getAttachment', { messageId }, signal),
    getSnapshot: () => messages,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
}
