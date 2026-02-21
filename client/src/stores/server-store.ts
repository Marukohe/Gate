import { create } from 'zustand';

export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKeyPath?: string;
  defaultWorkingDir?: string;
  createdAt: number;
}

interface ServerStore {
  servers: Server[];
  activeServerId: string | null;
  setServers: (servers: Server[]) => void;
  addServer: (server: Server) => void;
  updateServer: (server: Server) => void;
  removeServer: (id: string) => void;
  setActiveServer: (id: string | null) => void;
}

export const useServerStore = create<ServerStore>((set) => ({
  servers: [],
  activeServerId: null,
  setServers: (servers) => set({ servers }),
  addServer: (server) => set((s) => ({ servers: [...s.servers, server] })),
  updateServer: (server) => set((s) => ({
    servers: s.servers.map((sv) => sv.id === server.id ? server : sv),
  })),
  removeServer: (id) => set((s) => ({
    servers: s.servers.filter((sv) => sv.id !== id),
    activeServerId: s.activeServerId === id ? null : s.activeServerId,
  })),
  setActiveServer: (id) => set({ activeServerId: id }),
}));
