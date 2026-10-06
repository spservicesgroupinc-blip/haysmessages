import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { Check, ChevronDown, Loader2, MessageSquare, Pencil, Send, SmilePlus, Trash2, X } from 'lucide-react';
import type { Message, Person } from '../lib/types';
import { Modal } from './Modal';

export const EMOJI:Record<string,string>={thumbsup:'👍',heart:'❤️',check:'✅',eyes:'👀'};
export function Avatar({name,small=false}:{name:string;small?:boolean}) {
  const letters=name.split(/\s+/).slice(0,2).map(s=>s[0]).join('').toUpperCase();
  const hue=[...name].reduce((sum,c)=>sum+c.charCodeAt(0),0)%4;
  return <span className={`avatar color-${hue} ${small?'small':''}`} aria-hidden="true">{letters}</span>;
}
function readDraft(key:string):{body:string;id:string}|null {
  try {const draft=JSON.parse(sessionStorage.getItem(`hays.draft:${key}`)||'null');return typeof draft?.body==='string'&&typeof draft?.id==='string'?draft:null;}catch{return null;}
}
export function Composer({label,onSend,draftKey}:{label:string;draftKey:string;onSend:(body:string,clientId:string)=>Promise<void>}) {
  const inputId=useId();
  const [body,setBody]=useState(()=>readDraft(draftKey)?.body||'');
  const [sending,setSending]=useState(0);
  const [error,setError]=useState('');
  const retry=useRef<{body:string;id:string}|null>(readDraft(draftKey));
  function persist(text:string,id:string) {try{if(text)sessionStorage.setItem(`hays.draft:${draftKey}`,JSON.stringify({body:text,id}));else sessionStorage.removeItem(`hays.draft:${draftKey}`);}catch{/* Keep the in-memory draft when storage is unavailable. */}}
  async function send(event?:React.FormEvent){
    event?.preventDefault();
    const text=body.trim();if(!text)return;
    const messageId=retry.current?.body===text ? retry.current.id : crypto.randomUUID();retry.current=null;
    // Clear the input and show the message immediately; the draft stays saved
    // until the backend confirms so a failure can always be retried in place.
    setBody('');setError('');setSending(count=>count+1);persist(text,messageId);
    try{
      await onSend(text,messageId);
      if(readDraft(draftKey)?.id===messageId)persist('','');
    }catch(e){
      retry.current={body:text,id:messageId};
      setBody(current=>current.trim()?current:text);
      if(!readDraft(draftKey))persist(text,messageId);
      setError(e instanceof Error?e.message:'Could not send.');
    }finally{setSending(count=>count-1);}
  }
  return <form className="composer" onSubmit={send}>
    <label className="sr-only" htmlFor={inputId}>{label}</label>
    <textarea id={inputId} aria-label={label} placeholder={label} value={body} onChange={e=>{setBody(e.target.value);persist(e.target.value,retry.current?.body===e.target.value.trim()?retry.current.id:'');}} rows={2} maxLength={4000} onKeyDown={event=>{if(event.key==='Enter'&&!event.shiftKey&&!event.nativeEvent.isComposing && window.matchMedia('(pointer:fine)').matches){event.preventDefault();void send();}}}/>
    <div className="composer-bottom"><span>{sending&&!body.trim()?'Sending…':<><span className="desktop-hint">Enter to send · Shift + Enter for a new line</span><span className="mobile-hint">Keep the team in the loop</span></>}</span><button className="send-button" type="submit" disabled={!body.trim()} aria-label="Send message">{sending&&!body.trim()?<Loader2 className="spin" size={17}/>:<Send size={17}/>}</button></div>
    {error && <p className="error" role="alert">{error} Your message is still here; you can retry.</p>}
  </form>;
}

