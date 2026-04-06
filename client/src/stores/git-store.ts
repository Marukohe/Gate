import { create } from 'zustand';

export interface GitFileStatus {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
  staged: boolean;
}

export interface GitStatusResult {
  staged: GitFileStatus[];
  unstaged: GitFileStatus[];
  untracked: GitFileStatus[];
}

export interface PRInfo {
  number: number;
  title: string;
  state: string;
  url: string;
}

interface GitStore {
  status: Record<string, GitStatusResult>;
  diff: Record<string, string>;
  prInfo: Record<string, PRInfo | null>;
  selectedFile: Record<string, string | null>;

  setStatus: (sessionId: string, result: GitStatusResult) => void;
  setDiff: (sessionId: string, diff: string) => void;
  setPRInfo: (sessionId: string, info: PRInfo | null) => void;
  setSelectedFile: (sessionId: string, file: string | null) => void;
}

export const useGitStore = create<GitStore>((set) => ({
  status: {},
  diff: {},
  prInfo: {},
  selectedFile: {},

  setStatus: (sessionId, result) => set((s) => ({
    status: { ...s.status, [sessionId]: result },
  })),
  setDiff: (sessionId, diff) => set((s) => ({
    diff: { ...s.diff, [sessionId]: diff },
  })),
  setPRInfo: (sessionId, info) => set((s) => ({
    prInfo: { ...s.prInfo, [sessionId]: info },
  })),
  setSelectedFile: (sessionId, file) => set((s) => ({
    selectedFile: { ...s.selectedFile, [sessionId]: file },
  })),
}));

export function parseGitStatusPorcelain(output: string): GitStatusResult {
  const staged: GitFileStatus[] = [];
  const unstaged: GitFileStatus[] = [];
  const untracked: GitFileStatus[] = [];

  const STATUS_MAP: Record<string, GitFileStatus['status']> = {
    A: 'added', M: 'modified', D: 'deleted', R: 'renamed', '?': 'untracked',
  };

  for (const line of output.split('\n')) {
    if (!line || line.length < 4) continue;
    const x = line[0];
    const y = line[1];
    const path = line.slice(3);

    if (x === '?' && y === '?') {
      untracked.push({ path, status: 'untracked', staged: false });
      continue;
    }
    if (x !== ' ' && x !== '?') {
      staged.push({ path, status: STATUS_MAP[x] ?? 'modified', staged: true });
    }
    if (y !== ' ' && y !== '?') {
      unstaged.push({ path, status: STATUS_MAP[y] ?? 'modified', staged: false });
    }
  }

  return { staged, unstaged, untracked };
}
