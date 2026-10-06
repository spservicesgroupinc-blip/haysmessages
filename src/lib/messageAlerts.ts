import type { Conversation, Message } from './types';

// Keep alert detection separate from rendering and read-receipt updates.
// Initial history, our own sends, edits, and repeated polls must stay quiet.
export function createMessageAlerts(email: string, alert: () => void) {
  let initialized = false;
  const activity = new Map<string, string>();
  const unread = new Map<string, number>();
  const pages = new Set<string>();
  const started = new Date().toISOString();
  return {
    bootstrap(conversations: Conversation[]) {
      let incoming = false;
      for (const c of conversations) {
        const previous = activity.get(c.id) || started;
        if (initialized && c.lastActivity > previous && c.unread > (unread.get(c.id) || 0)) incoming = true;
        activity.set(c.id, c.lastActivity > previous || !activity.has(c.id) ? c.lastActivity : previous);
        unread.set(c.id, c.unread);
      }
      initialized = true;
      if (incoming) alert();
    },
    messages(conversationId: string, messages: Message[], pageKey: string) {
      const previous = activity.get(conversationId);
      const first = !pages.has(pageKey);
      pages.add(pageKey);
      // A bootstrap snapshot supplies the initial baseline, including replies.
      // Otherwise the first fetched page establishes history without alerting.
      const incoming = messages.some(m => !m.deleted && m.authorEmail !== email && m.createdAt > (previous || '') && (!first || previous !== undefined));
      const latest = messages.reduce((value, m) => m.createdAt > value ? m.createdAt : value, previous || '');
      activity.set(conversationId, latest);
      if (incoming) alert();
    },
    read(conversationId: string) { unread.set(conversationId, 0); },
  };
}
