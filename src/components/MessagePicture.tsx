import { useEffect, useRef, useState } from 'react';
import { Download, ImageIcon, Loader2 } from 'lucide-react';
import type { Message } from '../lib/types';
import { pictureDataUrl } from '../lib/pictures';
import { useDelivery } from './MessageDelivery';
import { Modal } from './Modal';

export function MessagePicture({ message }: { message: Message }) {
  const { loadPicture } = useDelivery();
  const container = useRef<HTMLDivElement>(null);
  const [loaded, setLoaded] = useState('');
  const [error, setError] = useState('');
  const [attempt, setAttempt] = useState(0);
  const [open, setOpen] = useState(false);
  const source = message.localPicture || loaded;
  const name = message.attachment?.name || 'Picture';
  useEffect(() => {
    if (message.localPicture || !message.attachment || message.pending) return;
    let stopped = false;
    const controller = new AbortController();
    setError('');
    async function load() {
      try {
        const picture = await loadPicture(message.id, controller.signal);
        const url = pictureDataUrl(picture);
        if (!stopped) setLoaded(url);
      } catch (e) { if (!stopped) setError(e instanceof Error ? e.message : 'Could not load picture.'); }
    }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { observer.disconnect(); void load(); }
    }, { rootMargin: '200px' });
    if (container.current) observer.observe(container.current);
    return () => { stopped = true; observer.disconnect(); controller.abort(); };
  }, [message.id, message.attachment?.id, message.localPicture, message.pending, attempt, loadPicture]);
  return <div className="message-picture" ref={container}>
    {source && !error ? <button type="button" className="picture-open" aria-label={`Open picture: ${name}`} onClick={() => setOpen(true)}>
      <img src={source} alt={name} onError={() => setError('This picture could not be displayed.')} />
    </button> : <div className="picture-placeholder">{error ? <><ImageIcon size={22} /><span>{error}</span><button type="button" className="text-button" onClick={() => { setLoaded(''); setError(''); setAttempt(n => n + 1); }}>Retry picture</button></> : <><Loader2 className="spin" size={20} /><span>Loading picture…</span></>}</div>}
    {open && source && <Modal title="Picture" onClose={() => setOpen(false)}><img className="picture-full" src={source} alt={name} /><div className="modal-actions"><a className="button" href={source} download={name}><Download size={16} /> Save picture</a></div></Modal>}
  </div>;
}
