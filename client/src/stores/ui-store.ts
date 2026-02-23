import { create } from 'zustand';

function getInitialDarkMode(): boolean {
  const stored = localStorage.getItem('gate-dark-mode');
  if (stored !== null) return stored === 'true';
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

interface UIStore {
  sidebarOpen: boolean;
  planPanelOpen: boolean;
  darkMode: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  togglePlanPanel: () => void;
  setPlanPanelOpen: (open: boolean) => void;
  toggleDarkMode: () => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: false,
  planPanelOpen: false,
  darkMode: getInitialDarkMode(),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  togglePlanPanel: () => set((s) => ({ planPanelOpen: !s.planPanelOpen })),
  setPlanPanelOpen: (open) => set({ planPanelOpen: open }),
  toggleDarkMode: () => set((s) => {
    const next = !s.darkMode;
    localStorage.setItem('gate-dark-mode', String(next));
    return { darkMode: next };
  }),
}));
