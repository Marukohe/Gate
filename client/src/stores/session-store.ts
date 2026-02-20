import { create } from 'zustand';

export interface Session {
  id: string;
  serverId: string;
  name: string;
  claudeSessionId: string | null;
  createdAt: number;
  lastActiveAt: number;
}

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting' | 'error';

interface SessionStore {
  sessions: Record<string, Session[]>;          // serverId → sessions
  activeSessionId: Record<string, string>;      // serverId → active sessionId
  connectionStatus: Record<string, ConnectionStatus>;  // sessionId → status
  connectionError: Record<string, string>;      // sessionId → error

  setSessions: (serverId: string, sessions: Session[]) => void;
  addSession: (serverId: string, session: Session) => void;
  removeSession: (serverId: string, sessionId: string) => void;
  setActiveSession: (serverId: string, sessionId: string) => void;
  setConnectionStatus: (sessionId: string, status: ConnectionStatus, error?: string) => void;
  getActiveSessionId: (serverId: string | null) => string | undefined;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: {},
  activeSessionId: {},
  connectionStatus: {},
  connectionError: {},

  setSessions: (serverId, sessions) => set((s) => ({
    sessions: { ...s.sessions, [serverId]: sessions },
  })),

  addSession: (serverId, session) => set((s) => ({
    sessions: {
      ...s.sessions,
      [serverId]: [...(s.sessions[serverId] ?? []), session],
    },
  })),

  removeSession: (serverId, sessionId) => set((s) => {
    const filtered = (s.sessions[serverId] ?? []).filter((sess) => sess.id !== sessionId);
    const activeUpdate: Record<string, string> = { ...s.activeSessionId };
    if (activeUpdate[serverId] === sessionId) {
      // Activate the first remaining session, or remove entry
      if (filtered.length > 0) {
        activeUpdate[serverId] = filtered[0].id;
      } else {
        delete activeUpdate[serverId];
      }
    }
    return {
      sessions: { ...s.sessions, [serverId]: filtered },
      activeSessionId: activeUpdate,
    };
  }),

  setActiveSession: (serverId, sessionId) => set((s) => ({
    activeSessionId: { ...s.activeSessionId, [serverId]: sessionId },
  })),

  setConnectionStatus: (sessionId, status, error?) => set((s) => ({
    connectionStatus: { ...s.connectionStatus, [sessionId]: status },
    connectionError: error
      ? { ...s.connectionError, [sessionId]: error }
      : status !== 'error'
        ? { ...s.connectionError, [sessionId]: '' }
        : s.connectionError,
  })),

  getActiveSessionId: (serverId) => {
    if (!serverId) return undefined;
    return get().activeSessionId[serverId];
  },
}));
