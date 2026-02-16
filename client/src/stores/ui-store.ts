import { create } from 'zustand';

interface UIStore {
  sidebarOpen: boolean;
  planPanelOpen: boolean;
  toggleSidebar: () => void;
  setSidebarOpen: (open: boolean) => void;
  togglePlanPanel: () => void;
  setPlanPanelOpen: (open: boolean) => void;
}

export const useUIStore = create<UIStore>((set) => ({
  sidebarOpen: true,
  planPanelOpen: false,
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  togglePlanPanel: () => set((s) => ({ planPanelOpen: !s.planPanelOpen })),
  setPlanPanelOpen: (open) => set({ planPanelOpen: open }),
}));
