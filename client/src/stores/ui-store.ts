import { create } from 'zustand';
const stored = localStorage.getItem('gate-dark-mode');
export const useUIStore = create<{
  darkMode: boolean; toggleDarkMode: () => void;
  sidebarOpen: boolean; setSidebarOpen: (open: boolean) => void;
  fileWrap: boolean; toggleFileWrap: () => void;
}>((set) => ({
  fileWrap: localStorage.getItem('gate-file-wrap') === 'true',
  toggleFileWrap: () => set((state) => {
    const fileWrap = !state.fileWrap;
    localStorage.setItem('gate-file-wrap', String(fileWrap));
    return { fileWrap };
  }),
  sidebarOpen: localStorage.getItem('gate-sidebar-open') !== 'false',
  setSidebarOpen: (sidebarOpen) => {
    localStorage.setItem('gate-sidebar-open', String(sidebarOpen));
    set({ sidebarOpen });
  },
  darkMode: stored === null ? matchMedia('(prefers-color-scheme: dark)').matches : stored === 'true',
  toggleDarkMode: () => set((state) => {
    const darkMode = !state.darkMode;
    localStorage.setItem('gate-dark-mode', String(darkMode));
    return { darkMode };
  }),
}));
