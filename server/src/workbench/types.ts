export type TaskStatus = 'backlog' | 'in-progress' | 'paused' | 'review' | 'done' | 'canceled';
export type RunState = 'queued' | 'starting' | 'running' | 'waiting' | 'stopping' |
  'completed' | 'failed' | 'interrupted' | 'lost';
export type RunKind = 'implementation' | 'retry' | 'handoff' | 'review' | 'terminal' | 'test' | 'external';

export interface Project {
  id: string;
  name: string;
  remoteUrl: string | null;
  defaultBranch: string | null;
  defaultProvider: string;
  legacyWorkspaceId: string | null;
  archivedAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export interface Checkout {
  id: string;
  projectId: string;
  serverId: string;
  path: string;
  branch: string | null;
  kind: 'repository' | 'worktree';
  createdAt: number;
}

export interface Task {
  id: string;
  projectId: string;
  checkoutId: string;
  title: string;
  goal: string;
  acceptance: string;
  status: TaskStatus;
  provider: string;
  isolation: 'worktree' | 'shared';
  legacySessionId: string | null;
  prUrl: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Run {
  id: string;
  taskId: string;
  checkoutId: string;
  provider: string;
  kind: RunKind;
  state: RunState;
  requestId: string;
  prompt: string;
  nativeSessionId: string | null;
  codeRef: string | null;
  eventCursor: number;
  exitCode: number | null;
  signal: string | null;
  error: string | null;
  createdAt: number;
  startedAt: number | null;
  endedAt: number | null;
}

export interface RunEvent {
  runId: string;
  seq: number;
  time: number;
  type: string;
  data: Record<string, unknown>;
}

export interface WorkbenchSnapshot {
  projects: Project[];
  checkouts: Checkout[];
  tasks: Task[];
  runs: Run[];
}
