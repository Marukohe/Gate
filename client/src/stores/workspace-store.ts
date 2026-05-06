import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Session } from './session-store';

export type WorkspaceStatus = 'backlog' | 'in-progress' | 'review' | 'done' | 'canceled';
export type WorkspacePrState = 'none' | 'open' | 'closed' | 'merged' | 'unknown';

export interface WorkspaceBranchList {
  current: string;
  local: string[];
  remote: string[];
}

export interface WorkspaceInspectorSnapshot {
  workspaceId: string;
  serverId: string;
  primarySession: Session | null;
  visibleSessions: Session[];
  actionSessions: Session[];
  changes: null;
  pr: {
    url: string | null;
    state: WorkspacePrState;
  };
  scripts: Record<string, string>;
  actionStatus: null;
}

export interface WorkspaceWithAggregates {
  id: string;
  serverId: string;
  repoPath: string;
  remoteUrl: string | null;
  defaultBranch: string | null;
  name: string;
  autoOpenLastSession: boolean;
  status: WorkspaceStatus;
  goal: string | null;
  pinnedAt: number | null;
  archivedAt: number | null;
  primarySessionId: string | null;
  prUrl: string | null;
  prState: WorkspacePrState;
  createdAt: number;
  updatedAt: number;
  totalSessionCount: number;
  lastActivityAt: number | null;
  activeSessionCount: number;
  dirtyFileCount: number | null;
}

interface WorkspaceStore {
  workspaces: Record<string, WorkspaceWithAggregates>;
  branches: Record<string, WorkspaceBranchList>;
  inspectors: Record<string, WorkspaceInspectorSnapshot>;
  activeWorkspaceId: string | null;
  setWorkspaces: (list: WorkspaceWithAggregates[]) => void;
  upsertWorkspace: (ws: WorkspaceWithAggregates) => void;
  setBranches: (workspaceId: string, branches: WorkspaceBranchList) => void;
  setInspector: (snapshot: WorkspaceInspectorSnapshot) => void;
  removeWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string | null) => void;
  list: () => WorkspaceWithAggregates[];
  getForSession: (workspaceId: string | null) => WorkspaceWithAggregates | undefined;
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      workspaces: {},
      branches: {},
      inspectors: {},
      activeWorkspaceId: null,
      setWorkspaces: (list) => set({
        workspaces: Object.fromEntries(list.map((w) => [w.id, w])),
      }),
      upsertWorkspace: (ws) => set((s) => ({
        workspaces: { ...s.workspaces, [ws.id]: ws },
      })),
      setBranches: (workspaceId, branches) => set((s) => ({
        branches: { ...s.branches, [workspaceId]: branches },
      })),
      setInspector: (snapshot) => set((s) => ({
        inspectors: { ...s.inspectors, [snapshot.workspaceId]: snapshot },
      })),
      removeWorkspace: (id) => set((s) => {
        const { [id]: _drop, ...rest } = s.workspaces;
        const { [id]: _dropBranches, ...branches } = s.branches;
        const { [id]: _dropInspector, ...inspectors } = s.inspectors;
        return {
          workspaces: rest,
          branches,
          inspectors,
          activeWorkspaceId: s.activeWorkspaceId === id ? null : s.activeWorkspaceId,
        };
      }),
      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
      list: () => Object.values(get().workspaces).sort((a, b) =>
        (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) ||
        (b.lastActivityAt ?? b.updatedAt) - (a.lastActivityAt ?? a.updatedAt),
      ),
      getForSession: (workspaceId) => workspaceId ? get().workspaces[workspaceId] : undefined,
    }),
    {
      name: 'workspace-store',
      partialize: (state) => ({ activeWorkspaceId: state.activeWorkspaceId }),
    },
  ),
);