export function MessageCard({message,user,replyCount=0,onThread,onAction,threadView=false}:{message:Message;user:Person;replyCount?:number;threadView?:boolean;onThread:(id:string)=>void;onAction:(action:string,message:Message,value?:string)=>Promise<void>}) {
  const [reacting,setReacting]=useState(false);
  const [editing,setEditing]=useState(false);
  const [deleting,setDeleting]=useState(false);
  const [editText,setEditText]=useState(message.body);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  const mine=message.authorEmail===user.email;
  const pending=!!message.pending;
  const time=new Intl.DateTimeFormat(undefined,{hour:'numeric',minute:'2-digit'}).format(new Date(message.createdAt));
  async function action(name:string,value?:string) {
    setBusy(true);setError('');
    try{await onAction(name,message,value);setEditing(false);setDeleting(false);setReacting(false);}catch(e){setError(e instanceof Error?e.message:'Request failed.');}finally{setBusy(false);}
  }
  return <article className={`message ${message.deleted?'deleted':''}${pending?' pending':''}`} aria-busy={pending||undefined}>
    <Avatar name={message.authorName}/>
    <div className="message-content">
      <div className="message-meta"><strong>{message.authorName}</strong><time dateTime={message.createdAt} title={new Date(message.createdAt).toLocaleString()}>{time}</time>{pending?<span className="pending-note"><Loader2 className="spin" size={11}/> Sending…</span>:message.updatedAt && message.updatedAt!==message.createdAt && !message.deleted && <span className="edited">edited</span>}</div>
      {editing ? <form className="inline-edit" onSubmit={e=>{e.preventDefault();void action('editMessage',editText);}}><textarea value={editText} onChange={e=>setEditText(e.target.value)} maxLength={4000} required aria-label="Edit message" autoFocus/><div><button className="button primary compact" disabled={busy||!editText.trim()}><Check size={15}/> Save</button><button type="button" className="button compact" onClick={()=>setEditing(false)}>Cancel</button></div></form> : <p className="message-body">{message.deleted?'This message was removed.':message.body}</p>}
      {!message.deleted && !pending && <>
        <div className="reactions">{Object.entries(message.reactions).filter(([,people])=>people.length).map(([emoji,people])=><button disabled={busy} className={people.includes(user.email)?'reaction active':'reaction'} key={emoji} title={`${people.length} reaction${people.length===1?'':'s'}`} aria-label={`React ${emoji}, ${people.length}`} aria-pressed={people.includes(user.email)} onClick={()=>void action('react',emoji)}>{EMOJI[emoji]} <span>{people.length}</span></button>)}</div>
        <div className="message-actions">{!threadView && <button className="text-button" onClick={()=>onThread(message.parentId||message.id)}><MessageSquare size={13}/>{replyCount?`${replyCount} ${replyCount===1?'reply':'replies'}`:message.parentId?'View thread':'Reply'}</button>}<button className="text-button" disabled={busy} onClick={()=>setReacting(!reacting)} aria-label="Add reaction" aria-expanded={reacting}><SmilePlus size={14}/></button>{mine && <button className="text-button" disabled={busy} aria-label="Edit message" onClick={()=>{setEditing(true);setEditText(message.body);}}><Pencil size={13}/></button>}{(mine||user.role==='admin') && <button className="text-button" disabled={busy} aria-label="Delete message" onClick={()=>setDeleting(true)}><Trash2 size={13}/></button>}</div>
        {reacting && <div className="reaction-picker">{Object.entries(EMOJI).map(([key,emoji])=><button disabled={busy} key={key} aria-label={`React ${key}`} onClick={()=>void action('react',key)}>{emoji}</button>)}<button aria-label="Close reactions" onClick={()=>setReacting(false)}><X size={14}/></button></div>}
      </>}
      {message.deleted && replyCount>0 && !threadView && <button className="text-button" onClick={()=>onThread(message.id)}><MessageSquare size={13}/>{replyCount} {replyCount===1?'reply':'replies'}</button>}
      {error && <p className="error" role="alert">{error}</p>}
    </div>
    {deleting && <Modal title="Remove this message?" onClose={()=>setDeleting(false)}><p className="muted">This removes the message for everyone in the conversation. Thread replies remain available.</p><div className="modal-actions"><button className="button" onClick={()=>setDeleting(false)}>Cancel</button><button className="button primary" disabled={busy} onClick={()=>void action('deleteMessage')}>{busy?'Removing…':'Remove message'}</button></div></Modal>}
  </article>;
}

export function MessageList({messages,user,onThread,onAction,query,hasMore,onOlder,loading}:{messages:Message[];user:Person;onThread:(id:string)=>void;onAction:(action:string,message:Message,value?:string)=>Promise<void>;query?:string;hasMore?:boolean;onOlder?:()=>void;loading?:boolean}) {
  const container=useRef<HTMLDivElement>(null);
  const atBottom=useRef(true);
  const lastId=messages.at(-1)?.id;
  const anchor=useRef<{height:number;top:number}|null>(null);
  useLayoutEffect(()=>{if(anchor.current && container.current){container.current.scrollTop=anchor.current.top+container.current.scrollHeight-anchor.current.height;anchor.current=null;}},[messages]);
  useEffect(()=>{if(atBottom.current&&!query)container.current?.scrollTo({top:container.current.scrollHeight});},[lastId,query]);
  const visible=query?messages:messages.filter(m=>!m.parentId);
  const replyCounts=new Map<string,number>();
  for(const message of messages)if(message.parentId&&!message.deleted)replyCounts.set(message.parentId,(replyCounts.get(message.parentId)||0)+1);
  let date='';
  return <div ref={container} className="message-list" onScroll={()=>{const e=container.current;if(e)atBottom.current=e.scrollHeight-e.scrollTop-e.clientHeight<120;}}>
    {hasMore && onOlder && <button className="older-button" onClick={()=>{if(container.current){anchor.current={height:container.current.scrollHeight,top:container.current.scrollTop};atBottom.current=false;}onOlder();}} disabled={loading}>{loading?<Loader2 size={14} className="spin"/>:<ChevronDown size={14}/>} Load earlier messages</button>}
    {loading && !messages.length ? <div className="chat-empty"><Loader2 className="spin" size={22}/><p>Loading conversation…</p></div> : !visible.length ? <div className="chat-empty"><span className="brand-icon"><MessageSquare size={24}/></span><h3>{query?'No matching messages':'Start the conversation'}</h3><p>{query?'Try another word or phrase.':'Share an update, ask a question, or say hello to the team.'}</p></div> : visible.map(message=>{
      const currentDate=new Date(message.createdAt).toLocaleDateString(undefined,{weekday:'long',month:'long',day:'numeric'});
      const divider=currentDate!==date;date=currentDate;
      return <div key={message.id}>{divider && <div className="date-divider"><span>{currentDate}</span></div>}<MessageCard message={message} user={user} replyCount={replyCounts.get(message.id)||0} onThread={onThread} onAction={onAction}/></div>;
    })}
  </div>;
}
