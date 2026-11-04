import { create } from 'zustand';
const stored = localStorage.getItem('gate-dark-mode');
export const useUIStore = create<{ darkMode: boolean; toggleDarkMode: () => void }>((set) => ({
  darkMode: stored === null ? matchMedia('(prefers-color-scheme: dark)').matches : stored === 'true',
  toggleDarkMode: () => set((state) => {
    const darkMode = !state.darkMode;
    localStorage.setItem('gate-dark-mode', String(darkMode));
    return { darkMode };
  }),
}));
