import { Bell, X } from 'lucide-react';
import type { IncomingNotice } from '../lib/messageAlerts';

export interface MessageToast extends IncomingNotice { key: number; title: string }

export function MessageToasts({ notices, onOpen, onDismiss }: { notices: MessageToast[]; onOpen: (notice: MessageToast) => void; onDismiss: (key: number) => void }) {
  if (!notices.length) return null;
  return <aside className="message-toasts" aria-label="Message alerts">{notices.map(notice => <div className="message-toast" role="status" aria-atomic="true" key={notice.key}>
    <Bell size={18} aria-hidden="true" />
    <div className="message-toast-content"><strong>{notice.message?.authorName || 'New message'}</strong><span>{notice.message?.parentId ? 'New reply in ' : 'In '}{notice.title}</span>
      <p>{notice.message?.body.slice(0, 180) || (notice.unread && notice.unread > 1 ? `${notice.unread} unread messages. Open the conversation to catch up.` : 'You have a new message. Open the conversation to read it.')}</p>
      <button className="text-button" onClick={() => onOpen(notice)}>Open conversation</button>
    </div><button className="icon-button" aria-label="Dismiss message alert" onClick={() => onDismiss(notice.key)}><X size={16} /></button>
  </div>)}</aside>;
}
