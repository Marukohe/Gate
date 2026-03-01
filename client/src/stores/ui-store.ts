import { create } from 'zustand';

function getInitialDarkMode(): boolean {
  const stored = localStorage.getItem('gate-dark-mode');
  if (stored !== null) return stored === 'true';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export type SyncStatus = { state: 'idle' } | { state: 'syncing' } | { state: 'done'; added: number } | { state: 'error'; error: string };

function getInitialNotifyPref(key: string, fallback: boolean): boolean {
  const stored = localStorage.getItem(key);
  if (stored !== null) return stored === 'true';
  return fallback;
}

interface UIStore {
  sidebarOpen: boolean;
  planPanelOpen: boolean;
  darkMode: boolean;
  notifyBrowser: boolean;
  notifyToast: boolean;
  notifySound: boolean;
  syncStatus: Record<string, SyncStatus>; // sessionId → status
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  togglePlanPanel: () => void;
  setPlanPanelOpen: (open: boolean) => void;
  toggleDarkMode: () => void;
  setNotifyBrowser: (on: boolean) => void;
  setNotifyToast: (on: boolean) => void;
  setNotifySound: (on: boolean) => void;
  setSyncStatus: (sessionId: string, status: SyncStatus) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: false,
  planPanelOpen: false,
  darkMode: getInitialDarkMode(),
  notifyBrowser: getInitialNotifyPref('gate-notify-browser', false),
  notifyToast: getInitialNotifyPref('gate-notify-toast', true),
  notifySound: getInitialNotifyPref('gate-notify-sound', false),
  syncStatus: {},
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  togglePlanPanel: () => set((s) => ({ planPanelOpen: !s.planPanelOpen })),
  setPlanPanelOpen: (open) => set({ planPanelOpen: open }),
  toggleDarkMode: () => set((s) => {
    const next = !s.darkMode;
    localStorage.setItem('gate-dark-mode', String(next));
    return { darkMode: next };
  }),
  setNotifyBrowser: (on) => set(() => {
    localStorage.setItem('gate-notify-browser', String(on));
    return { notifyBrowser: on };
  }),
  setNotifyToast: (on) => set(() => {
    localStorage.setItem('gate-notify-toast', String(on));
    return { notifyToast: on };
  }),
  setNotifySound: (on) => set(() => {
    localStorage.setItem('gate-notify-sound', String(on));
    return { notifySound: on };
  }),
  setSyncStatus: (sessionId, status) => set((s) => ({
    syncStatus: { ...s.syncStatus, [sessionId]: status },
  })),
}));
