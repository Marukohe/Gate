import { create } from 'zustand';
import type { PublicServer } from '../../../server/src/types';
export type Server = PublicServer;
export const useServerStore = create<{ servers: Server[]; setServers: (servers: Server[]) => void }>((set) => ({
  servers: [], setServers: (servers) => set({ servers }),
}));
