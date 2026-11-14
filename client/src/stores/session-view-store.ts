import { create } from 'zustand';
import type { SessionDetail } from '../../../server/src/types';

export const sessionKey = (serverId: string, threadId: string) => JSON.stringify([serverId, threadId]);
interface ViewState {
  text: string; model: string; effort: string; busy: boolean;
  detail: SessionDetail | null; scrollTop: number; follow: boolean;
}
export const emptyView: ViewState = { text: '', model: '', effort: '', busy: false, detail: null, scrollTop: 0, follow: true };
// In-memory only: preserve a visit without writing conversations or drafts into browser storage.
export const useSessionViewStore = create<{
  views: Record<string, ViewState>; update: (key: string, patch: Partial<ViewState>) => void;
}>((set) => ({ views: {}, update: (key, patch) => set((state) => ({
  views: { ...state.views, [key]: { ...emptyView, ...state.views[key], ...patch } },
})) }));
