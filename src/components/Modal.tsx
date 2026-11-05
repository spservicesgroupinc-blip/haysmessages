import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';

export function Modal({title,onClose,children,busy=false}:{title:string;onClose:()=>void;children:React.ReactNode;busy?:boolean}) {
  const ref=useRef<HTMLDivElement>(null);
  const closeRef=useRef(onClose);closeRef.current=()=>{if(!busy)onClose();};
  useEffect(()=>{
    const previous=document.activeElement as HTMLElement|null;
    const overflow=document.body.style.overflow;document.body.style.overflow='hidden';
    ref.current?.querySelector<HTMLElement>('input,button')?.focus();
    return ()=>{document.body.style.overflow=overflow;previous?.focus();};
  },[title]);
  useEffect(()=>{if(busy)ref.current?.focus();},[busy]);
  return createPortal(<div className="modal-overlay" onMouseDown={event=>{if(event.target===event.currentTarget)closeRef.current();}}>
    <div ref={ref} className="modal-card" role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} onKeyDown={event=>{
      if(event.key==='Escape')closeRef.current();
      if(event.key==='Tab'){
        const controls=Array.from(ref.current?.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled),select:not(:disabled),textarea:not(:disabled),a[href]')||[]);
        const first=controls[0],last=controls.at(-1);
        if(!first){event.preventDefault();ref.current?.focus();}
        else if(event.shiftKey && document.activeElement===first){event.preventDefault();last?.focus();}
        else if(!event.shiftKey && document.activeElement===last){event.preventDefault();first?.focus();}
      }
    }}>
      <div className="modal-heading"><h2>{title}</h2><button className="icon-button" aria-label="Close dialog" disabled={busy} onClick={onClose}><X size={20}/></button></div>
      {children}
    </div>
  </div>,document.body);
}
