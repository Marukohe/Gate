export type TaskStatus = 'backlog' | 'in-progress' | 'paused' | 'review' | 'done' | 'canceled';
export type RunState = 'queued' | 'starting' | 'running' | 'waiting' | 'stopping' |
  'completed' | 'failed' | 'interrupted' | 'lost';
export type RunKind = 'implementation' | 'retry' | 'handoff' | 'review' | 'terminal' | 'test' | 'script' | 'delivery' | 'external';

export interface Project {
  id: string;
  name: string;
  remoteUrl: string | null;
  defaultBranch: string | null;
  defaultProvider: string;
  defaultIsolation: 'worktree' | 'shared';
  defaultCheckoutId: string | null;
  scripts: Partial<Record<'setup' | 'run' | 'test', string>>;
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

export interface Question {
  id: string; text: string; options: { label: string; description: string }[]; multiSelect: boolean; secret: boolean;
}

export interface Attention {
  id: string; taskId: string; runId: string; requestId: string; method: string;
  kind: 'approval' | 'question' | 'failure' | 'unsupported'; title: string;
  detail: Record<string, unknown>; questions: Question[]; choices: string[];
  state: 'pending' | 'sending' | 'resolved' | 'expired'; response: Record<string, unknown> | null;
  createdAt: number; submittedAt: number | null; resolvedAt: number | null;
}

export interface CodeSnapshot { head: string; tree: string; dirty: boolean }

export type ScriptName = 'setup' | 'run' | 'test';
export interface TaskScripts { scripts: Partial<Record<ScriptName, { command: string; source: 'project' | 'gate.json' }>>; warning: string | null }

export interface Verification {
  purpose?: 'setup' | 'run' | 'test';
  id: string; taskId: string; runId: string; command: string; cwd: string;
  state: 'queued' | 'running' | 'passed' | 'failed' | 'interrupted' | 'lost';
  before: CodeSnapshot | null; after: CodeSnapshot | null;
  startedAt: number | null; endedAt: number | null; exitCode: number | null; signal: string | null;
}

export interface FrozenSnapshot extends CodeSnapshot { commit: string; ref: string; base: string; patchPath: string }

export interface DeliveryInfo {
  checkoutId: string;
  snapshot: CodeSnapshot; branch: string;
  remote: { name: string; display: string; fingerprint: string } | null;
}
export interface DeliveryRequest extends DeliveryInfo {
  action: 'commit' | 'push' | 'create-pr'; message?: string; title?: string; body?: string; base?: string;
}
export interface Delivery {
  id: string; taskId: string; runId: string; request: DeliveryRequest;
  state: 'queued' | 'running' | 'completed' | 'failed' | 'interrupted' | 'lost';
  startedAt: number | null; endedAt: number | null;
  result: { commit: string; tree: string; url?: string; pushed?: boolean; reused?: boolean } | null;
}

export interface ObservedSession {
  id: string; scopeId: string; provider: string; sessionId: string; cwd: string; event: string;
  state: 'busy' | 'idle' | 'waiting' | 'ended'; revision: number; firstSeenAt: number; lastSeenAt: number;
  checkoutId: string; taskId: string | null; dismissedRevision: number | null;
}

export interface HookSettings {
  checkoutId: string; providers: Record<string, boolean>; connectionError: string | null; lastSyncedAt: number | null;
}

export interface CollaborationRecord {
  id: string; taskId: string; runId: string; kind: 'handoff' | 'review'; sourceRunId: string | null;
  sourceCheckoutId: string; sourceProvider: string | null; targetProvider: string;
  goal: string; acceptance: string; instructions: string; createdAt: number;
  snapshot: FrozenSnapshot | null; packet: string | null; result: string | null;
  state: 'preparing' | 'running' | 'completed' | 'failed' | 'interrupted' | 'lost';
}

export interface TaskResult {
  snapshot: CodeSnapshot; status: string; diff: string; truncated: boolean; capturedAt: number;
}

export interface WorkbenchSnapshot {
  projects: Project[];
  checkouts: Checkout[];
  tasks: Task[];
  runs: Run[];
  attention: Attention[];
  verifications: Verification[];
  collaborations: CollaborationRecord[];
  observedSessions: ObservedSession[];
  hookSettings: HookSettings[];
  deliveries: Delivery[];
}
