import { toast } from 'sonner';
import { useUIStore } from '@/stores/ui-store';

let audioCtx: AudioContext | null = null;

/** Create/resume AudioContext. Must be called from a user-gesture (click) handler. */
export function ensureAudioContext() {
  if (!audioCtx) audioCtx = new AudioContext();
  if (audioCtx.state === 'suspended') audioCtx.resume();
}

function playBeep() {
  if (!audioCtx) return;
  if (audioCtx.state === 'suspended') audioCtx.resume();
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.frequency.value = 880;
  gain.gain.value = 0.3;
  osc.start();
  gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.3);
  osc.stop(audioCtx.currentTime + 0.3);
}

/** Request browser notification permission. Returns whether permission was granted. */
export async function requestNotificationPermission(): Promise<boolean> {
  if (!('Notification' in window)) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  const result = await Notification.requestPermission();
  return result === 'granted';
}

export function triggerTaskNotification(serverName: string, sessionName: string) {
  const { notifyBrowser, notifyToast, notifySound } = useUIStore.getState();
  const body = `${serverName} / ${sessionName}`;

  if (notifyToast) {
    toast.success('Task completed', { description: body, duration: 4000 });
  }

  if (notifyBrowser && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('Gate — Task completed', { body, icon: '/favicon.svg' });
  }

  if (notifySound) {
    playBeep();
  }
}
