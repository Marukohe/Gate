import type BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { Attention, Verification, CollaborationRecord, FrozenSnapshot, Checkout, Project, Run, RunEvent, RunKind, RunState, Task, TaskStatus, WorkbenchSnapshot } from './types.js';
import { describeAttention, supportsStructuredAnswers, validateDecision } from './attention.js';
import type { LaunchSpec, RuntimeSettings } from './remote.js';
import type { HookSettings, ObservedSession } from './types.js';

export interface Execution {
  runId: string; settings: RuntimeSettings; launch: LaunchSpec | null; source: string | null; branch: string | null;
  stopRequested: boolean; connectionError: string | null; lastSeenAt: number | null;
  terminalExit?: { exitCode: number; signal: string | null };
}

const taskStatuses: TaskStatus[] = ['backlog', 'in-progress', 'paused', 'review', 'done', 'canceled'];
const runKinds: RunKind[] = ['implementation', 'retry', 'handoff', 'review', 'terminal', 'test', 'external'];
const runStates: RunState[] = ['queued', 'starting', 'running', 'waiting', 'stopping',
  'completed', 'failed', 'interrupted', 'lost'];
export const ACTIVE_RUN_STATES: RunState[] = ['queued', 'starting', 'running', 'waiting', 'stopping'];

function required(value: string, field: string): string {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new Error(`${field} is required`);
  return value.trim();
}

