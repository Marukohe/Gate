import { create } from 'zustand';
import { clampSidebarWidth, sidebarLimits, type SidebarWidths } from '@/lib/sidebar-widths';
const stored = localStorage.getItem('gate-dark-mode');
function readSidebarWidths(): SidebarWidths {
  try {
    const widths = JSON.parse(localStorage.getItem('gate-sidebar-widths') ?? '{}');
    return { sessions: clampSidebarWidth('sessions', widths?.sessions), files: clampSidebarWidth('files', widths?.files) };
  } catch {
    return { sessions: sidebarLimits.sessions.default, files: sidebarLimits.files.default };
  }
}
export const useUIStore = create<{
  darkMode: boolean; toggleDarkMode: () => void;
  sidebarOpen: boolean; setSidebarOpen: (open: boolean) => void;
  fileWrap: boolean; toggleFileWrap: () => void;
  sidebarWidths: SidebarWidths; setSidebarWidths: (widths: SidebarWidths) => void;
  saveSidebarWidths: () => void;
}>((set, get) => ({
  sidebarWidths: readSidebarWidths(),
  setSidebarWidths: (widths) => set({ sidebarWidths: widths }),
  saveSidebarWidths: () => localStorage.setItem('gate-sidebar-widths', JSON.stringify(get().sidebarWidths)),
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
