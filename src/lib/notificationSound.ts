let audio: AudioContext | undefined;
let lastPlayed = 0;
const preferenceEvent = 'hays:sound-preference';
const key = (account: string) => `hays.messages.sound.v1:${account}`;
export function soundEnabled(account: string) {
  try { return localStorage.getItem(key(account)) !== 'off'; } catch { return true; }
}
export function setSoundEnabled(account: string, enabled: boolean) {
  try { localStorage.setItem(key(account), enabled ? 'on' : 'off'); } catch { /* Apply for this open app even without storage. */ }
  window.dispatchEvent(new CustomEvent(preferenceEvent, { detail: { account, enabled } }));
}
export function listenSoundPreference(account: string, listener: (enabled: boolean) => void) {
  const changed = (event: Event) => {
    const detail = (event as CustomEvent<{account: string; enabled: boolean}>).detail;
    if (detail?.account === account) listener(detail.enabled);
  };
  const stored = (event: StorageEvent) => { if (event.key === key(account)) listener(soundEnabled(account)); };
  window.addEventListener(preferenceEvent, changed); window.addEventListener('storage', stored);
  return () => { window.removeEventListener(preferenceEvent, changed); window.removeEventListener('storage', stored); };
}
export async function prepareSound(): Promise<boolean> {
  try {
    const Audio = window.AudioContext || (window as typeof window & {webkitAudioContext?: typeof AudioContext}).webkitAudioContext;
    if (!Audio) return false;
    audio ||= new Audio();
    if (audio.state !== 'running') await audio.resume();
    return audio.state === 'running';
  } catch { return false; }
}
export function playMessageSound(test = false): boolean {
  if (!audio || audio.state !== 'running' || (!test && Date.now() - lastPlayed < 1500)) return false;
  try {
    const now = audio.currentTime;
    for (const [offset, frequency] of [[0, 660], [0.14, 880]]) {
      const oscillator = audio.createOscillator(), volume = audio.createGain();
      oscillator.type = 'sine'; oscillator.frequency.value = frequency;
      volume.gain.setValueAtTime(0, now + offset);
      volume.gain.linearRampToValueAtTime(0.16, now + offset + 0.015);
      volume.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.18);
      oscillator.connect(volume); volume.connect(audio.destination);
      oscillator.onended = () => { oscillator.disconnect(); volume.disconnect(); };
      oscillator.start(now + offset); oscillator.stop(now + offset + 0.2);
    }
    lastPlayed = Date.now();
    return true;
  } catch { return false; }
}
