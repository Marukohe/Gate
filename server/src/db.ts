import BetterSqlite3 from 'better-sqlite3';
import { randomUUID } from 'crypto';

export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKeyPath?: string;
  defaultWorkingDir?: string;
  createdAt: number;
}

export interface Session {
  id: string;
  serverId: string;
  name: string;
  claudeSessionId: string | null;
  cliSessionId: string | null;
  provider: string;
  providerSessionMap: string | null; // JSON: { [provider]: cliSessionId }
  workingDir: string | null;
  chatStartedAt: number | null; // boundary timestamp: only show messages after this
  workspaceId: string | null;
  workspaceProbedAt: number | null;
  isHidden: boolean;
  actionKind: string | null;
  unreadCount: number;
  createdAt: number;
  lastActiveAt: number;
}

export interface Message {
  id: string;
  sessionId: string;
  type: 'assistant' | 'user' | 'tool_call' | 'tool_result' | 'system';
  content: string;
  toolName?: string;
  toolDetail?: string;
  timestamp: number;
  provider?: string | null;
}

export interface Checkpoint {
  id: string;
  sessionId: string;
  messageTimestamp: number;  // correlates to the user message timestamp
  gitRef: string;            // git tag name (e.g., "gate-cp-{sessionId}-{timestamp}")
  gitBranch: string;
  gitCommitSha: string;
  createdAt: number;
}

export interface Workspace {
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
}

export type WorkspaceStatus = 'backlog' | 'in-progress' | 'review' | 'done' | 'canceled';
export type WorkspacePrState = 'none' | 'open' | 'closed' | 'merged' | 'unknown';
export type SessionListOptions = { includeHidden?: boolean };
export type CreateSessionOptions = {
  workspaceId?: string | null;
  isHidden?: boolean;
  actionKind?: string | null;
};

export type CreateWorkspaceInput = Omit<
  Workspace,
  'id' | 'createdAt' | 'updatedAt' | 'autoOpenLastSession' | 'status' | 'goal' | 'pinnedAt' | 'archivedAt' | 'primarySessionId' | 'prUrl' | 'prState'
> & {
  autoOpenLastSession?: boolean;
  status?: WorkspaceStatus;
  goal?: string | null;
  pinnedAt?: number | null;
  archivedAt?: number | null;
  primarySessionId?: string | null;
  prUrl?: string | null;
  prState?: WorkspacePrState;
};
export type UpdateWorkspaceInput = Partial<Pick<
  Workspace,
  'name' | 'autoOpenLastSession' | 'defaultBranch' | 'remoteUrl' | 'status' | 'goal' | 'pinnedAt' | 'archivedAt' | 'primarySessionId' | 'prUrl' | 'prState'
>>;

export interface WorkspaceAggregate {
  totalSessionCount: number;
  lastActivityAt: number | null;
}

export type CreateServerInput = Omit<Server, 'id' | 'createdAt'>;
export type CreateMessageInput = Omit<Message, 'id'>;

