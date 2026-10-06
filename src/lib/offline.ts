// Only application reads are saved. Session tokens and write requests never enter this database.
import type { Bootstrap, Conversation, Message } from './types';
const DB = 'hays-offline-v1';
const STORE = 'reads';
const MAX_READS = 100;
const READS = new Set(['bootstrap', 'listMessages', 'getThread']);
interface CachedRead { key: string; account: string; action: string; payload: Record<string, unknown>; data: unknown; savedAt: number }
function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) { reject(new Error('Offline storage is unavailable.')); return; }
    const request = indexedDB.open(DB, 1);
    request.onupgradeneeded = () => { const store = request.result.createObjectStore(STORE, { keyPath: 'key' }); store.createIndex('account', 'account'); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
const keyFor = (account: string, action: string, payload: Record<string, unknown>) => JSON.stringify([account, action, payload.conversationId || '', payload.parentId || '', payload.query || '', payload.beforeId || '', payload.before || '', payload.limit || '']);
export const offlineReadAction = (action: string) => READS.has(action);
export async function savedRead<T>(account: string, action: string, payload: Record<string, unknown>): Promise<T | null> {
  if (!READS.has(action)) return null;
  let db: IDBDatabase | undefined;
  try {
    db = await open();
    return await new Promise<T | null>((resolve, reject) => {
      const request = db!.transaction(STORE).objectStore(STORE).get(keyFor(account, action, payload));
      request.onsuccess = () => resolve(request.result?.data ?? null);
      request.onerror = () => reject(request.error);
    });
  } catch { return null; }
  finally { db?.close(); }
}
export async function saveRead(account: string, action: string, payload: Record<string, unknown>, data: unknown) {
  if (!READS.has(action)) return;
  let db: IDBDatabase | undefined;
  try {
    db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readwrite'); const store = tx.objectStore(STORE);
      store.put({ key: keyFor(account, action, payload), account, action, payload, data, savedAt: Date.now() } satisfies CachedRead);
      const rows = store.index('account').getAll(account);
      rows.onsuccess = () => (rows.result as CachedRead[]).sort((a, b) => b.savedAt - a.savedAt).slice(MAX_READS).forEach(row => store.delete(row.key));
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  } catch { /* Storage failure must not prevent a connected workspace from working. */ }
  finally { db?.close(); }
}
export async function clearSavedReads(account: string) {
  let db: IDBDatabase | undefined;
  try {
    db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readwrite'); const store = tx.objectStore(STORE);
      const keys = store.index('account').getAllKeys(account);
      keys.onsuccess = () => keys.result.forEach(key => store.delete(key));
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  } catch { /* Ignore unavailable browser storage. */ }
  finally { db?.close(); }
}
export function offlineAccount(email: string, backend: string) { return `${backend}|${email}`; }
export async function updateSavedReads(account: string, action: string, data: unknown) {
  if (!['sendMessage', 'editMessage', 'deleteMessage', 'react', 'createConversation'].includes(action)) return;
  let db: IDBDatabase | undefined;
  try {
    db = await open();
    await new Promise<void>((resolve, reject) => {
      const tx = db!.transaction(STORE, 'readwrite'); const store = tx.objectStore(STORE);
      const reads = store.index('account').getAll(account);
      reads.onsuccess = () => {
        for (const row of reads.result as CachedRead[]) {
          if (action === 'createConversation') {
            if (row.action !== 'bootstrap') continue;
            const bootstrap = row.data as Bootstrap; const conversation = data as Conversation;
            row.data = { ...bootstrap, conversations: [...bootstrap.conversations.filter(c => c.id !== conversation.id), conversation] };
          } else {
            const message = data as Message;
            if (row.action === 'bootstrap') {
              const bootstrap = row.data as Bootstrap;
              row.data = { ...bootstrap, conversations: bootstrap.conversations.map(c => c.id === message.conversationId ? { ...c, lastActivity: message.createdAt > c.lastActivity ? message.createdAt : c.lastActivity } : c) };
            } else {
              if (row.payload.conversationId !== message.conversationId) continue;
              const page = row.data as { messages: Message[]; readThrough?: string };
              const query = String(row.payload.query || '').toLowerCase();
              const present = page.messages.some(m => m.id === message.id);
              const canAdd = action === 'sendMessage' && (row.action === 'getThread' ? row.payload.parentId === message.parentId : !row.payload.before && !row.payload.beforeId && (!message.parentId || page.messages.some(m => m.id === message.parentId)));
              const matches = !query || (!message.deleted && message.body.toLowerCase().includes(query));
              if (!present && !canAdd) continue;
              page.messages = page.messages.filter(m => m.id !== message.id);
              if (matches) page.messages.push(message);
              page.messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
              if (action === 'sendMessage') page.readThrough = message.createdAt;
            }
          }
          row.savedAt = Date.now(); store.put(row);
        }
      };
      tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error);
    });
  } catch { /* Sending a message never depends on offline storage availability. */ }
  finally { db?.close(); }
}
