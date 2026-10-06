import { useEffect, useState } from 'react';
import { Bell, BellOff, Download, Loader2, RefreshCw, Volume2, VolumeX, WifiOff } from 'lucide-react';
import { Modal } from './Modal';
import { ApiError, backendUrl, request } from '../lib/api';
import { offlineAccount } from '../lib/offline';
import { listenSoundPreference, playMessageSound, prepareSound, setSoundEnabled, soundEnabled } from '../lib/notificationSound';
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
  const soundAccount = offlineAccount(session?.user.email || '', backendUrl);
  const [sounds, setSounds] = useState(() => soundEnabled(soundAccount));
  const [soundNotice, setSoundNotice] = useState('');
  useEffect(() => {
    setSounds(soundEnabled(soundAccount));
    return listenSoundPreference(soundAccount, setSounds);
  }, [soundAccount]);
  const supported = typeof Notification !== 'undefined' && 'PushManager' in window && 'serviceWorker' in navigator && window.isSecureContext;
  const needsHomeScreen = pwa.isIOS && !pwa.standalone;
  useEffect(() => {
    if (dialog !== 'notifications' || !session || needsHomeScreen || !supported) return;
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
  async function testSound() {
    const ready = await prepareSound();
    setSoundNotice(ready && playMessageSound(true) ? 'Test sound played. Check your device volume if you did not hear it.' : 'Sound could not start. Check whether this browser tab is muted, then try again.');
  }
  async function testDeviceAlert() {
    if (!registration || Notification.permission !== 'granted') return;
    setError('');
    try {
      await registration.showNotification('Hays + Sons', { body: 'Notification test from this device.', icon: '/icons/icon-192.png', badge: '/icons/badge-96.png', silent: false, tag: 'hays-device-test' });
      setNotice('Test alert sent to this device. This checks device permissions; incoming alerts also need the workspace delivery service.');
    } catch (e) { setError(message(e)); }
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
      <h3 className="members-heading">Message sounds</h3>
      <p className="muted">Play a chime for incoming messages while this app is open. Sounds work without enabling background notifications.</p>
      <div className="notification-status">{sounds ? <><Volume2 size={19} /> Message sounds are on</> : <><VolumeX size={19} /> Message sounds are off</>}</div>
      <div className="modal-actions"><button className="button" onClick={() => {
        setSoundEnabled(soundAccount, !sounds); setSoundNotice('');
        if (!sounds) void testSound();
      }}>{sounds ? <VolumeX size={16} /> : <Volume2 size={16} />}{sounds ? 'Mute message sounds' : 'Enable message sounds'}</button><button className="button" onClick={() => void testSound()}><Volume2 size={16} /> Test sound</button></div>
      {soundNotice && <p className="notice" role="status">{soundNotice}</p>}
      <h3 className="members-heading">Background notifications</h3>
      <p className="muted">Get a device alert when the app is closed. Your device controls its sound and vibration. Check notification permissions, volume, and Do Not Disturb if alerts arrive silently.</p>
      {needsHomeScreen ? <><p className="notice">Add this app to your home screen and open it there to enable notifications on iPhone or iPad.</p><button className="button" onClick={() => setDialog('install')}><Download size={16} /> Installation instructions</button></> : !supported ? <p className="notice">Push notifications need a supported browser and a secure app address. Try the installed app in a current version of Chrome, Edge, Firefox, or Safari.</p> : <>
        {busy && !config && <p className="notification-status"><Loader2 size={18} className="spin" /> Checking notification settings…</p>}
        {config && !config.enabled && <p className="notice">{config.reason || 'Background notifications have not been configured for this workspace.'} Message sounds still work while the app is open.</p>}
        {config?.enabled && <div className="notification-status">{subscribed ? <><Bell size={19} /> Enabled on this device</> : <><BellOff size={19} /> Notifications are off</>}</div>}
        {config?.enabled && registration && <div className="modal-actions"><button className="button primary" disabled={busy || (!subscribed && Notification.permission === 'denied')} onClick={() => void (subscribed ? disable() : enable())}>{busy ? <Loader2 size={16} className="spin" /> : subscribed ? <BellOff size={16} /> : <Bell size={16} />}{subscribed ? 'Turn off notifications' : 'Enable notifications'}</button></div>}
        {subscribed && registration && <button className="button" disabled={busy || Notification.permission !== 'granted'} onClick={() => void testDeviceAlert()}><Bell size={16} /> Test device alert</button>}
        <button className="text-button" disabled={busy} onClick={() => setRefresh(n => n + 1)}><RefreshCw size={14} /> Check background delivery again</button>
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
