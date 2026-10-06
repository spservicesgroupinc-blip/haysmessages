import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Modal({title,onClose,children}:{title:string;onClose:()=>void;children:React.ReactNode}) {
  const ref=useRef<HTMLDivElement>(null);
  const closeRef=useRef(onClose);closeRef.current=onClose;
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    ref.current?.querySelector<HTMLElement>('input,button')?.focus();
    return ()=>{document.body.style.overflow=overflow;previous?.focus();};
  },[]);
  return createPortal(<div className="modal-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)onClose();}}>
    <div ref={ref} className="modal-card" role="dialog" aria-modal="true" aria-label={title} onKeyDown={event=>{
      if(event.key==='Escape')closeRef.current();
      if(event.key==='Tab'){
        const controls=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select,textarea,a[href]')||[]);
        const first=controls[0],last=controls.at(-1);
        if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
      }
    }}>
      <div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" onClick={onClose}><X size={20}/></button></div>
      {children}
    </div>
  </div>,document.body);
}
