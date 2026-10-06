import { useEffect, useState } from 'react';
import { ArrowRight, Eye, EyeOff, Loader2, MessageSquare, ShieldCheck, UserPlus } from 'lucide-react';
import { BrandLogo } from './BrandLogo';
import { DeviceControls } from './DeviceControls';
import { configured, request } from '../lib/api';
import type { RegistrationInfo, Session } from '../lib/types';

export function AuthScreen({ onSession, notice }: { onSession: (session: Session) => void; notice?: string }) {
  const [register, setRegister] = useState(false);
  const [info, setInfo] = useState<RegistrationInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  useEffect(() => {
    if (!configured) return;
    const controller = new AbortController();
    // Account creation availability must not prevent existing accounts from signing in.
    void request<RegistrationInfo>('registrationInfo', {}, null, controller.signal)
      .then(setInfo).catch(() => {});
    return () => controller.abort();
  }, []);
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !configured) return;
    setBusy(true); setError('');
    const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries(form.entries());
    payload.email = String(payload.email).trim().toLowerCase();
    try {
      const session = await request<Session>(register ? 'register' : 'login', payload);
      if (!session?.token || !session.user?.email || !session.user.name ||
          !['admin', 'member'].includes(session.user.role) ||
          !Number.isFinite(Date.parse(session.expiresAt)) || Date.parse(session.expiresAt) <= Date.now()) {
        throw new Error('Sign-in could not be completed. Please try again.');
      }
      onSession(session);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Sign-in failed. Please try again.');
    } finally { setBusy(false); }
  }
  return <div className="auth-page">
    <div className="auth-card">
      <BrandLogo size={42} sublabel="Team Messaging" />
      <div className="auth-heading"><span className="brand-icon"><MessageSquare size={22} /></span><h1>{register ? 'Join your team.' : 'Sign in to your workspace.'}</h1><p>{register ? 'Create your company account to start working with your team.' : 'Keep your team connected. Sign in with your company account to get started.'}</p></div>
      {notice && <p className="notice" role="status">{notice}</p>}
      {!configured && <p className="notice" role="alert">Sign-in is not available yet. Contact your administrator to connect the company workspace.</p>}
      <form onSubmit={submit} className="form-stack" aria-label={register ? 'Create company account' : 'Company sign in'}>
        <fieldset disabled={busy || !configured} className="auth-fields">
          {register && <label>Your name<input name="name" autoComplete="name" required maxLength={80} /></label>}
          <label>Username<input name="email" type="email" aria-label="Username" autoComplete="username" autoCapitalize="none" spellCheck={false} required maxLength={254} aria-describedby="username-hint" /><span id="username-hint" className="field-hint">Use your company email address.</span></label>
          <label>Password<span className="password-field">
            <input name="password" type={showPassword ? 'text' : 'password'} aria-label="Password" autoComplete={register ? 'new-password' : 'current-password'} required minLength={register ? (info?.minPasswordLength || 10) : undefined} maxLength={256} />
            <button type="button" className="icon-button password-toggle" aria-label={showPassword ? 'Hide password' : 'Show password'} aria-pressed={showPassword} onClick={() => setShowPassword(value => !value)}>{showPassword ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </span>{register && <span className="field-hint">Use at least {info?.minPasswordLength || 10} characters.</span>}</label>
          {register && info?.requiresInvite !== false && <label>Company invite code<input name="inviteCode" aria-label="Company invite code" required={info?.requiresInvite === true} autoComplete="off" maxLength={256} /><span className="field-hint">{info?.requiresInvite ? 'Ask your administrator for the team invite code.' : 'Enter your company invite code if you were given one.'}</span></label>}
        </fieldset>
        {error && <p className="error" role="alert">{error}</p>}
        <button className="button primary" type="submit" disabled={busy || !configured}>{busy ? <Loader2 className="spin" size={17} /> : <ArrowRight size={17} />} {busy ? (register ? 'Creating account…' : 'Signing in…') : (register ? 'Create account' : 'Sign in')}</button>
      </form>
      <div className="auth-switch">
        <p>{register ? 'Already have an account?' : 'New to the team?'}</p>
        <button type="button" className="button" disabled={busy} onClick={() => { setRegister(value => !value); setError(''); setShowPassword(false); }}>
          {register ? <ArrowRight size={17} /> : <UserPlus size={17} />} {register ? 'Back to sign in' : 'Create account'}
        </button>
      </div>
      {!register && <p className="auth-help">Forgot your password? Contact your administrator.</p>}
      <DeviceControls />
      <p className="auth-foot"><ShieldCheck size={14} /> Your company account. Your team workspace.</p>
    </div>
    <p className="auth-company">Hays &amp; Sons Complete Restoration</p>
  </div>;
}
