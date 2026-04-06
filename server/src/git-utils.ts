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

const STATUS_MAP: Record<string, GitFileStatus['status']> = {
  A: 'added',
  M: 'modified',
  D: 'deleted',
  R: 'renamed',
  '?': 'untracked',
};

export function parseGitStatusPorcelain(output: string): GitStatusResult {
  const staged: GitFileStatus[] = [];
  const unstaged: GitFileStatus[] = [];
  const untracked: GitFileStatus[] = [];

  for (const line of output.split('\n')) {
    if (!line || line.length < 4) continue;
    const x = line[0]; // index status
    const y = line[1]; // worktree status
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
