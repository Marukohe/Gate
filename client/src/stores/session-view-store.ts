import { create } from 'zustand';
import type { SessionDetail, ShellResult } from '../../../server/src/types';

export const sessionKey = (serverId: string, threadId: string) => JSON.stringify([serverId, threadId]);
export interface ShellRun {
  id: string; command: string; afterItemId?: string; result?: ShellResult; error?: string;
}
interface ViewState {
  text: string; model: string; effort: string; busy: boolean;
  detail: SessionDetail | null; scrollTop: number; follow: boolean;
  shellRuns: ShellRun[];
}
export const emptyView: ViewState = { text: '', model: '', effort: '', busy: false, detail: null, scrollTop: 0, follow: true, shellRuns: [] };
// In-memory only: preserve a visit without writing conversations or drafts into browser storage.
export const useSessionViewStore = create<{
  views: Record<string, ViewState>; update: (key: string, patch: Partial<ViewState>) => void;
  shellRun: (key: string, run: ShellRun) => void;
}>((set) => ({ views: {}, update: (key, patch) => set((state) => ({
  views: { ...state.views, [key]: { ...emptyView, ...state.views[key], ...patch } },
})), shellRun: (key, run) => set((state) => {
  const view = state.views[key] ?? emptyView;
  const exists = view.shellRuns.some((item) => item.id === run.id);
  return { views: { ...state.views, [key]: { ...view, shellRuns: exists
    ? view.shellRuns.map((item) => item.id === run.id ? run : item) : [...view.shellRuns, run] } } };
}) }));