export interface Database {
  createServer(input: CreateServerInput): Server;
  getServer(id: string): Server | undefined;
  listServers(): Server[];
  updateServer(id: string, updates: Partial<CreateServerInput>): void;
  deleteServer(id: string): void;
  createSession(serverId: string, name: string, workingDir?: string | null, provider?: string, options?: CreateSessionOptions): Session;
  getSession(id: string): Session | undefined;
  listSessions(serverId: string, options?: SessionListOptions): Session[];
  deleteSession(id: string): void;
  renameSession(id: string, name: string): void;
  updateSessionActivity(id: string): void;
  updateClaudeSessionId(id: string, claudeSessionId: string): void;
  updateCliSessionId(id: string, cliSessionId: string): void;
  updateSessionProvider(id: string, provider: string): void;
  clearCliSessionId(id: string): void;
  updateChatStartedAt(id: string, timestamp: number): void;
  getMessagesAfter(sessionId: string, afterTimestamp: number, limit?: number): Message[];
  getMessageCountAfter(sessionId: string, afterTimestamp: number): number;
  saveMessage(input: CreateMessageInput): Message;
  saveMessages(inputs: CreateMessageInput[]): Message[];
  deleteMessages(sessionId: string): void;
  getMessages(sessionId: string, limit?: number): Message[];
  getMessagesBefore(sessionId: string, beforeTimestamp: number, limit?: number): Message[];
  getMessageCount(sessionId: string): number;
  saveCheckpoint(sessionId: string, messageTimestamp: number, gitRef: string, gitBranch: string, gitCommitSha: string): Checkpoint;
  listCheckpoints(sessionId: string): Checkpoint[];
  deleteCheckpointsAfter(sessionId: string, afterTimestamp: number): void;
  createWorkspace(input: CreateWorkspaceInput): Workspace;
  listWorkspaces(): Workspace[];
  getWorkspace(id: string): Workspace | undefined;
  getWorkspaceByPath(serverId: string, repoPath: string): Workspace | undefined;
  upsertWorkspaceByPath(input: CreateWorkspaceInput): Workspace;
  updateWorkspace(id: string, updates: UpdateWorkspaceInput): void;
  deleteWorkspace(id: string): void;
  archiveWorkspace(id: string): void;
  restoreWorkspace(id: string): void;
  setSessionWorkspace(sessionId: string, workspaceId: string | null): void;
  setWorkspacePrimarySession(workspaceId: string, sessionId: string | null): void;
  markSessionProbed(sessionId: string): void;
  aggregateWorkspace(workspaceId: string): WorkspaceAggregate;
  close(): void;
}

type WorkspaceRow = Omit<Workspace, 'autoOpenLastSession'> & { autoOpenLastSession: number };
type SessionRow = Omit<Session, 'isHidden'> & { isHidden: number };

function mapWorkspaceRow(row: WorkspaceRow): Workspace {
  return {
    ...row,
    autoOpenLastSession: !!row.autoOpenLastSession,
    status: row.status ?? 'backlog',
    goal: row.goal ?? null,
    pinnedAt: row.pinnedAt ?? null,
    archivedAt: row.archivedAt ?? null,
    primarySessionId: row.primarySessionId ?? null,
    prUrl: row.prUrl ?? null,
    prState: row.prState ?? 'none',
  };
}

function mapSessionRow(row: SessionRow): Session {
  return {
    ...row,
    isHidden: !!row.isHidden,
    actionKind: row.actionKind ?? null,
    unreadCount: row.unreadCount ?? 0,
  };
}