export class WorkbenchStore {
  constructor(private db: BetterSqlite3.Database) {
    db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY, name TEXT NOT NULL, remoteUrl TEXT, defaultBranch TEXT,
          defaultProvider TEXT NOT NULL DEFAULT 'claude', legacyWorkspaceId TEXT UNIQUE, archivedAt INTEGER,
          createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS checkouts (
          id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
          serverId TEXT NOT NULL REFERENCES servers(id), path TEXT NOT NULL, branch TEXT,
          kind TEXT NOT NULL CHECK(kind IN ('repository', 'worktree')), createdAt INTEGER NOT NULL,
          UNIQUE(serverId, path), UNIQUE(id, projectId)
        );
        CREATE TABLE IF NOT EXISTS tasks (
          id TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id), checkoutId TEXT NOT NULL,
          title TEXT NOT NULL, goal TEXT NOT NULL, acceptance TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL CHECK(status IN ('backlog','in-progress','paused','review','done','canceled')),
          provider TEXT NOT NULL, isolation TEXT NOT NULL CHECK(isolation IN ('worktree','shared')),
          legacySessionId TEXT UNIQUE, prUrl TEXT, createdAt INTEGER NOT NULL, updatedAt INTEGER NOT NULL,
          FOREIGN KEY(checkoutId, projectId) REFERENCES checkouts(id, projectId)
        );
        CREATE TABLE IF NOT EXISTS runs (
          id TEXT PRIMARY KEY, taskId TEXT NOT NULL REFERENCES tasks(id),
          checkoutId TEXT NOT NULL REFERENCES checkouts(id), provider TEXT NOT NULL, kind TEXT NOT NULL,
          state TEXT NOT NULL, requestId TEXT NOT NULL UNIQUE, prompt TEXT NOT NULL,
          nativeSessionId TEXT, codeRef TEXT, eventCursor INTEGER NOT NULL DEFAULT 0,
          exitCode INTEGER, signal TEXT, error TEXT, createdAt INTEGER NOT NULL, startedAt INTEGER, endedAt INTEGER
        );
        CREATE INDEX IF NOT EXISTS tasks_project ON tasks(projectId, updatedAt);
        CREATE INDEX IF NOT EXISTS runs_task ON runs(taskId, createdAt);
        CREATE INDEX IF NOT EXISTS runs_state ON runs(state);
        CREATE TABLE IF NOT EXISTS run_events (
          runId TEXT NOT NULL REFERENCES runs(id), seq INTEGER NOT NULL, time INTEGER NOT NULL,
          type TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY(runId, seq)
        );
        CREATE TABLE IF NOT EXISTS checkout_leases (
          checkoutId TEXT PRIMARY KEY REFERENCES checkouts(id), runId TEXT NOT NULL UNIQUE REFERENCES runs(id)
        );
        CREATE TABLE IF NOT EXISTS workbench_legacy_imports (
          workspaceId TEXT PRIMARY KEY, projectId TEXT NOT NULL REFERENCES projects(id)
        );
        CREATE TABLE IF NOT EXISTS runtime_settings (
          serverId TEXT PRIMARY KEY REFERENCES servers(id), settings TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS attention (
          id TEXT PRIMARY KEY, runId TEXT NOT NULL REFERENCES runs(id), requestId TEXT NOT NULL,
          data TEXT NOT NULL, UNIQUE(runId, requestId)
        );
        CREATE TABLE IF NOT EXISTS workbench_features (name TEXT PRIMARY KEY);
        CREATE TABLE IF NOT EXISTS collaborations (
          id TEXT PRIMARY KEY, runId TEXT NOT NULL UNIQUE REFERENCES runs(id), data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS verifications (
          id TEXT PRIMARY KEY, runId TEXT NOT NULL UNIQUE REFERENCES runs(id), data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS run_execution (
          runId TEXT PRIMARY KEY REFERENCES runs(id), data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS hook_settings (
          checkoutId TEXT PRIMARY KEY REFERENCES checkouts(id), data TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS observed_sessions (
          id TEXT PRIMARY KEY, checkoutId TEXT NOT NULL REFERENCES checkouts(id), data TEXT NOT NULL
        );
      `);
      this.importLegacyWorkspaces();
      this.importAttentionEvents();
    })();
  }

  private importAttentionEvents(): void {
    if (this.db.prepare("SELECT 1 FROM workbench_features WHERE name = 'attention-v1'").get()) return;
    let afterRun = '';
    let afterSeq = 0;
    while (true) {
      // Finish each read before writing projections; better-sqlite3 forbids writes during an active iterator.
      const rows = this.db.prepare(`SELECT * FROM run_events WHERE
        (type IN ('exited','lost') OR
          (type = 'protocol' AND json_extract(data, '$.data.type') IN ('attention','attention-resolved')))
        AND (runId > ? OR (runId = ? AND seq > ?)) ORDER BY runId, seq LIMIT 100`)
        .all(afterRun, afterRun, afterSeq) as (Omit<RunEvent, 'data'> & { data: string })[];
      if (!rows.length) break;
      for (const row of rows) {
        const data = JSON.parse(row.data);
        const message = data.data;
        if (row.type === 'protocol' && message?.type === 'attention') {
          this.addAttention(row.runId, String(message.id), String(message.kind), message.detail, row.time);
        } else if (row.type === 'protocol' && message?.type === 'attention-resolved') {
          this.resolveAttention(row.runId, String(message.id), row.time);
        } else if (row.type === 'exited' || row.type === 'lost') {
          this.expireAttention(row.runId, row.time);
          const run = this.run(row.runId)!;
          if (run.state === 'failed' || row.type === 'lost') this.addAttention(row.runId,
            row.type === 'lost' ? 'ownership-loss' : 'run-failure', 'failure',
            { message: run.error ?? `Process exited ${data.exitCode ?? data.signal}` }, row.time);
        }
      }
      afterRun = rows.at(-1)!.runId;
      afterSeq = rows.at(-1)!.seq;
    }
    this.db.prepare("INSERT INTO workbench_features VALUES ('attention-v1')").run();
  }

  runtimeSettings(serverId: string): RuntimeSettings | undefined {
    const row = this.db.prepare('SELECT settings FROM runtime_settings WHERE serverId = ?').get(serverId) as
      { settings: string } | undefined;
    return row ? JSON.parse(row.settings) : undefined;
  }

  hookSettings(): HookSettings[] {
    return (this.db.prepare('SELECT data FROM hook_settings').all() as { data: string }[]).map((row) => JSON.parse(row.data));
  }

  saveHookSettings(settings: HookSettings): void {
    this.db.prepare('INSERT OR REPLACE INTO hook_settings VALUES (?, ?)').run(settings.checkoutId, JSON.stringify(settings));
  }

  observedSessions(): ObservedSession[] {
    return (this.db.prepare('SELECT data FROM observed_sessions').all() as { data: string }[]).map((row) => JSON.parse(row.data));
  }

  saveObservedSession(item: ObservedSession): void {
    this.db.prepare('INSERT OR REPLACE INTO observed_sessions VALUES (?, ?, ?)').run(item.id, item.checkoutId, JSON.stringify(item));
  }

  ingestObserved(checkoutId: string, sessions: ObservedSession[]): void {
    this.db.transaction(() => {
      const known = new Map(this.observedSessions().map((item) => [item.id, item]));
      for (const value of sessions) {
        if (value.scopeId !== checkoutId || value.cwd !== this.checkout(checkoutId)?.path) throw new Error('Observation checkout mismatch');
        const previous = known.get(value.id);
        if (previous && previous.revision >= value.revision) continue;
        const next = { ...value, checkoutId, taskId: previous?.taskId ?? null,
          dismissedRevision: previous?.dismissedRevision ?? null };
        this.saveObservedSession(next);
        known.set(next.id, next);
      }
    })();
  }

  updateObserved(id: string, input: { taskId?: string | null; inspected?: boolean }): ObservedSession {
    const item = this.observedSessions().find((value) => value.id === id);
    if (!item) throw new Error('Observed session not found');
    if (input.taskId && this.task(input.taskId)?.checkoutId !== item.checkoutId) throw new Error('Choose a task in this checkout');
    const next = { ...item, ...(input.taskId !== undefined ? { taskId: input.taskId } : {}),
      ...(input.inspected === true ? { dismissedRevision: item.revision } : {}) };
    this.saveObservedSession(next);
    return next;
  }

  assertNoObservedWriter(checkoutId: string): void {
    const conflict = this.observedSessions().find((item) => item.checkoutId === checkoutId && item.state !== 'ended' &&
      item.dismissedRevision !== item.revision);
    if (conflict) throw new Error(`Checkout has an observed ${conflict.provider} session (${conflict.sessionId}). Stop it in its native terminal or confirm it has exited in External sessions.`);
  }

  saveRuntimeSettings(settings: RuntimeSettings): void {
    this.db.prepare('INSERT OR REPLACE INTO runtime_settings VALUES (?, ?)').run(settings.serverId, JSON.stringify(settings));
  }

  execution(runId: string): Execution | undefined {
    const row = this.db.prepare('SELECT data FROM run_execution WHERE runId = ?').get(runId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }

  saveExecution(value: Execution): void {
    this.db.prepare('INSERT OR REPLACE INTO run_execution VALUES (?, ?)').run(value.runId, JSON.stringify(value));
  }

  prepareRun(runId: string, launch: LaunchSpec, codeRef: string): void {
    this.db.transaction(() => {
      const execution = this.execution(runId);
      if (!execution || execution.launch) throw new Error('Run preparation is no longer pending');
      this.saveExecution({ ...execution, launch });
      this.updateRun(runId, { state: 'starting', codeRef });
    })();
  }

  enqueue(taskId: string, requestId: string, prompt: string,
    options: 'implementation' | 'test' | { kind: 'handoff' | 'review' | 'terminal'; provider: string; sourceRunId?: string } = 'implementation'): Run {
    const kind = typeof options === 'string' ? options : options.kind;
    const targetProvider = typeof options === 'string' ? undefined : options.provider;
    const sourceRunId = typeof options === 'string' ? undefined : options.sourceRunId;
    if (targetProvider && !['claude', 'codex', ...(kind === 'terminal' ? ['shell'] : [])].includes(targetProvider)) {
      throw new Error('Choose a supported provider');
    }
    return this.db.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM runs WHERE requestId = ?').get(requestId) as Run | undefined;
      if (existing) {
        if (existing.taskId !== taskId || existing.prompt !== prompt || existing.kind !== kind ||
          (targetProvider && existing.provider !== targetProvider) ||
          (sourceRunId && this.collaboration(existing.id)?.sourceRunId !== sourceRunId)) {
          throw new Error('Request ID belongs to another request');
        }
        return existing;
      }
      const task = this.task(taskId);
      if (!task) throw new Error('Task not found');
      if (['done', 'canceled'].includes(task.status)) throw new Error('Reopen the task before starting a run');
      if (this.activeRuns().some((run) => run.taskId === taskId && run.kind !== 'review') ||
        this.db.prepare("SELECT 1 FROM runs WHERE taskId = ? AND state = 'lost' AND checkoutId = ?").get(taskId, task.checkoutId)) {
        throw new Error('Task has an active run or unresolved ownership loss');
      }
      const sourceRun = sourceRunId ? this.run(sourceRunId) : undefined;
      if (kind === 'handoff' && (!sourceRun || sourceRun.taskId !== taskId ||
        !['completed', 'failed', 'interrupted'].includes(sourceRun.state) || sourceRun.kind === 'review' ||
        !['claude', 'codex'].includes(sourceRun.provider))) {
        throw new Error('Choose a confirmed, finished agent run from this task for handoff');
      }
      let checkout = this.checkout(task.checkoutId)!;
      const settings = this.runtimeSettings(checkout.serverId);
      if (!settings) throw new Error('Set up the remote runtime on this machine first');
      let source: string | null = null;
      let branch: string | null = null;
      if (kind !== 'review' && task.isolation === 'worktree' && checkout.kind !== 'worktree') {
        source = checkout.path;
        branch = `gate/${task.id}`;
        checkout = this.createCheckout({ projectId: task.projectId, serverId: checkout.serverId,
          path: `${source}.gate-worktrees/${task.id}`, branch, kind: 'worktree' });
        this.updateTask(taskId, { checkoutId: checkout.id });
      }
      const run = this.createRun({ taskId, requestId, prompt, kind, provider: kind === 'test' ? 'shell' : targetProvider ?? task.provider, checkoutId: checkout.id });
      this.acquireCheckout(run.id);
      this.saveExecution({ runId: run.id, settings, launch: null, source, branch,
        stopRequested: false, connectionError: null, lastSeenAt: null });
      if (kind === 'test') this.saveVerification({ id: randomUUID(), taskId, runId: run.id, command: prompt,
        cwd: checkout.path, state: 'queued', before: null, after: null, startedAt: null, endedAt: null,
        exitCode: null, signal: null });
      if (kind === 'handoff' || kind === 'review') this.saveCollaboration({ id: randomUUID(), taskId, runId: run.id,
        kind, sourceRunId: sourceRunId ?? null, sourceCheckoutId: checkout.id, sourceProvider: sourceRun?.provider ?? null,
        targetProvider: run.provider, goal: task.goal, acceptance: task.acceptance, instructions: prompt, createdAt: Date.now(),
        snapshot: null, packet: null, result: null, state: 'preparing' });
      if (kind !== 'review') this.updateTask(taskId, { status: 'in-progress', ...(kind === 'handoff' ? { provider: run.provider } : {}) });
      return run;
    })();
  }

  importLegacyWorkspaces(): void {
    // Import each source once. Later edits in either surface must not overwrite the other model's goals.
    this.db.transaction(() => {
      const rows = this.db.prepare(`SELECT w.* FROM workspaces w LEFT JOIN workbench_legacy_imports i
        ON i.workspaceId = w.id WHERE i.workspaceId IS NULL`).all() as {
        id: string; name: string; serverId: string; repoPath: string; remoteUrl: string | null;
        defaultBranch: string | null; goal: string | null; status: TaskStatus; primarySessionId: string | null;
        prUrl: string | null; archivedAt: number | null;
      }[];
      for (const row of rows) {
        if (!row.repoPath.startsWith('/')) continue;
        const existing = this.db.prepare('SELECT * FROM checkouts WHERE serverId = ? AND path = ?')
          .get(row.serverId, path.posix.normalize(row.repoPath)) as Checkout | undefined;
        const project = existing ? this.project(existing.projectId)! : this.createProject({ name: row.name, remoteUrl: row.remoteUrl,
          defaultBranch: row.defaultBranch, legacyWorkspaceId: row.id, archivedAt: row.archivedAt });
        const checkout = existing ?? this.createCheckout({ projectId: project.id, serverId: row.serverId,
          path: row.repoPath, branch: row.defaultBranch });
        this.db.prepare('INSERT INTO workbench_legacy_imports VALUES (?, ?)').run(row.id, project.id);
        if (!row.goal?.trim()) continue;
        const session = row.primarySessionId ? this.db.prepare(`SELECT id, provider FROM sessions
          WHERE id = ? AND workspaceId = ? AND serverId = ?`).get(row.primarySessionId, row.id, row.serverId) as
          { id: string; provider: string } | undefined : undefined;
        const task = this.createTask({ projectId: project.id, checkoutId: checkout.id,
          title: row.goal.split('\n')[0].slice(0, 120), goal: row.goal, provider: session?.provider ?? 'claude',
          isolation: 'shared', legacySessionId: session?.id ?? null });
        this.updateTask(task.id, { status: row.status, prUrl: row.prUrl });
      }
    })();
  }

  snapshot(): WorkbenchSnapshot {
    this.importLegacyWorkspaces();
    return {
      projects: this.db.prepare('SELECT * FROM projects ORDER BY updatedAt DESC, id').all() as Project[],
      checkouts: this.db.prepare('SELECT * FROM checkouts ORDER BY createdAt, id').all() as Checkout[],
      tasks: this.db.prepare('SELECT * FROM tasks ORDER BY updatedAt DESC, id').all() as Task[],
      runs: this.db.prepare('SELECT * FROM runs ORDER BY createdAt DESC, id').all() as Run[],
      attention: this.attentionItems(),
      verifications: this.verifications(),
      collaborations: this.collaborations(),
      observedSessions: this.observedSessions(),
      hookSettings: this.hookSettings(),
    };
  }

  collaborations(): CollaborationRecord[] {
    return (this.db.prepare('SELECT data FROM collaborations').all() as { data: string }[]).map((row) => JSON.parse(row.data));
  }

  collaboration(runId: string): CollaborationRecord | undefined {
    const row = this.db.prepare('SELECT data FROM collaborations WHERE runId = ?').get(runId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }

  saveCollaboration(item: CollaborationRecord): void {
    this.db.prepare('INSERT INTO collaborations VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(item.id, item.runId, JSON.stringify(item));
  }

  prepareCollaboration(runId: string, snapshot: FrozenSnapshot, packet: string, reviewPath?: string): void {
    this.db.transaction(() => {
      const item = this.collaboration(runId);
      const run = this.run(runId);
      if (!item || !run || this.execution(runId)?.launch) throw new Error('Collaboration preparation is no longer pending');
      if (item.snapshot) return;
      if (item.kind === 'review') {
        const source = this.checkout(item.sourceCheckoutId)!;
        if (!reviewPath || reviewPath === source.path) throw new Error('Review requires an isolated checkout');
        const checkout = this.createCheckout({ projectId: source.projectId, serverId: source.serverId,
          path: reviewPath, kind: 'worktree' });
        this.db.prepare('DELETE FROM checkout_leases WHERE runId = ?').run(runId);
        this.updateRun(runId, { checkoutId: checkout.id });
        this.acquireCheckout(runId);
      }
      this.saveCollaboration({ ...item, snapshot, packet });
    })();
  }

  agentMessages(runId: string): string[] {
    const rows = this.db.prepare(`SELECT json_extract(data, '$.data.text') AS text FROM run_events
      WHERE runId = ? AND type = 'protocol' AND json_extract(data, '$.data.type') = 'message' ORDER BY seq DESC LIMIT 20`)
      .all(runId) as { text: string }[];
    return rows.reverse().map((row) => String(row.text).slice(0, 10_000));
  }

  attentionItems(runId?: string): Attention[] {
    const rows = (runId ? this.db.prepare('SELECT data FROM attention WHERE runId = ?').all(runId)
      : this.db.prepare('SELECT data FROM attention').all()) as { data: string }[];
    return rows.map((row) => JSON.parse(row.data)).sort((a, b) => b.createdAt - a.createdAt);
  }

  attentionItem(id: string): Attention | undefined {
    const row = this.db.prepare('SELECT data FROM attention WHERE id = ?').get(id) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }

  saveAttention(item: Attention): void {
    this.db.prepare('INSERT INTO attention VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(item.id, item.runId, item.requestId, JSON.stringify(item));
  }

  addAttention(runId: string, requestId: string, method: string, detail: Record<string, unknown>, time: number): Attention {
    const existing = this.attentionItems(runId).find((item) => item.requestId === requestId);
    if (existing) return existing;
    const run = this.run(runId)!;
    let description = method === 'failure'
      ? { kind: 'failure' as const, title: String(detail.message ?? 'Run failed'), questions: [], choices: ['acknowledge'] }
      : describeAttention(run.provider, method, detail);
    if (run.kind === 'review' && description.kind === 'approval') {
      description = { kind: 'unsupported', title: 'Review runs cannot grant additional access', questions: [], choices: [] };
    }
    const execution = this.execution(runId);
    if (description.kind === 'question' && run.provider === 'claude' && execution?.launch &&
      !supportsStructuredAnswers(execution.launch.initialInput)) {
      description = { kind: 'unsupported', title: 'This older Claude run cannot receive structured answers',
        questions: [], choices: [] };
    }
    const item: Attention = { id: randomUUID(), taskId: run.taskId, runId, requestId, method, detail, ...description,
      state: 'pending', response: null, createdAt: time, submittedAt: null, resolvedAt: null };
    this.saveAttention(item);
    return item;
  }

  decide(id: string, response: unknown): Attention {
    return this.db.transaction(() => {
      const item = this.attentionItem(id);
      if (!item) throw new Error('Attention item not found');
      const normalized = validateDecision(item, response);
      if (item.response && JSON.stringify(item.response) === JSON.stringify(normalized) && item.state !== 'expired') return item;
      if (item.state !== 'pending') throw new Error('Conflict: this item was already answered or expired');
      const run = this.run(item.runId)!;
      if (item.kind !== 'failure' && (!ACTIVE_RUN_STATES.includes(run.state) || this.execution(run.id)?.stopRequested)) {
        throw new Error('Conflict: this run can no longer accept a decision');
      }
      const now = Date.now();
      const next: Attention = { ...item, response: normalized, submittedAt: now,
        state: item.kind === 'failure' ? 'resolved' : 'sending', resolvedAt: item.kind === 'failure' ? now : null };
      this.saveAttention(next);
      return next;
    })();
  }

  resolveAttention(runId: string, requestId: string, time: number): void {
    const item = this.attentionItems(runId).find((value) => value.requestId === requestId);
    if (item && ['pending', 'sending'].includes(item.state)) {
      this.saveAttention({ ...item, state: item.response ? 'resolved' : 'expired', resolvedAt: time });
    }
  }

  expireAttention(runId: string, time: number): void {
    for (const item of this.attentionItems(runId)) {
      if (item.kind !== 'failure' && ['pending', 'sending'].includes(item.state)) {
        this.saveAttention({ ...item, state: 'expired', resolvedAt: time });
      }
    }
  }

  verifications(): Verification[] {
    return (this.db.prepare('SELECT data FROM verifications').all() as { data: string }[])
      .map((row) => JSON.parse(row.data));
  }

  verification(runId: string): Verification | undefined {
    const row = this.db.prepare('SELECT data FROM verifications WHERE runId = ?').get(runId) as { data: string } | undefined;
    return row ? JSON.parse(row.data) : undefined;
  }

  saveVerification(item: Verification): void {
    this.db.prepare('INSERT INTO verifications VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data=excluded.data')
      .run(item.id, item.runId, JSON.stringify(item));
  }

  project(id: string): Project | undefined {
    return this.db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Project | undefined;
  }
  checkout(id: string): Checkout | undefined {
    return this.db.prepare('SELECT * FROM checkouts WHERE id = ?').get(id) as Checkout | undefined;
  }
  task(id: string): Task | undefined {
    return this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Task | undefined;
  }
  run(id: string): Run | undefined {
    return this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Run | undefined;
  }

  createProject(input: { name: string; remoteUrl?: string | null; defaultBranch?: string | null;
    defaultProvider?: string; legacyWorkspaceId?: string | null; archivedAt?: number | null }): Project {
    const now = Date.now();
    const project: Project = { id: randomUUID(), name: required(input.name, 'Project name'),
      remoteUrl: input.remoteUrl ?? null, defaultBranch: input.defaultBranch ?? null,
      defaultProvider: input.defaultProvider ?? 'claude', legacyWorkspaceId: input.legacyWorkspaceId ?? null,
      archivedAt: input.archivedAt ?? null, createdAt: now, updatedAt: now };
    this.db.prepare(`INSERT INTO projects VALUES
      (@id, @name, @remoteUrl, @defaultBranch, @defaultProvider, @legacyWorkspaceId, @archivedAt, @createdAt, @updatedAt)`)
      .run(project);
    return project;
  }

  createProjectWithCheckout(project: Parameters<WorkbenchStore['createProject']>[0],
    checkout: Omit<Parameters<WorkbenchStore['createCheckout']>[0], 'projectId'>): { project: Project; checkout: Checkout } {
    return this.db.transaction(() => {
      const created = this.createProject(project);
      return { project: created, checkout: this.createCheckout({ ...checkout, projectId: created.id }) };
    })();
  }

  updateProject(id: string, input: Partial<Pick<Project, 'name' | 'defaultBranch' | 'defaultProvider' | 'archivedAt'>>): Project {
    const project = this.project(id);
    if (!project) throw new Error('Project not found');
    const next = { ...project, name: input.name === undefined ? project.name : required(input.name, 'Project name'),
      defaultBranch: input.defaultBranch === undefined ? project.defaultBranch : input.defaultBranch,
      defaultProvider: input.defaultProvider ?? project.defaultProvider,
      archivedAt: input.archivedAt === undefined ? project.archivedAt : input.archivedAt, updatedAt: Date.now() };
    this.db.prepare(`UPDATE projects SET name=@name, defaultBranch=@defaultBranch, defaultProvider=@defaultProvider,
      archivedAt=@archivedAt, updatedAt=@updatedAt WHERE id=@id`).run(next);
    return next;
  }

  createCheckout(input: { projectId: string; serverId: string; path: string; branch?: string | null;
    kind?: Checkout['kind'] }): Checkout {
    if (!this.project(input.projectId)) throw new Error('Project not found');
    const checkout: Checkout = { id: randomUUID(), projectId: input.projectId, serverId: input.serverId,
      path: path.posix.normalize(required(input.path, 'Checkout path')).replace(/\/$/, '') || '/', branch: input.branch ?? null,
      kind: input.kind ?? 'repository', createdAt: Date.now() };
    if (!checkout.path.startsWith('/')) throw new Error('Checkout path must be absolute');
    this.db.prepare('INSERT INTO checkouts VALUES (@id,@projectId,@serverId,@path,@branch,@kind,@createdAt)').run(checkout);
    return checkout;
  }

  createTask(input: { projectId: string; checkoutId: string; title: string; goal: string; acceptance?: string;
    provider?: string; isolation?: Task['isolation']; legacySessionId?: string | null }): Task {
    const project = this.project(input.projectId);
    const checkout = this.checkout(input.checkoutId);
    if (!project || checkout?.projectId !== project.id) throw new Error('Checkout must belong to the project');
    const now = Date.now();
    const task: Task = { id: randomUUID(), projectId: project.id, checkoutId: checkout.id,
      title: required(input.title, 'Task title'), goal: required(input.goal, 'Task goal'),
      acceptance: input.acceptance ?? '', status: 'backlog', provider: input.provider ?? project.defaultProvider,
      isolation: input.isolation ?? 'worktree', legacySessionId: input.legacySessionId ?? null,
      prUrl: null, createdAt: now, updatedAt: now };
    this.db.prepare(`INSERT INTO tasks VALUES (@id,@projectId,@checkoutId,@title,@goal,@acceptance,@status,@provider,
      @isolation,@legacySessionId,@prUrl,@createdAt,@updatedAt)`).run(task);
    return task;
  }

  updateTask(id: string, input: Partial<Pick<Task, 'title' | 'goal' | 'acceptance' | 'status' | 'provider' |
    'checkoutId' | 'prUrl'>>): Task {
    const task = this.task(id);
    if (!task) throw new Error('Task not found');
    const next = { ...task, updatedAt: Date.now() };
    for (const key of ['title', 'goal', 'acceptance', 'status', 'provider', 'checkoutId', 'prUrl'] as const) {
      if (input[key] !== undefined) (next as unknown as Record<string, unknown>)[key] = input[key];
    }
    next.title = required(next.title, 'Task title');
    next.goal = required(next.goal, 'Task goal');
    if (!taskStatuses.includes(next.status)) throw new Error('Invalid task status');
    if (this.checkout(next.checkoutId)?.projectId !== task.projectId) throw new Error('Checkout must belong to the project');
    if (['done', 'canceled', 'paused'].includes(next.status) && this.activeRuns().some((run) => run.taskId === id)) {
      throw new Error('Stop active runs before completing, canceling, or pausing this task');
    }
    this.db.prepare(`UPDATE tasks SET title=@title, goal=@goal, acceptance=@acceptance, status=@status,
      provider=@provider, checkoutId=@checkoutId, prUrl=@prUrl, updatedAt=@updatedAt WHERE id=@id`).run(next);
    return next;
  }

  createRun(input: { taskId: string; checkoutId?: string; provider?: string; kind: RunKind;
    requestId: string; prompt: string; codeRef?: string | null }): Run {
    return this.db.transaction(() => {
      const task = this.task(input.taskId);
      if (!task) throw new Error('Task not found');
      const checkoutId = input.checkoutId ?? task.checkoutId;
      const provider = input.provider ?? task.provider;
      const existing = this.db.prepare('SELECT * FROM runs WHERE requestId = ?').get(input.requestId) as Run | undefined;
      if (existing) {
        if (existing.taskId !== task.id || existing.checkoutId !== checkoutId || existing.provider !== provider ||
          existing.kind !== input.kind || existing.prompt !== input.prompt || existing.codeRef !== (input.codeRef ?? null)) {
          throw new Error('Request ID already belongs to a different run request');
        }
        return existing;
      }
      if (this.checkout(checkoutId)?.projectId !== task.projectId) throw new Error('Checkout must belong to the project');
      if (!runKinds.includes(input.kind)) throw new Error('Invalid run kind');
      const run: Run = { id: randomUUID(), taskId: task.id, checkoutId, provider, kind: input.kind, state: 'queued',
        requestId: required(input.requestId, 'Request ID'), prompt: input.prompt, nativeSessionId: null,
        codeRef: input.codeRef ?? null, eventCursor: 0, exitCode: null, signal: null, error: null,
        createdAt: Date.now(), startedAt: null, endedAt: null };
      this.db.prepare(`INSERT INTO runs VALUES (@id,@taskId,@checkoutId,@provider,@kind,@state,@requestId,@prompt,
        @nativeSessionId,@codeRef,@eventCursor,@exitCode,@signal,@error,@createdAt,@startedAt,@endedAt)`).run(run);
      return run;
    })();
  }

  activeRuns(): Run[] {
    return this.db.prepare(`SELECT * FROM runs WHERE state IN ('queued','starting','running','waiting','stopping')`)
      .all() as Run[];
  }

  updateRun(id: string, input: Partial<Pick<Run, 'state' | 'checkoutId' | 'nativeSessionId' | 'codeRef' |
    'exitCode' | 'signal' | 'error' | 'startedAt' | 'endedAt'>>): Run {
    const run = this.run(id);
    if (!run) throw new Error('Run not found');
    const next = { ...run };
    for (const key of ['state', 'checkoutId', 'nativeSessionId', 'codeRef', 'exitCode', 'signal', 'error',
      'startedAt', 'endedAt'] as const) {
      if (input[key] !== undefined) (next as unknown as Record<string, unknown>)[key] = input[key];
    }
    if (!runStates.includes(next.state)) throw new Error('Invalid run state');
    if (this.checkout(next.checkoutId)?.projectId !== this.task(run.taskId)?.projectId) throw new Error('Invalid run checkout');
    this.db.prepare(`UPDATE runs SET state=@state, checkoutId=@checkoutId, nativeSessionId=@nativeSessionId,
      codeRef=@codeRef, exitCode=@exitCode, signal=@signal, error=@error, startedAt=@startedAt, endedAt=@endedAt
      WHERE id=@id`).run(next);
    return next;
  }

  acquireCheckout(runId: string): void {
    const run = this.run(runId);
    if (!run || !ACTIVE_RUN_STATES.includes(run.state)) throw new Error('Run is not active');
    const lease = this.db.prepare('SELECT runId FROM checkout_leases WHERE checkoutId = ?').get(run.checkoutId) as
      { runId: string } | undefined;
    if (lease?.runId === run.id) return;
    if (lease) throw new Error(`Checkout is in use by run ${lease.runId}`);
    this.assertNoObservedWriter(run.checkoutId);
    this.db.prepare('INSERT INTO checkout_leases VALUES (?, ?)').run(run.checkoutId, run.id);
  }

  releaseCheckout(runId: string): void {
    const run = this.run(runId);
    // Lost ownership is not evidence that the process stopped writing this checkout.
    if (!run || ACTIVE_RUN_STATES.includes(run.state) || run.state === 'lost') throw new Error('Run exit is not confirmed');
    this.db.prepare('DELETE FROM checkout_leases WHERE runId = ?').run(runId);
  }

  ingestEvent(event: RunEvent, project: () => void = () => {}): boolean {
    return this.db.transaction(() => {
      const run = this.run(event.runId);
      if (!run) throw new Error('Run not found');
      if (!Number.isSafeInteger(event.seq) || event.seq < 1) throw new Error('Invalid event sequence');
      if (event.seq <= run.eventCursor) return false;
      if (event.seq !== run.eventCursor + 1) throw new Error('Event sequence gap');
      this.db.prepare('INSERT INTO run_events VALUES (?, ?, ?, ?, ?)')
        .run(event.runId, event.seq, event.time, event.type, JSON.stringify(event.data));
      project();
      this.db.prepare('UPDATE runs SET eventCursor = ? WHERE id = ?').run(event.seq, event.runId);
      return true;
    })();
  }

  events(runId: string, after = 0, limit = 200): RunEvent[] {
    if (!Number.isSafeInteger(after) || after < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 1000) {
      throw new Error('Invalid event cursor or limit');
    }
    const rows = this.db.prepare('SELECT * FROM run_events WHERE runId = ? AND seq > ? ORDER BY seq LIMIT ?')
      .all(runId, after, limit) as (Omit<RunEvent, 'data'> & { data: string })[];
    return rows.map((row) => ({ ...row, data: JSON.parse(row.data) }));
  }
}
