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
  createdAt: number;
}

interface ServerStore {
  servers: Server[];
  activeServerId: string | null;
  connectionStatus: Record<string, 'connected' | 'disconnected' | 'connecting' | 'error'>;
  connectionError: Record<string, string>;
  setServers: (servers: Server[]) => void;
  addServer: (server: Server) => void;
  removeServer: (id: string) => void;
  setActiveServer: (id: string | null) => void;
  setConnectionStatus: (serverId: string, status: 'connected' | 'disconnected' | 'connecting' | 'error', error?: string) => void;
}

export const useServerStore = create<ServerStore>((set) => ({
  servers: [],
  activeServerId: null,
  connectionStatus: {},
  connectionError: {},
  setServers: (servers) => set({ servers }),
  addServer: (server) => set((s) => ({ servers: [...s.servers, server] })),
  removeServer: (id) => set((s) => ({
    servers: s.servers.filter((sv) => sv.id !== id),
    activeServerId: s.activeServerId === id ? null : s.activeServerId,
  })),
  setActiveServer: (id) => set({ activeServerId: id }),
  setConnectionStatus: (serverId, status, error?) => set((s) => ({
    connectionStatus: { ...s.connectionStatus, [serverId]: status },
    connectionError: error
      ? { ...s.connectionError, [serverId]: error }
      : status !== 'error'
        ? { ...s.connectionError, [serverId]: '' }
        : s.connectionError,
  })),
}));