export function createDb(dbPath: string): Database {
  const db = new BetterSqlite3(dbPath);

  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  // Base schema (CREATE TABLE IF NOT EXISTS) runs first so subsequent
  // ALTER TABLE migrations have something to alter on a fresh DB.
  db.exec(`
    CREATE TABLE IF NOT EXISTS servers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      host TEXT NOT NULL,
      port INTEGER DEFAULT 22,
      username TEXT NOT NULL,
      authType TEXT NOT NULL,
      password TEXT,
      privateKeyPath TEXT,
      defaultWorkingDir TEXT,
      createdAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      serverId TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
      tmuxSession TEXT NOT NULL DEFAULT '',
      name TEXT NOT NULL DEFAULT 'Default',
      claudeSessionId TEXT,
      cliSessionId TEXT,
      provider TEXT DEFAULT 'claude',
      providerSessionMap TEXT,
      chatStartedAt INTEGER,
      workingDir TEXT,
      createdAt INTEGER NOT NULL,
      lastActiveAt INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      type TEXT NOT NULL,
      content TEXT NOT NULL,
      toolName TEXT,
      toolDetail TEXT,
      timestamp INTEGER NOT NULL,
      provider TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_sessions_serverId ON sessions(serverId);
    CREATE INDEX IF NOT EXISTS idx_messages_sessionId ON messages(sessionId);
    CREATE INDEX IF NOT EXISTS idx_messages_sessionId_timestamp ON messages(sessionId, timestamp);
  `);

  // Migrations (idempotent — failures mean the column/table already exists).
  try { db.exec('ALTER TABLE sessions ADD COLUMN claudeSessionId TEXT'); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE sessions ADD COLUMN name TEXT DEFAULT 'Default'"); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sessions ADD COLUMN workingDir TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE servers ADD COLUMN defaultWorkingDir TEXT'); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE sessions ADD COLUMN provider TEXT DEFAULT 'claude'"); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sessions ADD COLUMN cliSessionId TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE messages ADD COLUMN provider TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sessions ADD COLUMN providerSessionMap TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sessions ADD COLUMN chatStartedAt INTEGER'); } catch { /* already exists */ }
  try { db.exec('UPDATE sessions SET cliSessionId = claudeSessionId WHERE cliSessionId IS NULL AND claudeSessionId IS NOT NULL'); } catch { /* ignore */ }
  try { db.exec(`CREATE TABLE IF NOT EXISTS checkpoints (
  id TEXT PRIMARY KEY,
  sessionId TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  messageTimestamp INTEGER NOT NULL,
  gitRef TEXT NOT NULL,
  gitBranch TEXT NOT NULL,
  gitCommitSha TEXT NOT NULL,
  createdAt INTEGER NOT NULL
)`); } catch { /* already exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_checkpoints_sessionId ON checkpoints(sessionId)'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sessions ADD COLUMN workspaceId TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sessions ADD COLUMN workspaceProbedAt INTEGER'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sessions ADD COLUMN isHidden INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sessions ADD COLUMN actionKind TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sessions ADD COLUMN unreadCount INTEGER NOT NULL DEFAULT 0'); } catch { /* already exists */ }
  try { db.exec(`CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  serverId TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  repoPath TEXT NOT NULL,
  remoteUrl TEXT,
  defaultBranch TEXT,
  name TEXT NOT NULL,
  autoOpenLastSession INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'backlog',
  goal TEXT,
  pinnedAt INTEGER,
  archivedAt INTEGER,
  primarySessionId TEXT,
  prUrl TEXT,
  prState TEXT NOT NULL DEFAULT 'none',
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(serverId, repoPath)
)`); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE workspaces ADD COLUMN status TEXT NOT NULL DEFAULT 'backlog'"); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE workspaces ADD COLUMN goal TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE workspaces ADD COLUMN pinnedAt INTEGER'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE workspaces ADD COLUMN archivedAt INTEGER'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE workspaces ADD COLUMN primarySessionId TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE workspaces ADD COLUMN prUrl TEXT'); } catch { /* already exists */ }
  try { db.exec("ALTER TABLE workspaces ADD COLUMN prState TEXT NOT NULL DEFAULT 'none'"); } catch { /* already exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_workspaces_serverId ON workspaces(serverId)'); } catch { /* already exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_workspaces_status ON workspaces(status)'); } catch { /* already exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_workspaces_archivedAt ON workspaces(archivedAt)'); } catch { /* already exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_workspaceId ON sessions(workspaceId)'); } catch { /* already exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_isHidden ON sessions(isHidden)'); } catch { /* already exists */ }

  return {
    createServer(input) {
      const id = randomUUID();
      const createdAt = Date.now();
      db.prepare(`
        INSERT INTO servers (id, name, host, port, username, authType, password, privateKeyPath, defaultWorkingDir, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.name, input.host, input.port, input.username, input.authType, input.password ?? null, input.privateKeyPath ?? null, input.defaultWorkingDir ?? null, createdAt);
      return { id, ...input, createdAt };
    },

    getServer(id) {
      return db.prepare('SELECT * FROM servers WHERE id = ?').get(id) as Server | undefined;
    },

    listServers() {
      return db.prepare('SELECT * FROM servers ORDER BY createdAt DESC').all() as Server[];
    },

    updateServer(id, updates) {
      const fields = Object.entries(updates).filter(([, v]) => v !== undefined);
      if (fields.length === 0) return;
      const setClauses = fields.map(([k]) => `${k} = ?`).join(', ');
      const values = fields.map(([, v]) => v);
      db.prepare(`UPDATE servers SET ${setClauses} WHERE id = ?`).run(...values, id);
    },

    deleteServer(id) {
      db.prepare('DELETE FROM servers WHERE id = ?').run(id);
    },

    createSession(serverId, name, workingDir?, provider?, options?) {
      const id = randomUUID();
      const now = Date.now();
      const dir = workingDir ?? null;
      const prov = provider ?? 'claude';
      db.prepare(`
        INSERT INTO sessions (id, serverId, name, tmuxSession, workingDir, provider, workspaceId, isHidden, actionKind, unreadCount, createdAt, lastActiveAt)
        VALUES (?, ?, ?, '', ?, ?, ?, ?, ?, 0, ?, ?)
      `).run(
        id, serverId, name, dir, prov,
        options?.workspaceId ?? null,
        options?.isHidden ? 1 : 0,
        options?.actionKind ?? null,
        now, now,
      );
      return {
        id, serverId, name,
        claudeSessionId: null, cliSessionId: null,
        provider: prov, providerSessionMap: null,
        workingDir: dir, chatStartedAt: null,
        workspaceId: options?.workspaceId ?? null,
        workspaceProbedAt: null,
        isHidden: !!options?.isHidden,
        actionKind: options?.actionKind ?? null,
        unreadCount: 0,
        createdAt: now, lastActiveAt: now,
      };
    },

    getSession(id) {
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow | undefined;
      return row ? mapSessionRow(row) : undefined;
    },

    listSessions(serverId, options) {
      const includeHidden = options?.includeHidden ?? false;
      const rows = includeHidden
        ? db.prepare('SELECT * FROM sessions WHERE serverId = ? ORDER BY lastActiveAt DESC').all(serverId) as SessionRow[]
        : db.prepare('SELECT * FROM sessions WHERE serverId = ? AND COALESCE(isHidden, 0) = 0 ORDER BY lastActiveAt DESC').all(serverId) as SessionRow[];
      return rows.map(mapSessionRow);
    },

    deleteSession(id) {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
    },

    renameSession(id, name) {
      db.prepare('UPDATE sessions SET name = ? WHERE id = ?').run(name, id);
    },

    updateSessionActivity(id) {
      db.prepare('UPDATE sessions SET lastActiveAt = ? WHERE id = ?').run(Date.now(), id);
    },

    updateClaudeSessionId(id, claudeSessionId) {
      db.prepare('UPDATE sessions SET claudeSessionId = ?, cliSessionId = ? WHERE id = ?').run(claudeSessionId, claudeSessionId, id);
    },

    updateCliSessionId(id, cliSessionId) {
      db.prepare('UPDATE sessions SET cliSessionId = ? WHERE id = ?').run(cliSessionId, id);
    },

    updateSessionProvider(id, provider) {
      const session = db.prepare('SELECT provider, cliSessionId, providerSessionMap FROM sessions WHERE id = ?').get(id) as
        { provider: string; cliSessionId: string | null; providerSessionMap: string | null } | undefined;
      if (!session) return;

      // Parse existing map or start fresh
      const map: Record<string, string> = session.providerSessionMap
        ? JSON.parse(session.providerSessionMap)
        : {};

      // Save current provider's session ID before switching
      const currentProvider = session.provider ?? 'claude';
      if (session.cliSessionId) {
        map[currentProvider] = session.cliSessionId;
      }

      // Restore target provider's saved session ID (if any)
      const restoredCliSessionId = map[provider] ?? null;

      db.prepare('UPDATE sessions SET provider = ?, cliSessionId = ?, providerSessionMap = ? WHERE id = ?')
        .run(provider, restoredCliSessionId, JSON.stringify(map), id);
    },

    clearCliSessionId(id) {
      const session = db.prepare('SELECT provider, providerSessionMap FROM sessions WHERE id = ?').get(id) as
        { provider: string; providerSessionMap: string | null } | undefined;
      if (!session) return;

      // Also remove from providerSessionMap so it won't be restored on switch
      const map: Record<string, string> = session.providerSessionMap
        ? JSON.parse(session.providerSessionMap)
        : {};
      delete map[session.provider ?? 'claude'];

      db.prepare('UPDATE sessions SET cliSessionId = NULL, claudeSessionId = NULL, providerSessionMap = ? WHERE id = ?')
        .run(JSON.stringify(map), id);
    },

    updateChatStartedAt(id, timestamp) {
      db.prepare('UPDATE sessions SET chatStartedAt = ? WHERE id = ?').run(timestamp, id);
    },

    getMessagesAfter(sessionId, afterTimestamp, limit = 100) {
      return db.prepare(`
        SELECT * FROM (
          SELECT * FROM messages WHERE sessionId = ? AND timestamp >= ? ORDER BY timestamp DESC LIMIT ?
        ) ORDER BY timestamp ASC
      `).all(sessionId, afterTimestamp, limit) as Message[];
    },

    getMessageCountAfter(sessionId, afterTimestamp) {
      const row = db.prepare('SELECT COUNT(*) as count FROM messages WHERE sessionId = ? AND timestamp >= ?').get(sessionId, afterTimestamp) as { count: number };
      return row.count;
    },

    saveMessage(input) {
      const id = randomUUID();
      db.prepare(`
        INSERT INTO messages (id, sessionId, type, content, toolName, toolDetail, timestamp, provider)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(id, input.sessionId, input.type, input.content, input.toolName ?? null, input.toolDetail ?? null, input.timestamp, input.provider ?? null);
      return { id, ...input };
    },

    saveMessages(inputs) {
      const insert = db.prepare(`
        INSERT INTO messages (id, sessionId, type, content, toolName, toolDetail, timestamp, provider)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const tx = db.transaction((items: CreateMessageInput[]) => {
        const results: Message[] = [];
        for (const input of items) {
          const id = randomUUID();
          insert.run(id, input.sessionId, input.type, input.content, input.toolName ?? null, input.toolDetail ?? null, input.timestamp, input.provider ?? null);
          results.push({ id, ...input });
        }
        return results;
      });
      return tx(inputs);
    },

    deleteMessages(sessionId) {
      db.prepare('DELETE FROM messages WHERE sessionId = ?').run(sessionId);
    },

    getMessages(sessionId, limit = 100) {
      // Subquery picks the N most-recent rows, outer query re-orders them chronologically
      return db.prepare(`
        SELECT * FROM (
          SELECT * FROM messages WHERE sessionId = ? ORDER BY timestamp DESC LIMIT ?
        ) ORDER BY timestamp ASC
      `).all(sessionId, limit) as Message[];
    },

    getMessagesBefore(sessionId, beforeTimestamp, limit = 100) {
      return db.prepare(`
        SELECT * FROM (
          SELECT * FROM messages WHERE sessionId = ? AND timestamp < ? ORDER BY timestamp DESC LIMIT ?
        ) ORDER BY timestamp ASC
      `).all(sessionId, beforeTimestamp, limit) as Message[];
    },

    getMessageCount(sessionId) {
      const row = db.prepare('SELECT COUNT(*) as count FROM messages WHERE sessionId = ?').get(sessionId) as { count: number };
      return row.count;
    },

    saveCheckpoint(sessionId, messageTimestamp, gitRef, gitBranch, gitCommitSha) {
      const id = randomUUID();
      const createdAt = Date.now();
      db.prepare(`
        INSERT INTO checkpoints (id, sessionId, messageTimestamp, gitRef, gitBranch, gitCommitSha, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, sessionId, messageTimestamp, gitRef, gitBranch, gitCommitSha, createdAt);
      return { id, sessionId, messageTimestamp, gitRef, gitBranch, gitCommitSha, createdAt };
    },

    listCheckpoints(sessionId) {
      return db.prepare('SELECT * FROM checkpoints WHERE sessionId = ? ORDER BY messageTimestamp ASC').all(sessionId) as Checkpoint[];
    },

    deleteCheckpointsAfter(sessionId, afterTimestamp) {
      db.prepare('DELETE FROM checkpoints WHERE sessionId = ? AND messageTimestamp > ?').run(sessionId, afterTimestamp);
    },

    createWorkspace(input) {
      const id = randomUUID();
      const now = Date.now();
      db.prepare(`
        INSERT INTO workspaces (
          id, serverId, repoPath, remoteUrl, defaultBranch, name,
          autoOpenLastSession, status, goal, pinnedAt, archivedAt,
          primarySessionId, prUrl, prState, createdAt, updatedAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.serverId, input.repoPath,
        input.remoteUrl ?? null, input.defaultBranch ?? null, input.name,
        input.autoOpenLastSession ? 1 : 0,
        input.status ?? 'backlog',
        input.goal ?? null,
        input.pinnedAt ?? null,
        input.archivedAt ?? null,
        input.primarySessionId ?? null,
        input.prUrl ?? null,
        input.prState ?? 'none',
        now, now,
      );
      return {
        id, serverId: input.serverId, repoPath: input.repoPath,
        remoteUrl: input.remoteUrl ?? null, defaultBranch: input.defaultBranch ?? null,
        name: input.name, autoOpenLastSession: !!input.autoOpenLastSession,
        status: input.status ?? 'backlog',
        goal: input.goal ?? null,
        pinnedAt: input.pinnedAt ?? null,
        archivedAt: input.archivedAt ?? null,
        primarySessionId: input.primarySessionId ?? null,
        prUrl: input.prUrl ?? null,
        prState: input.prState ?? 'none',
        createdAt: now, updatedAt: now,
      };
    },

    listWorkspaces() {
      const rows = db.prepare('SELECT * FROM workspaces ORDER BY COALESCE(pinnedAt, 0) DESC, updatedAt DESC').all() as WorkspaceRow[];
      return rows.map(mapWorkspaceRow);
    },

    getWorkspace(id) {
      const r = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as WorkspaceRow | undefined;
      return r ? mapWorkspaceRow(r) : undefined;
    },

    getWorkspaceByPath(serverId, repoPath) {
      const r = db.prepare('SELECT * FROM workspaces WHERE serverId = ? AND repoPath = ?').get(serverId, repoPath) as WorkspaceRow | undefined;
      return r ? mapWorkspaceRow(r) : undefined;
    },

    upsertWorkspaceByPath(input) {
      const existing = this.getWorkspaceByPath(input.serverId, input.repoPath);
      if (existing) return existing;
      return this.createWorkspace(input);
    },

    updateWorkspace(id, updates) {
      const fields = Object.entries(updates).filter(([, v]) => v !== undefined);
      if (fields.length === 0) return;
      const setClauses = fields.map(([k]) => `${k} = ?`).join(', ');
      const values = fields.map(([k, v]) => k === 'autoOpenLastSession' ? (v ? 1 : 0) : v);
      values.push(Date.now());
      db.prepare(`UPDATE workspaces SET ${setClauses}, updatedAt = ? WHERE id = ?`).run(...values, id);
    },

    deleteWorkspace(id) {
      // The sessions FK doesn't carry an ON DELETE CASCADE clause (it was added
      // via ALTER TABLE), so cascade by hand inside one transaction.
      const tx = db.transaction(() => {
        db.prepare('DELETE FROM sessions WHERE workspaceId = ?').run(id);
        db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
      });
      tx();
    },

    archiveWorkspace(id) {
      db.prepare(`UPDATE workspaces SET archivedAt = ?, updatedAt = ? WHERE id = ?`).run(Date.now(), Date.now(), id);
    },

    restoreWorkspace(id) {
      db.prepare('UPDATE workspaces SET archivedAt = NULL, updatedAt = ? WHERE id = ?').run(Date.now(), id);
    },

    setSessionWorkspace(sessionId, workspaceId) {
      db.prepare('UPDATE sessions SET workspaceId = ? WHERE id = ?').run(workspaceId, sessionId);
    },

    setWorkspacePrimarySession(workspaceId, sessionId) {
      db.prepare('UPDATE workspaces SET primarySessionId = ?, updatedAt = ? WHERE id = ?').run(sessionId, Date.now(), workspaceId);
    },

    markSessionProbed(sessionId) {
      db.prepare('UPDATE sessions SET workspaceProbedAt = ? WHERE id = ?').run(Date.now(), sessionId);
    },

    aggregateWorkspace(workspaceId) {
      const row = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM sessions WHERE workspaceId = ? AND COALESCE(isHidden, 0) = 0) AS totalSessionCount,
          (SELECT MAX(m.timestamp)
             FROM messages m
             JOIN sessions s ON s.id = m.sessionId
             WHERE s.workspaceId = ? AND COALESCE(s.isHidden, 0) = 0) AS lastActivityAt
      `).get(workspaceId, workspaceId) as { totalSessionCount: number; lastActivityAt: number | null };
      return {
        totalSessionCount: row.totalSessionCount,
        lastActivityAt: row.lastActivityAt,
      };
    },

    close() {
      db.close();
    },
  };
}
