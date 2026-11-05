import { useState } from 'react';
import { Loader2, LogOut, Trash2 } from 'lucide-react';
import { ApiError } from '../lib/api';
import type { Conversation, Person } from '../lib/types';
import type { ApiCall } from '../lib/useMessages';
import { Avatar } from './Chat';
import { Modal } from './Modal';

export function ConversationDetails({ conversation, title, members, user, api, onClose, onRemoved }: {
  conversation: Conversation; title: string; members: Person[]; user: Person; api: ApiCall;
  onClose: () => void; onRemoved: (id: string) => void;
}) {
  const [confirm, setConfirm] = useState<'delete' | 'leave' | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const canDelete = conversation.kind !== 'dm' && (conversation.createdBy === user.email || user.role === 'admin');
  async function remove() {
    if (busy || !confirm) return;
    setBusy(true); setError('');
    try {
      await api(confirm === 'delete' ? 'deleteConversation' : 'leaveConversation', { conversationId: conversation.id });
      onRemoved(conversation.id);
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'unknown_action'
        ? 'This workspace needs a backend update to manage chat spaces. Contact your administrator.'
        : e instanceof Error ? e.message : 'Could not update this chat space. Please try again.');
    } finally { setBusy(false); }
  }
  return <Modal title={confirm === 'delete' ? 'Delete chat space?' : confirm === 'leave' ? 'Leave group?' : title} onClose={onClose} busy={busy}>
    {confirm ? <>
      <p className="muted">{confirm === 'delete'
        ? <>Delete <strong>{conversation.kind === 'channel' ? '#' : ''}{title}</strong> for everyone? This removes the space and its messages from the workspace.</>
        : <>Leave <strong>{title}</strong>? You will lose access to this group. The conversation will remain available to its other members.</>}</p>
      {error && <p className="error space-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="button" disabled={busy} onClick={() => { setConfirm(null); setError(''); }}>Cancel</button><button className="button primary" disabled={busy} onClick={() => void remove()}>{busy && <Loader2 size={16} className="spin" />}{busy ? 'Updating…' : confirm === 'delete' ? 'Delete for everyone' : 'Leave this group'}</button></div>
    </> : <>
      <p className="muted">{conversation.description || 'A space to keep the team connected.'}</p>
      <h3 className="members-heading">{members.length} {members.length === 1 ? 'teammate' : 'teammates'}</h3>
      <div className="member-list">{members.map(person => <div className="member" key={person.email}><Avatar small name={person.name} /><div><strong>{person.name}{person.email === user.email ? ' (you)' : ''}</strong><span>{person.email}</span></div></div>)}</div>
      {conversation.kind !== 'dm' && <div className="space-management">
        <h3>Manage chat space</h3>
        {conversation.kind === 'group' && <button className="button" onClick={() => setConfirm('leave')}><LogOut size={16} /> Leave group</button>}
        {canDelete ? <button className="button danger" onClick={() => setConfirm('delete')}><Trash2 size={16} /> Delete chat space</button> : <p className="muted">Only the creator or an administrator can delete this chat space.</p>}
      </div>}
    </>}
  </Modal>;
}
