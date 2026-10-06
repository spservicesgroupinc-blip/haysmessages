import { useEffect, useState } from 'react';
import { Bell, BellOff, Download, Loader2, RefreshCw, WifiOff } from 'lucide-react';
import { Modal } from './Modal';
import { ApiError, request } from '../lib/api';
import type { Session } from '../lib/types';
import { applyPwaUpdate, getPwaState, getServiceWorkerRegistration, installApp, subscribePwa } from '../lib/pwa';

function usePwa() {
  const [state, setState] = useState(getPwaState);
  useEffect(() => subscribePwa(() => setState(getPwaState())), []);
  return state;
}
interface PushConfig { enabled: boolean; publicKey?: string; reason?: string }
interface PushStatus extends PushConfig { subscribed: boolean }
function applicationKey(value: string) {
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, char => char.charCodeAt(0));
}
const message = (e: unknown) => e instanceof Error ? e.message : 'Please try again.';

export function DeviceControls({ session }: { session?: Session }) {
  const pwa = usePwa();
  const [dialog, setDialog] = useState<'install' | 'notifications' | null>(null);
  const [config, setConfig] = useState<PushConfig | null>(null);
  const [registration, setRegistration] = useState<ServiceWorkerRegistration | null>(null);
  const [subscription, setSubscription] = useState<PushSubscription | null>(null);
  const [subscribed, setSubscribed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [refresh, setRefresh] = useState(0);
  const supported = typeof Notification !== 'undefined' && 'PushManager' in window && 'serviceWorker' in navigator && window.isSecureContext;
  const needsHomeScreen = pwa.isIOS && !pwa.standalone;
  useEffect(() => {
    if (dialog !== 'notifications' || !session || session.demo || needsHomeScreen || !supported) return;
    let cancelled = false;
    setBusy(true); setError(''); setConfig(null);
    async function load() {
      try {
        const next = await request<PushConfig>('pushConfig', {}, session!);
        if (cancelled) return;
        setConfig(next);
        if (!next.enabled) return;
        const reg = await getServiceWorkerRegistration();
        const existing = await reg.pushManager.getSubscription();
        const status = existing ? await request<PushStatus>('pushStatus', { endpoint: existing.endpoint }, session!) : null;
        if (!cancelled) { setRegistration(reg); setSubscription(existing); setSubscribed(!!status?.subscribed); }
      } catch (e) {
        if (cancelled) return;
        if (e instanceof ApiError && e.code === 'unknown_action') setConfig({ enabled: false });
        else setError(message(e));
      } finally { if (!cancelled) setBusy(false); }
    }
    void load();
    return () => { cancelled = true; };
  }, [dialog, session, needsHomeScreen, supported, refresh]);
  async function install() {
    setError('');
    if (!pwa.canInstall) { setDialog('install'); return; }
    try { await installApp(); } catch (e) { setError(message(e)); setDialog('install'); }
  }
  async function enable() {
    if (!registration || !config?.publicKey || !session || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      // subscribe is invoked directly by the user's click so Safari can present its permission prompt.
      const active = subscription || await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(config.publicKey) });
      setSubscription(active);
      await request('subscribePush', { subscription: active.toJSON() }, session);
      setSubscribed(true); setNotice('Notifications are enabled on this device while you are signed in.');
    } catch (e) { setError(Notification.permission === 'denied' ? 'Notifications are blocked. Allow them in your browser or device settings, then try again.' : message(e)); }
    finally { setBusy(false); }
  }
  async function disable() {
    if (!subscription || !session || busy) return;
    setBusy(true); setError(''); setNotice('');
    try {
      await request('unsubscribePush', { endpoint: subscription.endpoint }, session);
      setSubscribed(false);
      await subscription.unsubscribe(); setSubscription(null);
      setNotice('Notifications are turned off on this device.');
    } catch (e) { setError(message(e)); }
    finally { setBusy(false); }
  }
  return <>
    <div className={`device-controls ${session ? 'in-workspace' : 'on-auth'}`}>
      {!pwa.standalone && <button className="device-button" onClick={() => void install()}><Download size={16} /> Install app</button>}
      {session && <button className="device-button" onClick={() => { setError(''); setNotice(''); setDialog('notifications'); }}><Bell size={16} /> Notifications</button>}
    </div>
    {dialog === 'install' && <Modal title="Install Hays Messages" onClose={() => setDialog(null)}>
      <p className="muted">Keep your team workspace on your home screen or desktop. It opens in its own window and saves loaded messages for offline access.</p>
      {pwa.isIOS ? <ol className="install-steps"><li>Open the published app in Safari.</li><li>Tap Share, then Add to Home Screen. It may be under More.</li><li>Tap Add, then open Hays Messages from your home screen.</li></ol> : <ol className="install-steps"><li>Open the published app in Chrome or Edge.</li><li>Choose Install app in the address bar or browser menu.</li><li>Open Hays Messages from your desktop or home screen.</li></ol>}
      {pwa.isIOS && <p className="notice">On iPhone and iPad, notifications require iOS/iPadOS 16.4 or later and opening the app from your home screen.</p>}
      {pwa.registrationError && <p className="notice">{pwa.registrationError}</p>}
      {error && <p className="error" role="alert">{error}</p>}
      <div className="modal-actions">{pwa.canInstall && <button className="button primary" onClick={() => void install()}><Download size={16} /> Install app</button>}<button className="button" onClick={() => setDialog(null)}>Done</button></div>
    </Modal>}
    {dialog === 'notifications' && <Modal title="Notifications on this device" onClose={() => setDialog(null)}>
      <p className="muted">Get a background alert for new team messages, even when the app is closed. Alerts keep message contents private. Device settings may affect when they arrive.</p>
      {session?.demo ? <p className="notice">Demo conversations stay in this browser. Sign in to your company workspace to use push notifications.</p> : needsHomeScreen ? <><p className="notice">Add this app to your home screen and open it there to enable notifications on iPhone or iPad.</p><button className="button" onClick={() => setDialog('install')}><Download size={16} /> Installation instructions</button></> : !supported ? <p className="notice">Push notifications need a supported browser and a secure app address. Try the installed app in a current version of Chrome, Edge, Firefox, or Safari.</p> : <>
        {busy && !config && <p className="notification-status"><Loader2 size={18} className="spin" /> Checking notification settings…</p>}
        {config && !config.enabled && <p className="notice">Push notifications have not been enabled for this workspace yet. Your administrator needs to finish the notification service setup.</p>}
        {config?.enabled && <div className="notification-status">{subscribed ? <><Bell size={19} /> Enabled on this device</> : <><BellOff size={19} /> Notifications are off</>}</div>}
        {config?.enabled && registration && <div className="modal-actions"><button className="button primary" disabled={busy || (!subscribed && Notification.permission === 'denied')} onClick={() => void (subscribed ? disable() : enable())}>{busy ? <Loader2 size={16} className="spin" /> : subscribed ? <BellOff size={16} /> : <Bell size={16} />}{subscribed ? 'Turn off notifications' : 'Enable notifications'}</button></div>}
        {supported && Notification.permission === 'denied' && <p className="notice">Your browser has blocked notifications. Change the permission in its settings to enable them.</p>}
      </>}
      {notice && <p className="notice" role="status">{notice}</p>}
      {error && <p className="error" role="alert">{error} <button className="text-button" onClick={() => setRefresh(n => n + 1)}>Retry</button></p>}
    </Modal>}
  </>;
}

