import type { Session } from './types';
import { clearSavedReads, offlineAccount, offlineReadAction, savedRead, saveRead, updateSavedReads } from './offline';

const KEY='hays.messages.session.v1';
export const backendUrl=(import.meta.env.VITE_APPS_SCRIPT_URL as string|undefined)?.trim()||'';
export const configured=/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec$/.test(backendUrl);
export class ApiError extends Error { constructor(message:string,public code:string){super(message);} }
export function loadSession():Session|null {
  try {
    // Discard local preview data and sessions saved by earlier versions of the app.
    localStorage.removeItem('hays.messages.demo.v1');
    for (const key of Object.keys(sessionStorage)) {
      if (key.startsWith('hays.draft:you@hays.example:')) sessionStorage.removeItem(key);
    }
    const raw=localStorage.getItem(KEY);
    if(!raw)return null;
    const session=JSON.parse(raw) as Session & {demo?:unknown;backendUrl?:string};
    const expires=Date.parse(session.expiresAt);
    if(!configured||session.demo||session.token==='local-demo'||!session.token||!session.user?.email||!session.user?.name||!['admin','member'].includes(session.user.role)||!Number.isFinite(expires)||expires<=Date.now()||(session.backendUrl&&session.backendUrl!==backendUrl)) {
      localStorage.removeItem(KEY);
      return null;
    }
    return session;
  }catch{return null;}
}
export function storeSession(session:Session|null) { try {if(session)localStorage.setItem(KEY,JSON.stringify({...session,backendUrl}));else localStorage.removeItem(KEY);}catch{/* Session still works in memory when browser storage is disabled. */} }
export async function request<T>(action:string,payload:Record<string,unknown>={},session:Session|null=null,signal?:AbortSignal):Promise<T> {
  if(signal?.aborted)throw new DOMException('Request cancelled','AbortError');
  if(!configured)throw new ApiError('The messaging backend has not been connected yet.','not_configured');
  const account=session?offlineAccount(session.user.email,backendUrl):'';
  async function cached():Promise<T|null> {
    if(!account||!offlineReadAction(action))return null;
    const value=await savedRead<T>(account,action,payload);
    if(value!==null)window.dispatchEvent(new CustomEvent('hays:cached-read'));
    return value;
  }
  if(!navigator.onLine){
    const value=await cached();
    if(value!==null)return value;
    throw new ApiError(offlineReadAction(action)?'You are offline. This conversation has not been saved on this device.':'You are offline. Reconnect to complete this action. Your draft stays saved.','offline');
  }
  const controller=new AbortController();
  const abort=()=>controller.abort();
  signal?.addEventListener('abort',abort,{once:true});
  const timer=window.setTimeout(()=>controller.abort(),30000);
  try {
    const response=await fetch(backendUrl,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({...payload,action,sessionToken:session?.token}),signal:controller.signal,redirect:'follow'});
    let envelope:{ok:boolean;data:T;error?:string;code?:string};
    try{envelope=await response.json();}catch{throw new ApiError('The backend did not return JSON. Check the Apps Script web app deployment.','bad_response');}
    if(!envelope.ok)throw new ApiError(envelope.error||'The request failed.',envelope.code||'unknown');
    if(account){
      if(offlineReadAction(action)){await saveRead(account,action,payload,envelope.data);window.dispatchEvent(new CustomEvent('hays:connected-read'));}
      else if(action==='logout')await clearSavedReads(account);
      else await updateSavedReads(account,action,envelope.data);
    }
    return envelope.data;
  }catch(error){
    if(error instanceof ApiError)throw error;
    if(!signal?.aborted){const value=await cached();if(value!==null)return value;}
    throw new ApiError(error instanceof DOMException && error.name==='AbortError'?'The request timed out. Please try again.':'Could not connect. Check your connection and try again.','network_error');
  }finally{window.clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
