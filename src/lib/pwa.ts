interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}
export interface PwaState {
  standalone: boolean;
  isIOS: boolean;
  canInstall: boolean;
  updateAvailable: boolean;
  offline: boolean;
  registrationError: string;
}
const displayMode = window.matchMedia('(display-mode: standalone)');
const iosNavigator = navigator as Navigator & { standalone?: boolean };
let state: PwaState = {
  standalone: displayMode.matches || iosNavigator.standalone === true,
  isIOS: /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  canInstall: false,
  updateAvailable: false,
  offline: !navigator.onLine,
  registrationError: '',
};
const subscribers = new Set<(value: PwaState) => void>();
let deferredPrompt: InstallPromptEvent | undefined;
let registration: ServiceWorkerRegistration | undefined;
let registrationPromise: Promise<ServiceWorkerRegistration> | undefined;
let applyingUpdate = false;
function publish(patch: Partial<PwaState>) {
  state = { ...state, ...patch };
  subscribers.forEach(listener => listener(state));
}
export function getPwaState() { return state; }
export function subscribePwa(listener: (value: PwaState) => void) {
  subscribers.add(listener);
  listener(state);
  return () => { subscribers.delete(listener); };
}
window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  deferredPrompt = event as InstallPromptEvent;
  publish({ canInstall: !state.standalone });
});
window.addEventListener('appinstalled', () => {
  deferredPrompt = undefined;
  publish({ canInstall: false, standalone: true });
});
displayMode.addEventListener('change', () => {
  const standalone = displayMode.matches || iosNavigator.standalone === true;
  publish({ standalone, canInstall: !standalone && !!deferredPrompt });
});
window.addEventListener('online', () => {
  publish({ offline: false });
  void registration?.update().catch(() => undefined);
});
window.addEventListener('offline', () => publish({ offline: true }));
export async function installApp(): Promise<boolean> {
  const prompt = deferredPrompt;
  if (!prompt || state.standalone) return false;
  deferredPrompt = undefined;
  publish({ canInstall: false });
  await prompt.prompt();
  return (await prompt.userChoice).outcome === 'accepted';
}
function registerWorker(): Promise<ServiceWorkerRegistration> {
  if (registrationPromise) return registrationPromise;
  registrationPromise = navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).then(result => {
    registration = result;
    publish({ updateAvailable: !!result.waiting, registrationError: '' });
    result.addEventListener('updatefound', () => {
      const installing = result.installing;
      installing?.addEventListener('statechange', () => {
        if (installing.state === 'installed') publish({ updateAvailable: !!result.waiting && !!navigator.serviceWorker.controller });
      });
    });
    return result;
  }).catch(error => {
    registrationPromise = undefined;
    publish({ registrationError: error instanceof Error ? error.message : 'Offline installation could not be prepared.' });
    throw error;
  });
  return registrationPromise;
}
export async function getServiceWorkerRegistration(): Promise<ServiceWorkerRegistration> {
  if (!import.meta.env.PROD) throw new Error('Notifications require the production preview or an HTTPS deployment.');
  if (!window.isSecureContext) throw new Error('Install and notifications require HTTPS.');
  if (!('serviceWorker' in navigator)) throw new Error('This browser does not support service workers.');
  const result = await registerWorker();
  if (result.active) return result;
  const worker = result.installing || result.waiting;
  if (!worker) throw new Error('Offline installation is not ready. Please try again.');
  await new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(() => { cleanup(); reject(new Error('Offline installation timed out. Please try again.')); }, 20000);
    function cleanup() { window.clearTimeout(timeout); worker!.removeEventListener('statechange', changed); }
    function changed() {
      if (worker!.state === 'activated') { cleanup(); resolve(); }
      else if (worker!.state === 'redundant') { cleanup(); reject(new Error('Offline installation failed. Please reload and try again.')); }
    }
    worker.addEventListener('statechange', changed);
    changed();
  });
  return result;
}
export async function applyPwaUpdate(): Promise<void> {
  const result = await getServiceWorkerRegistration();
  if (!result.waiting) return;
  applyingUpdate = true;
  result.waiting.postMessage({ type: 'SKIP_WAITING' });
}
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    publish({ updateAvailable: false });
    // First installation never reloads an active conversation. Updates are opt-in.
    if (applyingUpdate) window.location.reload();
  });
  navigator.serviceWorker.addEventListener('message', event => {
    if (event.data?.type !== 'OPEN_CONVERSATION' || typeof event.data.conversationId !== 'string') return;
    window.dispatchEvent(new CustomEvent('hays:open-conversation', { detail: {
      conversationId: event.data.conversationId,
      messageId: typeof event.data.messageId === 'string' ? event.data.messageId : '',
    } }));
  });
  if (import.meta.env.PROD && window.isSecureContext) {
    const start = () => { void registerWorker().catch(() => undefined); };
    if (document.readyState === 'complete') start();
    else window.addEventListener('load', start, { once: true });
    window.setInterval(() => {
      if (navigator.onLine && document.visibilityState === 'visible') void registration?.update().catch(() => undefined);
    }, 60 * 60 * 1000);
  }
}
