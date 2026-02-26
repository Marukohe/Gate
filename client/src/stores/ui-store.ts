import { create } from 'zustand';

function getInitialDarkMode(): boolean {
  const stored = localStorage.getItem('gate-dark-mode');
  if (stored !== null) return stored === 'true';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

export type SyncStatus = { state: 'idle' } | { state: 'syncing' } | { state: 'done'; added: number } | { state: 'error'; error: string };

interface UIStore {
  sidebarOpen: boolean;
  planPanelOpen: boolean;
  darkMode: boolean;
  syncStatus: Record<string, SyncStatus>; // sessionId → status
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  togglePlanPanel: () => void;
  setPlanPanelOpen: (open: boolean) => void;
  toggleDarkMode: () => void;
  setSyncStatus: (sessionId: string, status: SyncStatus) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: false,
  planPanelOpen: false,
  darkMode: getInitialDarkMode(),
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
  setSyncStatus: (sessionId, status) => set((s) => ({
    syncStatus: { ...s.syncStatus, [sessionId]: status },
  })),
}));