export function PwaStatus() {
  const pwa = usePwa();
  const [cached, setCached] = useState(false);
  const [confirmUpdate, setConfirmUpdate] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const saved = () => setCached(true), connected = () => setCached(false);
    window.addEventListener('hays:cached-read', saved); window.addEventListener('hays:connected-read', connected);
    return () => { window.removeEventListener('hays:cached-read', saved); window.removeEventListener('hays:connected-read', connected); };
  }, []);
  return <>
    {(pwa.offline || cached) && <div className="pwa-banner offline-banner" role="status"><WifiOff size={15} /> Offline view · Showing saved messages. Drafts stay on this device; reconnect to send.</div>}
    {pwa.updateAvailable && <div className="pwa-banner update-banner" role="status"><span>A new version of Hays Messages is ready.</span><button className="text-button" onClick={() => setConfirmUpdate(true)}><RefreshCw size={14} /> Update app</button></div>}
    {confirmUpdate && <Modal title="Update Hays Messages?" onClose={() => setConfirmUpdate(false)}><p className="muted">The app will reload. Unsent drafts have been saved on this device.</p>{error && <p className="error" role="alert">{error}</p>}<div className="modal-actions"><button className="button" onClick={() => setConfirmUpdate(false)}>Later</button><button className="button primary" onClick={() => { void applyPwaUpdate().catch(e => setError(message(e))); }}>Update now</button></div></Modal>}
  </>;
}
