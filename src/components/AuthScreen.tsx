import { useEffect, useState } from 'react';
import { ArrowRight, Loader2, MessageSquare, ShieldCheck } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { DeviceControls } from './DeviceControls';
import { configured, request } from '../lib/api';
import { demoSession } from '../lib/demo';
import type { RegistrationInfo, Session } from '../lib/types';

export function AuthScreen({onSession,notice}:{onSession:(session:Session)=>void;notice?:string}) {
  const [register,setRegister]=useState(false);
  const [info,setInfo]=useState<RegistrationInfo|null>(null);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState('');
  useEffect(()=>{if(configured)void request<RegistrationInfo>('registrationInfo').then(setInfo).catch(e=>setError(e.message));},[]);
  async function submit(event:React.FormEvent<HTMLFormElement>) {
    event.preventDefault();setBusy(true);setError('');
    const form=new FormData(event.currentTarget);
    try {onSession(await request<Session>(register?'register':'login',Object.fromEntries(form.entries())));}catch(e){setError(e instanceof Error?e.message:'Sign-in failed.');}finally{setBusy(false);}
  }
  return <div className="auth-page">
    <div className="auth-card">
      <BrandLogo size={42} sublabel="Team Messaging" />
      <div className="auth-heading"><span className="brand-icon"><MessageSquare size={22}/></span><h1>A place for your team.</h1><p>Keep sales, project managers, and the office connected. One conversation at a time.</p></div>
      {notice && <p className="notice" role="status">{notice}</p>}
      {!configured && <p className="notice">The messaging backend is ready to connect. Explore the demo while your Apps Script deployment is being set up.</p>}
      {configured && <>
        <div className="auth-tabs"><button className={!register?'selected':''} onClick={()=>{setRegister(false);setError('');}}>Sign in</button>{info?.enabled && <button className={register?'selected':''} onClick={()=>{setRegister(true);setError('');}}>Create account</button>}</div>
        <form onSubmit={submit} className="form-stack">
          {register && <label>Your name<input name="name" autoComplete="name" required maxLength={80}/></label>}
          <label>Company email<input name="email" type="email" autoComplete="username" required maxLength={254}/></label>
          <label>Password<input name="password" type="password" autoComplete={register?'new-password':'current-password'} required minLength={register?(info?.minPasswordLength||10):undefined} maxLength={256}/></label>
          {register && info?.requiresInvite && <label>Company invite code<input name="inviteCode" required autoComplete="off"/><span className="field-hint">Ask your administrator for the team invite code.</span></label>}
          {error && <p className="error" role="alert">{error}</p>}
          <button className="button primary" disabled={busy}>{busy?<Loader2 className="spin" size={17}/>:<ArrowRight size={17}/>} {register?'Create account':'Sign in'}</button>
        </form>
      </>}
      <button className="button demo-button" onClick={()=>onSession(demoSession())}>Explore demo workspace <ArrowRight size={16}/></button>
      <DeviceControls />
      <p className="auth-foot"><ShieldCheck size={14}/> Company conversations, in one workspace.</p>
    </div>
    <p className="auth-company">Hays &amp; Sons Complete Restoration</p>
  </div>;
}
