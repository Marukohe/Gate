import { toast } from 'sonner';
import { useUIStore } from '@/stores/ui-store';

let audioCtx: AudioContext | null = null;

function playBeep() {
  if (!audioCtx) audioCtx = new AudioContext();
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

export function requestNotificationPermission() {
  if ('Notification' in window && Notification.permission === 'default') {
    Notification.requestPermission();
  }
}

export function triggerTaskNotification(serverName: string, sessionName: string) {
  const { notifyBrowser, notifyToast, notifySound } = useUIStore.getState();
  const body = `${serverName} / ${sessionName}`;

  if (notifyToast) {
    toast.success('Task completed', { description: body, duration: 4000 });
  }

  if (notifyBrowser && 'Notification' in window && Notification.permission === 'granted') {
    new Notification('Gate — Task completed', { body, icon: '/favicon.ico' });
  }

  if (notifySound) {
    playBeep();
  }
}
