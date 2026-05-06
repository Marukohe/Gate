# Phase A: Workspace Abstraction + Command Center Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Status:** Historical baseline plan. The current codebase contains the Phase A workspace foundation; the checkbox state below is stale and should not be used as the source of truth for new product work.

**Follow-up:** Use `docs/superpowers/plans/2026-05-06-helmor-aligned-workspace-surface.md` for the next Helmor-aligned workspace surface pass.

**Goal:** Promote remote git repositories to a first-class `Workspace` concept, restructure the sidebar to be workspace-centric, and add a Command Center landing page that aggregates running agents and workspaces. Spec: `docs/superpowers/specs/2026-04-30-workspace-and-command-center-design.md`.

**Architecture:** SQLite gains a `workspaces` table; sessions get `workspaceId` + `workspaceProbedAt` columns. WebSocket protocol gains workspace CRUD + a lazy-migration step on every successful connect (probes the working dir's git common-dir on the remote and upserts/links a workspace). Frontend gains a `workspace-store`, a workspace-centric Sidebar, an `AddWorkspaceDialog`, a `WorkspaceHome` page, and a `CommandCenter` landing page; `App.tsx` switches from server-first to workspace-first routing.

**Tech Stack:** TypeScript, better-sqlite3, ssh2 (via existing `SSHManager`), Express + ws, React + zustand + Tailwind + shadcn/ui, Vitest.

---

## File Map

### New files
- `server/src/__tests__/ssh-probe.test.ts` — unit tests for the git-probe stdout parser
- `client/src/stores/workspace-store.ts` — zustand store for workspaces + active workspace state
- `client/src/components/workspace/AddWorkspaceDialog.tsx` — pick server + browse to repo + name
- `client/src/components/workspace/WorkspaceHome.tsx` — workspace landing page (sessions, worktrees, settings)
- `client/src/components/home/CommandCenter.tsx` — global landing: active-runs strip + workspace grid

### Modified files
- `server/src/db.ts` — `workspaces` table, sessions migration, CRUD, aggregation
- `server/src/__tests__/db.test.ts` — workspace + session linkage tests
- `server/src/ssh-manager.ts` — `probeGitRepo` + exported pure parser
- `server/src/ws-handler.ts` — workspace CRUD messages, lazy probe-and-link in `connect`
- `client/src/stores/session-store.ts` — `workspaceId` field, selectors
- `client/src/hooks/use-websocket.ts` — workspace request/response handlers
- `client/src/components/layout/Sidebar.tsx` — workspace-top-level layout, Loose sessions footer
- `client/src/components/layout/AppShell.tsx` — pass through workspace handlers
- `client/src/components/chat/CreateSessionDialog.tsx` — adapt for workspace context (hide workingDir when given)
- `client/src/App.tsx` — workspace fetch on mount, route between Command Center / Workspace Home / Chat

---

## Task 1: DB schema — `workspaces` table + sessions columns

**Files:**
- Modify: `server/src/db.ts`
- Test: `server/src/__tests__/db.test.ts`

- [ ] **Step 1: Write failing test for table existence and column migration**

Add to `server/src/__tests__/db.test.ts` (inside `describe('Database', ...)`, after the existing `messages` block):

```typescript
  describe('workspaces schema', () => {
    it('creates a workspace row with all expected fields', () => {
      const server = db.createServer({ name: 'S1', host: '10.0.0.1', port: 22, username: 'root', authType: 'password', password: 'p' });
      const ws = db.createWorkspace({
        serverId: server.id,
        repoPath: '/home/user/proj',
        remoteUrl: 'git@github.com:foo/bar.git',
        defaultBranch: 'main',
        name: 'proj',
      });
      expect(ws.id).toBeDefined();
      expect(ws.serverId).toBe(server.id);
      expect(ws.repoPath).toBe('/home/user/proj');
      expect(ws.remoteUrl).toBe('git@github.com:foo/bar.git');
      expect(ws.defaultBranch).toBe('main');
      expect(ws.name).toBe('proj');
      expect(ws.autoOpenLastSession).toBe(false);
      expect(typeof ws.createdAt).toBe('number');
      expect(typeof ws.updatedAt).toBe('number');
    });

    it('adds workspaceId and workspaceProbedAt columns to sessions', () => {
      const server = db.createServer({ name: 'S1', host: '10.0.0.1', port: 22, username: 'root', authType: 'password', password: 'p' });
      const session = db.createSession(server.id, 'test');
      expect(session.workspaceId ?? null).toBeNull();
      expect(session.workspaceProbedAt ?? null).toBeNull();
    });
  });
```

- [ ] **Step 2: Run the test and verify it fails**

```bash
cd server && npx vitest run src/__tests__/db.test.ts
```

Expected: FAIL — `db.createWorkspace is not a function` (and possibly a column-not-found if the test inspects `workspaceId` from a fresh DB).

- [ ] **Step 3: Add Workspace interface + extend Session + Database interfaces**

In `server/src/db.ts`, after the `Checkpoint` interface:

```typescript
export interface Workspace {
  id: string;
  serverId: string;
  repoPath: string;
  remoteUrl: string | null;
  defaultBranch: string | null;
  name: string;
  autoOpenLastSession: boolean;
  createdAt: number;
  updatedAt: number;
}

export type CreateWorkspaceInput = Omit<Workspace, 'id' | 'createdAt' | 'updatedAt' | 'autoOpenLastSession'> & {
  autoOpenLastSession?: boolean;
};
export type UpdateWorkspaceInput = Partial<Pick<Workspace, 'name' | 'autoOpenLastSession' | 'defaultBranch' | 'remoteUrl'>>;

export interface WorkspaceAggregate {
  totalSessionCount: number;
  lastActivityAt: number | null;
}
```

In the `Session` interface, add two fields:

```typescript
  workspaceId: string | null;
  workspaceProbedAt: number | null;
```

In the `Database` interface, add (just before `close()`):

```typescript
  createWorkspace(input: CreateWorkspaceInput): Workspace;
  listWorkspaces(): Workspace[];
  getWorkspace(id: string): Workspace | undefined;
  getWorkspaceByPath(serverId: string, repoPath: string): Workspace | undefined;
  upsertWorkspaceByPath(input: CreateWorkspaceInput): Workspace;
  updateWorkspace(id: string, updates: UpdateWorkspaceInput): void;
  deleteWorkspace(id: string): void;
  setSessionWorkspace(sessionId: string, workspaceId: string | null): void;
  markSessionProbed(sessionId: string): void;
  aggregateWorkspace(workspaceId: string): WorkspaceAggregate;
```

- [ ] **Step 4: Add migrations and CREATE TABLE for workspaces**

In `server/src/db.ts`, in `createDb`, add these migration lines alongside the existing `try/catch` ALTER TABLE block (after the existing `idx_checkpoints_sessionId` block):

```typescript
  try { db.exec('ALTER TABLE sessions ADD COLUMN workspaceId TEXT'); } catch { /* already exists */ }
  try { db.exec('ALTER TABLE sessions ADD COLUMN workspaceProbedAt INTEGER'); } catch { /* already exists */ }
  try { db.exec(`CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  serverId TEXT NOT NULL REFERENCES servers(id) ON DELETE CASCADE,
  repoPath TEXT NOT NULL,
  remoteUrl TEXT,
  defaultBranch TEXT,
  name TEXT NOT NULL,
  autoOpenLastSession INTEGER NOT NULL DEFAULT 0,
  createdAt INTEGER NOT NULL,
  updatedAt INTEGER NOT NULL,
  UNIQUE(serverId, repoPath)
)`); } catch { /* already exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_workspaces_serverId ON workspaces(serverId)'); } catch { /* already exists */ }
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_workspaceId ON sessions(workspaceId)'); } catch { /* already exists */ }
```

Update the existing `getSession` and `listSessions` row mapping so `workspaceId` and `workspaceProbedAt` come through (they will because `SELECT *` is used; but TypeScript needs the cast — verify by reading the row shape). The existing `createSession` constructs the return object literally; update it to add `workspaceId: null, workspaceProbedAt: null`:

```typescript
    createSession(serverId, name, workingDir?, provider?) {
      const id = randomUUID();
      const now = Date.now();
      const dir = workingDir ?? null;
      const prov = provider ?? 'claude';
      db.prepare(`
        INSERT INTO sessions (id, serverId, name, tmuxSession, workingDir, provider, createdAt, lastActiveAt)
        VALUES (?, ?, ?, '', ?, ?, ?, ?)
      `).run(id, serverId, name, dir, prov, now, now);
      return {
        id, serverId, name,
        claudeSessionId: null, cliSessionId: null,
        provider: prov, providerSessionMap: null,
        workingDir: dir, chatStartedAt: null,
        workspaceId: null, workspaceProbedAt: null,
        createdAt: now, lastActiveAt: now,
      };
    },
```

- [ ] **Step 5: Stub workspace methods so the file still compiles (return values to be implemented in Task 2)**

In the returned object literal in `createDb`, add these stubs at the bottom (just before `close()`):

```typescript
    createWorkspace() { throw new Error('not implemented'); },
    listWorkspaces() { return []; },
    getWorkspace() { return undefined; },
    getWorkspaceByPath() { return undefined; },
    upsertWorkspaceByPath() { throw new Error('not implemented'); },
    updateWorkspace() { /* not implemented */ },
    deleteWorkspace() { /* not implemented */ },
    setSessionWorkspace() { /* not implemented */ },
    markSessionProbed() { /* not implemented */ },
    aggregateWorkspace() { return { totalSessionCount: 0, lastActivityAt: null }; },
```

These stubs let Task 1's schema-only test pass while leaving full method tests for Task 2/3.

- [ ] **Step 6: Run tests; expect schema test to pass and the createWorkspace test to fail**

```bash
cd server && npx vitest run src/__tests__/db.test.ts
```

Expected: the "adds workspaceId and workspaceProbedAt columns to sessions" test PASSES; "creates a workspace row with all expected fields" FAILS with `Error: not implemented`. This is correct — Task 2 implements the body.

- [ ] **Step 7: Commit**

```bash
git add server/src/db.ts server/src/__tests__/db.test.ts
git commit -m "feat(db): add workspaces table and workspaceId/workspaceProbedAt session columns

Schema-only change: introduces a workspaces table keyed by
(serverId, repoPath) and adds nullable workspaceId / workspaceProbedAt
columns to sessions. CRUD method stubs are placeholders so the file
compiles; bodies land in the next commit."
```

---

## Task 2: Implement workspace CRUD

**Files:**
- Modify: `server/src/db.ts`
- Test: `server/src/__tests__/db.test.ts`

- [ ] **Step 1: Add CRUD tests**

In `server/src/__tests__/db.test.ts` add a `describe('workspaces CRUD', ...)` block:

```typescript
  describe('workspaces CRUD', () => {
    it('lists workspaces and looks up by (serverId, repoPath)', () => {
      const s = db.createServer({ name: 'S', host: 'h', port: 22, username: 'u', authType: 'password', password: 'p' });
      const a = db.createWorkspace({ serverId: s.id, repoPath: '/a', remoteUrl: null, defaultBranch: 'main', name: 'a' });
      const b = db.createWorkspace({ serverId: s.id, repoPath: '/b', remoteUrl: null, defaultBranch: 'main', name: 'b' });
      const list = db.listWorkspaces();
      expect(list.map((w) => w.id).sort()).toEqual([a.id, b.id].sort());
      expect(db.getWorkspaceByPath(s.id, '/a')?.id).toBe(a.id);
      expect(db.getWorkspaceByPath(s.id, '/missing')).toBeUndefined();
    });

    it('upsert returns existing row when (serverId, repoPath) matches', () => {
      const s = db.createServer({ name: 'S', host: 'h', port: 22, username: 'u', authType: 'password', password: 'p' });
      const a = db.upsertWorkspaceByPath({ serverId: s.id, repoPath: '/a', remoteUrl: null, defaultBranch: 'main', name: 'a' });
      const b = db.upsertWorkspaceByPath({ serverId: s.id, repoPath: '/a', remoteUrl: 'git@x', defaultBranch: 'dev', name: 'renamed' });
      expect(b.id).toBe(a.id);
      // Existing row preserved, no fields overwritten on upsert
      expect(b.name).toBe('a');
      expect(b.defaultBranch).toBe('main');
    });

    it('updateWorkspace patches name and autoOpenLastSession', () => {
      const s = db.createServer({ name: 'S', host: 'h', port: 22, username: 'u', authType: 'password', password: 'p' });
      const a = db.createWorkspace({ serverId: s.id, repoPath: '/a', remoteUrl: null, defaultBranch: 'main', name: 'a' });
      db.updateWorkspace(a.id, { name: 'renamed', autoOpenLastSession: true });
      const got = db.getWorkspace(a.id)!;
      expect(got.name).toBe('renamed');
      expect(got.autoOpenLastSession).toBe(true);
    });

    it('deleteWorkspace cascades to sessions', () => {
      const s = db.createServer({ name: 'S', host: 'h', port: 22, username: 'u', authType: 'password', password: 'p' });
      const w = db.createWorkspace({ serverId: s.id, repoPath: '/a', remoteUrl: null, defaultBranch: 'main', name: 'a' });
      const sess = db.createSession(s.id, 'sess');
      db.setSessionWorkspace(sess.id, w.id);
      db.deleteWorkspace(w.id);
      expect(db.getWorkspace(w.id)).toBeUndefined();
      expect(db.getSession(sess.id)).toBeUndefined();
    });

    it('rejects duplicate (serverId, repoPath)', () => {
      const s = db.createServer({ name: 'S', host: 'h', port: 22, username: 'u', authType: 'password', password: 'p' });
      db.createWorkspace({ serverId: s.id, repoPath: '/a', remoteUrl: null, defaultBranch: 'main', name: 'a' });
      expect(() => db.createWorkspace({ serverId: s.id, repoPath: '/a', remoteUrl: null, defaultBranch: 'main', name: 'a2' })).toThrow();
    });
  });
```

- [ ] **Step 2: Run tests, verify failures**

```bash
cd server && npx vitest run src/__tests__/db.test.ts
```

Expected: 5 new tests FAIL (`Error: not implemented` from the stubs).

- [ ] **Step 3: Implement workspace CRUD in `db.ts`**

Replace the stubs added in Task 1 with:

```typescript
    createWorkspace(input) {
      const id = randomUUID();
      const now = Date.now();
      db.prepare(`
        INSERT INTO workspaces (id, serverId, repoPath, remoteUrl, defaultBranch, name, autoOpenLastSession, createdAt, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, input.serverId, input.repoPath,
        input.remoteUrl ?? null, input.defaultBranch ?? null, input.name,
        input.autoOpenLastSession ? 1 : 0, now, now,
      );
      return {
        id, serverId: input.serverId, repoPath: input.repoPath,
        remoteUrl: input.remoteUrl ?? null, defaultBranch: input.defaultBranch ?? null,
        name: input.name, autoOpenLastSession: !!input.autoOpenLastSession,
        createdAt: now, updatedAt: now,
      };
    },

    listWorkspaces() {
      const rows = db.prepare('SELECT * FROM workspaces ORDER BY updatedAt DESC').all() as any[];
      return rows.map((r) => ({ ...r, autoOpenLastSession: !!r.autoOpenLastSession })) as Workspace[];
    },

    getWorkspace(id) {
      const r = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as any | undefined;
      if (!r) return undefined;
      return { ...r, autoOpenLastSession: !!r.autoOpenLastSession } as Workspace;
    },

    getWorkspaceByPath(serverId, repoPath) {
      const r = db.prepare('SELECT * FROM workspaces WHERE serverId = ? AND repoPath = ?').get(serverId, repoPath) as any | undefined;
      if (!r) return undefined;
      return { ...r, autoOpenLastSession: !!r.autoOpenLastSession } as Workspace;
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
      values.push(Date.now() as any);
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
```

- [ ] **Step 4: Run tests, verify passes**

```bash
cd server && npx vitest run src/__tests__/db.test.ts
```

Expected: all `workspaces CRUD` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/db.ts server/src/__tests__/db.test.ts
git commit -m "feat(db): implement workspace CRUD with cascade delete"
```

---

## Task 3: Session ↔ workspace linkage + aggregateWorkspace

**Files:**
- Modify: `server/src/db.ts`
- Test: `server/src/__tests__/db.test.ts`

- [ ] **Step 1: Add tests**

In `server/src/__tests__/db.test.ts`, append:

```typescript
  describe('session-workspace linkage', () => {
    it('setSessionWorkspace links and unlinks', () => {
      const s = db.createServer({ name: 'S', host: 'h', port: 22, username: 'u', authType: 'password', password: 'p' });
      const w = db.createWorkspace({ serverId: s.id, repoPath: '/a', remoteUrl: null, defaultBranch: 'main', name: 'a' });
      const sess = db.createSession(s.id, 't');
      db.setSessionWorkspace(sess.id, w.id);
      expect(db.getSession(sess.id)?.workspaceId).toBe(w.id);
      db.setSessionWorkspace(sess.id, null);
      expect(db.getSession(sess.id)?.workspaceId).toBeNull();
    });

    it('markSessionProbed sets workspaceProbedAt', () => {
      const s = db.createServer({ name: 'S', host: 'h', port: 22, username: 'u', authType: 'password', password: 'p' });
      const sess = db.createSession(s.id, 't');
      const before = Date.now();
      db.markSessionProbed(sess.id);
      const after = Date.now();
      const got = db.getSession(sess.id)!;
      expect(got.workspaceProbedAt).not.toBeNull();
      expect(got.workspaceProbedAt!).toBeGreaterThanOrEqual(before);
      expect(got.workspaceProbedAt!).toBeLessThanOrEqual(after);
    });

    it('aggregateWorkspace returns counts and lastActivityAt', () => {
      const s = db.createServer({ name: 'S', host: 'h', port: 22, username: 'u', authType: 'password', password: 'p' });
      const w = db.createWorkspace({ serverId: s.id, repoPath: '/a', remoteUrl: null, defaultBranch: 'main', name: 'a' });
      const a = db.createSession(s.id, 'a');
      const b = db.createSession(s.id, 'b');
      db.setSessionWorkspace(a.id, w.id);
      db.setSessionWorkspace(b.id, w.id);
      db.saveMessage({ sessionId: a.id, type: 'assistant', content: 'x', timestamp: 100 });
      db.saveMessage({ sessionId: b.id, type: 'assistant', content: 'y', timestamp: 200 });
      const agg = db.aggregateWorkspace(w.id);
      expect(agg.totalSessionCount).toBe(2);
      expect(agg.lastActivityAt).toBe(200);
    });

    it('aggregateWorkspace returns null lastActivityAt when no messages', () => {
      const s = db.createServer({ name: 'S', host: 'h', port: 22, username: 'u', authType: 'password', password: 'p' });
      const w = db.createWorkspace({ serverId: s.id, repoPath: '/a', remoteUrl: null, defaultBranch: 'main', name: 'a' });
      const agg = db.aggregateWorkspace(w.id);
      expect(agg.totalSessionCount).toBe(0);
      expect(agg.lastActivityAt).toBeNull();
    });
  });
```

- [ ] **Step 2: Run tests, verify failures**

```bash
cd server && npx vitest run src/__tests__/db.test.ts
```

Expected: 4 new tests FAIL.

- [ ] **Step 3: Implement methods**

Replace the stubs in `db.ts`:

```typescript
    setSessionWorkspace(sessionId, workspaceId) {
      db.prepare('UPDATE sessions SET workspaceId = ? WHERE id = ?').run(workspaceId, sessionId);
    },

    markSessionProbed(sessionId) {
      db.prepare('UPDATE sessions SET workspaceProbedAt = ? WHERE id = ?').run(Date.now(), sessionId);
    },

    aggregateWorkspace(workspaceId) {
      const row = db.prepare(`
        SELECT
          (SELECT COUNT(*) FROM sessions WHERE workspaceId = ?) AS totalSessionCount,
          (SELECT MAX(m.timestamp)
             FROM messages m
             JOIN sessions s ON s.id = m.sessionId
             WHERE s.workspaceId = ?) AS lastActivityAt
      `).get(workspaceId, workspaceId) as { totalSessionCount: number; lastActivityAt: number | null };
      return {
        totalSessionCount: row.totalSessionCount,
        lastActivityAt: row.lastActivityAt,
      };
    },
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd server && npx vitest run src/__tests__/db.test.ts
```

Expected: all `session-workspace linkage` tests PASS.

- [ ] **Step 5: Commit**

```bash
git add server/src/db.ts server/src/__tests__/db.test.ts
git commit -m "feat(db): add session-workspace link methods and aggregateWorkspace"
```

---

## Task 4: SSH probe — `probeGitRepo` + pure parser

**Files:**
- Modify: `server/src/ssh-manager.ts`
- Create: `server/src/__tests__/ssh-probe.test.ts`

- [ ] **Step 1: Write failing test for the pure parser**

Create `server/src/__tests__/ssh-probe.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { parseGitProbeOutput } from '../ssh-manager.js';

describe('parseGitProbeOutput', () => {
  it('parses a happy path with all four lines', () => {
    const stdout = [
      '/home/user/proj',                   // toplevel (sanity)
      '/home/user/proj/.git',              // git-common-dir
      'git@github.com:foo/bar.git',        // remote.origin.url
      'refs/remotes/origin/main',          // origin/HEAD symref
    ].join('\n');
    const result = parseGitProbeOutput(stdout);
    expect(result).toEqual({
      canonicalPath: '/home/user/proj',
      remoteUrl: 'git@github.com:foo/bar.git',
      defaultBranch: 'main',
    });
  });

  it('strips a worktree suffix from git-common-dir to find the main repo', () => {
    // Secondary worktree: --git-common-dir points back to main repo's .git
    const stdout = [
      '/home/user/proj-wt-feat',
      '/home/user/proj/.git',
      '',
      'refs/remotes/origin/main',
    ].join('\n');
    const result = parseGitProbeOutput(stdout);
    expect(result?.canonicalPath).toBe('/home/user/proj');
    expect(result?.remoteUrl).toBeNull();
    expect(result?.defaultBranch).toBe('main');
  });

  it('returns null when toplevel is missing (non-git directory)', () => {
    expect(parseGitProbeOutput('')).toBeNull();
    expect(parseGitProbeOutput('\n\n\n')).toBeNull();
  });

  it('falls back to current branch line when origin/HEAD is absent', () => {
    const stdout = [
      '/home/user/proj',
      '/home/user/proj/.git',
      '',
      'feature/x',                          // last line is the fallback branch
    ].join('\n');
    const result = parseGitProbeOutput(stdout);
    expect(result?.defaultBranch).toBe('feature/x');
  });

  it('handles git-common-dir reported as relative ".git"', () => {
    const stdout = [
      '/home/user/proj',
      '.git',
      '',
      'refs/remotes/origin/main',
    ].join('\n');
    const result = parseGitProbeOutput(stdout);
    // Falls back to toplevel when common-dir is relative
    expect(result?.canonicalPath).toBe('/home/user/proj');
  });
});
```

- [ ] **Step 2: Run test and verify it fails**

```bash
cd server && npx vitest run src/__tests__/ssh-probe.test.ts
```

Expected: FAIL — `parseGitProbeOutput is not exported`.

- [ ] **Step 3: Implement the parser and probe in ssh-manager.ts**

In `server/src/ssh-manager.ts`, near the top (after the `shellCd` helper) add:

```typescript
export interface GitProbeResult {
  canonicalPath: string;
  remoteUrl: string | null;
  defaultBranch: string | null;
}

/**
 * Parse the output of the four-line git probe command.
 * Stdin (stdout-like) lines are, in order:
 *  1. `git rev-parse --show-toplevel`
 *  2. `git rev-parse --path-format=absolute --git-common-dir`
 *  3. `git config --get remote.origin.url`  (may be empty)
 *  4. either `git symbolic-ref refs/remotes/origin/HEAD` (e.g. refs/remotes/origin/main)
 *     or `git rev-parse --abbrev-ref HEAD` (e.g. main) as fallback
 *
 * Returns null when toplevel is empty (non-git working dir).
 */
export function parseGitProbeOutput(stdout: string): GitProbeResult | null {
  const lines = stdout.split('\n').map((l) => l.trim());
  const toplevel = lines[0] || '';
  if (!toplevel) return null;

  const commonDirRaw = lines[1] || '';
  // For a main worktree, `--git-common-dir` is `<repo>/.git`; for a secondary
  // worktree it points at the same `<main-repo>/.git`. Stripping `/.git` (or
  // a trailing `.git`) yields the canonical main worktree path.
  let canonicalPath = toplevel;
  if (commonDirRaw && commonDirRaw.startsWith('/')) {
    canonicalPath = commonDirRaw.replace(/\/?\.git\/?$/, '') || toplevel;
  }

  const remoteUrl = (lines[2] || '').trim() || null;

  let defaultBranch: string | null = null;
  const branchLine = lines[3] || '';
  if (branchLine.startsWith('refs/remotes/origin/')) {
    defaultBranch = branchLine.replace(/^refs\/remotes\/origin\//, '');
  } else if (branchLine) {
    defaultBranch = branchLine;
  }

  return { canonicalPath, remoteUrl, defaultBranch };
}
```

In the `SSHManager` class (near `fetchGitInfo`), add:

```typescript
  /**
   * Probe a remote working dir to identify its git repository.
   * Returns null for non-git dirs. Batches four git commands in one round-trip.
   */
  async probeGitRepo(serverId: string, workingDir: string): Promise<GitProbeResult | null> {
    const cd = shellCd(workingDir);
    // `|| true` ensures missing remote / detached HEAD don't make the script exit early
    const cmd = `${cd} && (git rev-parse --show-toplevel 2>/dev/null; ` +
      `git rev-parse --path-format=absolute --git-common-dir 2>/dev/null; ` +
      `git config --get remote.origin.url 2>/dev/null || echo ''; ` +
      `git symbolic-ref refs/remotes/origin/HEAD 2>/dev/null || git rev-parse --abbrev-ref HEAD 2>/dev/null)`;
    try {
      const out = await this.execCommand(serverId, cmd);
      return parseGitProbeOutput(out);
    } catch {
      return null;
    }
  }
```

- [ ] **Step 4: Run tests, verify pass**

```bash
cd server && npx vitest run src/__tests__/ssh-probe.test.ts
```

Expected: all 5 tests PASS.

- [ ] **Step 5: Type-check the server**

```bash
cd server && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add server/src/ssh-manager.ts server/src/__tests__/ssh-probe.test.ts
git commit -m "feat(ssh): add probeGitRepo and pure parseGitProbeOutput parser"
```

---

## Task 5: WS protocol — workspace CRUD message handlers

**Files:**
- Modify: `server/src/ws-handler.ts`

- [ ] **Step 1: Extend the `ClientMessage` and `ServerMessage` unions**

In `server/src/ws-handler.ts`, replace the `ClientMessage` interface's `type` union to add the new kinds, and extend the body:

```typescript
interface ClientMessage {
  type:
    | 'connect' | 'input' | 'interrupt' | 'disconnect'
    | 'create-session' | 'delete-session'
    | 'fetch-git-info' | 'list-branches' | 'switch-branch'
    | 'exec' | 'sync-transcript'
    | 'list-claude-sessions' | 'list-cli-sessions'
    | 'load-more' | 'switch-provider' | 'reset-conversation' | 'resume-cli-session'
    | 'fetch-git-status' | 'fetch-git-diff' | 'fetch-pr-info' | 'git-commit' | 'git-create-pr'
    | 'revert-to-checkpoint' | 'list-checkpoints'
    | 'list-workspaces' | 'create-workspace' | 'delete-workspace' | 'update-workspace';
  serverId?: string;       // workspace messages may not have a serverId
  sessionId?: string;
  sessionName?: string;
  workingDir?: string;
  text?: string;
  branch?: string;
  command?: string;
  claudeSessionId?: string;
  beforeTimestamp?: number;
  provider?: string;
  message?: string;
  files?: string[];
  title?: string;
  body?: string;
  diffArgs?: string;
  checkpointId?: string;

  // workspace messages
  workspaceId?: string;
  repoPath?: string;
  workspaceName?: string;
  autoOpenLastSession?: boolean;
}
```

In the `ServerMessage` interface, add the workspace types to the union:

```typescript
interface ServerMessage {
  type:
    | 'message' | 'status' | 'history' | 'history-prepend' | 'sessions'
    | 'git-info' | 'branches' | 'sync-result'
    | 'claude-sessions' | 'cli-sessions'
    | 'git-status' | 'git-diff' | 'pr-info' | 'git-commit-result' | 'git-create-pr-result'
    | 'checkpoints' | 'checkpoint-reverted'
    | 'workspace-list' | 'workspace-update' | 'workspace-deleted' | 'session-update' | 'workspace-error';
  serverId?: string;
  sessionId?: string | null;
  [key: string]: any;
}
```

(`serverId` becomes optional because workspace messages aren't scoped to a server.)

- [ ] **Step 2: Add a helper to build `WorkspaceWithAggregates`**

Above `setupWebSocket`, add:

```typescript
import type { Workspace } from './db.js';

export interface WorkspaceWithAggregates extends Workspace {
  totalSessionCount: number;
  lastActivityAt: number | null;
  activeSessionCount: number;
  dirtyFileCount: number | null;
}

async function buildWorkspaceWithAggregates(
  ws: Workspace, db: Database, sshManager: SSHManager,
): Promise<WorkspaceWithAggregates> {
  const agg = db.aggregateWorkspace(ws.id);
  // Count active SSH channels for sessions in this workspace.
  const sessions = db.listSessions(ws.serverId).filter((s) => s.workspaceId === ws.id);
  let activeSessionCount = 0;
  for (const s of sessions) {
    if (sshManager.hasActiveChannel(ws.serverId, s.id)) activeSessionCount += 1;
  }
  // Cheap dirty count: only attempt when SSH is already connected to avoid
  // forcing a connect on every list-workspaces. Counts non-empty porcelain lines.
  let dirtyFileCount: number | null = null;
  if (sshManager.isConnected(ws.serverId)) {
    try {
      const raw = await sshManager.fetchGitStatus(ws.serverId, ws.repoPath);
      dirtyFileCount = raw.split('\n').filter((l) => l.length > 0).length;
    } catch {
      dirtyFileCount = null;
    }
  }
  return { ...ws, ...agg, activeSessionCount, dirtyFileCount };
}
```

- [ ] **Step 3: Add the four message cases**

Inside the existing `switch (msg.type)` in `setupWebSocket`'s `ws.on('message', ...)` handler, add new cases (place them after the `interrupt` case to group with control messages). Note: in this file the inbound WebSocket connection is named `ws` (see `wss.on('connection', (ws: WebSocket) => { ... })` near line 160) — use `ws.send(...)` to reply to the originating client and `broadcast(wss, ...)` to fan out to everyone. Avoid naming any local variable `ws` inside these case blocks (it would shadow the outgoing socket); use `workspace` instead.

```typescript
          case 'list-workspaces': {
            const workspaces = db.listWorkspaces();
            const enriched = await Promise.all(workspaces.map((w) => buildWorkspaceWithAggregates(w, db, sshManager)));
            ws.send(JSON.stringify({ type: 'workspace-list', workspaces: enriched }));
            break;
          }

          case 'create-workspace': {
            if (!msg.serverId || !msg.repoPath) {
              ws.send(JSON.stringify({ type: 'workspace-error', error: 'serverId and repoPath required' }));
              break;
            }
            try {
              await sshManager.ensureConnected(msg.serverId);
            } catch (err: any) {
              ws.send(JSON.stringify({ type: 'workspace-error', error: `SSH connect failed: ${err.message}` }));
              break;
            }
            const probe = await sshManager.probeGitRepo(msg.serverId, msg.repoPath);
            if (!probe) {
              ws.send(JSON.stringify({ type: 'workspace-error', error: `Path is not a git repository: ${msg.repoPath}` }));
              break;
            }
            const workspace = db.upsertWorkspaceByPath({
              serverId: msg.serverId,
              repoPath: probe.canonicalPath,
              remoteUrl: probe.remoteUrl,
              defaultBranch: probe.defaultBranch,
              name: msg.workspaceName?.trim() || probe.canonicalPath.split('/').filter(Boolean).pop() || 'workspace',
            });
            const enriched = await buildWorkspaceWithAggregates(workspace, db, sshManager);
            broadcast(wss, { type: 'workspace-update', workspace: enriched });
            break;
          }

          case 'delete-workspace': {
            if (!msg.workspaceId) break;
            const workspace = db.getWorkspace(msg.workspaceId);
            if (!workspace) break;
            // Stop any active channels for sessions in this workspace
            const wsSessions = db.listSessions(workspace.serverId).filter((s) => s.workspaceId === workspace.id);
            for (const s of wsSessions) {
              if (sshManager.hasActiveChannel(workspace.serverId, s.id)) sshManager.stopSession(workspace.serverId, s.id);
              parsers.delete(s.id);
            }
            db.deleteWorkspace(msg.workspaceId);
            broadcast(wss, { type: 'workspace-deleted', workspaceId: msg.workspaceId, removedSessionIds: wsSessions.map((s) => s.id) });
            break;
          }

          case 'update-workspace': {
            if (!msg.workspaceId) break;
            db.updateWorkspace(msg.workspaceId, {
              name: msg.workspaceName,
              autoOpenLastSession: msg.autoOpenLastSession,
            });
            const updated = db.getWorkspace(msg.workspaceId);
            if (updated) {
              const enriched = await buildWorkspaceWithAggregates(updated, db, sshManager);
              broadcast(wss, { type: 'workspace-update', workspace: enriched });
            }
            break;
          }
```

- [ ] **Step 4: Type-check**

```bash
cd server && npx tsc --noEmit
```

Expected: no errors.

- [ ] **Step 5: Run all server tests**

```bash
cd server && npx vitest run
```

Expected: all existing tests still pass; no new tests added in this task (handler logic is best verified through manual smoke testing in Task 14).

- [ ] **Step 6: Commit**

```bash
git add server/src/ws-handler.ts
git commit -m "feat(ws): add workspace CRUD message handlers and aggregation broadcast"
```

---

## Task 6: WS — lazy probe-and-link on `connect`

**Files:**
- Modify: `server/src/ws-handler.ts`

- [ ] **Step 1: Add probe-and-link in the `connect` handler**

Open `server/src/ws-handler.ts` and locate the existing `case 'connect': { ... }` block. The current code ends with an async `fetchGitInfo` block, then a `break;`:

```typescript
            // Async fetch git info if session has a workingDir
            if (session.workingDir) {
              sshManager.fetchGitInfo(server.id, session.workingDir).then((info) => {
                if (info) {
                  broadcast(wss, { type: 'git-info', serverId: server.id, sessionId, ...info });
                }
              }).catch(() => {});
            }
            break;
          }
```

Insert the probe-and-link block immediately *before* `break;`, after the `fetchGitInfo` call:

```typescript
            // Lazy workspace migration: probe git once per session and link
            // it to a workspace. Skip if already linked or already probed.
            if (session.workingDir && session.workspaceId === null && session.workspaceProbedAt === null) {
              try {
                const probe = await sshManager.probeGitRepo(server.id, session.workingDir);
                if (probe) {
                  const linkedWs = db.upsertWorkspaceByPath({
                    serverId: server.id,
                    repoPath: probe.canonicalPath,
                    remoteUrl: probe.remoteUrl,
                    defaultBranch: probe.defaultBranch,
                    name: probe.canonicalPath.split('/').filter(Boolean).pop() || 'workspace',
                  });
                  db.setSessionWorkspace(session.id, linkedWs.id);
                  const enriched = await buildWorkspaceWithAggregates(linkedWs, db, sshManager);
                  broadcast(wss, { type: 'workspace-update', workspace: enriched });
                  const refreshed = db.getSession(session.id);
                  if (refreshed) broadcast(wss, { type: 'session-update', session: refreshed });
                }
              } catch {
                /* probe failure is non-fatal */
              }
              // Mark probed regardless of outcome so we don't retry on every connect.
              // Once workspaceId is set, this is harmless; once it's null, this prevents
              // re-probing non-git working dirs.
              db.markSessionProbed(session.id);
            }
```

Note: the existing `case 'connect'` block uses `sessionId` (a local already extracted earlier in the case) and `server` (from `db.getServer(msg.serverId)`). Reuse those names to match style. The variable `linkedWs` (not `ws`) is used here because `ws` is the WebSocket connection parameter from the outer `wss.on('connection', (ws: WebSocket) => { ws.on('message', ...) })` (around line 160 in `ws-handler.ts`) — naming a local `ws` would shadow it.

- [ ] **Step 2: Type-check**

```bash
cd server && npx tsc --noEmit
```

Expected: no errors. (If `db.getSession(session.id)` return shape conflicts with `Session`, accept the cast as-is — `getSession` returns `Session | undefined`.)

- [ ] **Step 3: Run all server tests**

```bash
cd server && npx vitest run
```

Expected: all pass.

- [ ] **Step 4: Commit**

```bash
git add server/src/ws-handler.ts
git commit -m "feat(ws): probe git and auto-link sessions to workspaces on connect"
```

---

## Task 7: Client — workspace-store + session-store extension

**Files:**
- Create: `client/src/stores/workspace-store.ts`
- Modify: `client/src/stores/session-store.ts`

- [ ] **Step 1: Add `workspaceId` and `workspaceProbedAt` to the client `Session` interface**

In `client/src/stores/session-store.ts`, replace the `Session` interface:

```typescript
export interface Session {
  id: string;
  serverId: string;
  name: string;
  claudeSessionId: string | null;
  cliSessionId: string | null;
  provider: string;
  workingDir: string | null;
  workspaceId: string | null;
  workspaceProbedAt: number | null;
  createdAt: number;
  lastActiveAt: number;
}
```

Add two selectors at the bottom of the store object literal (just before the closing `}` of the create call's first arg):

```typescript
      sessionsByWorkspace: (workspaceId) => {
        const all: Session[] = [];
        for (const list of Object.values(get().sessions)) {
          for (const s of list) if (s.workspaceId === workspaceId) all.push(s);
        }
        return all;
      },
      looseSessionsByServer: (serverId) => {
        return (get().sessions[serverId] ?? []).filter((s) => s.workspaceId === null);
      },
      updateSession: (serverId, session) => set((s) => {
        const list = s.sessions[serverId] ?? [];
        const next = list.map((x) => x.id === session.id ? session : x);
        return { sessions: { ...s.sessions, [serverId]: next } };
      }),
```

In `SessionStore` interface, add the matching method signatures:

```typescript
  sessionsByWorkspace: (workspaceId: string) => Session[];
  looseSessionsByServer: (serverId: string) => Session[];
  updateSession: (serverId: string, session: Session) => void;
```

- [ ] **Step 2: Create `workspace-store.ts`**

Create `client/src/stores/workspace-store.ts`:

```typescript
import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface WorkspaceWithAggregates {
  id: string;
  serverId: string;
  repoPath: string;
  remoteUrl: string | null;
  defaultBranch: string | null;
  name: string;
  autoOpenLastSession: boolean;
  createdAt: number;
  updatedAt: number;
  totalSessionCount: number;
  lastActivityAt: number | null;
  activeSessionCount: number;
  dirtyFileCount: number | null;
}

interface WorkspaceStore {
  workspaces: Record<string, WorkspaceWithAggregates>;
  activeWorkspaceId: string | null;
  setWorkspaces: (list: WorkspaceWithAggregates[]) => void;
  upsertWorkspace: (ws: WorkspaceWithAggregates) => void;
  removeWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string | null) => void;
  list: () => WorkspaceWithAggregates[];
  getForSession: (workspaceId: string | null) => WorkspaceWithAggregates | undefined;
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set, get) => ({
      workspaces: {},
      activeWorkspaceId: null,
      setWorkspaces: (list) => set({
        workspaces: Object.fromEntries(list.map((w) => [w.id, w])),
      }),
      upsertWorkspace: (ws) => set((s) => ({
        workspaces: { ...s.workspaces, [ws.id]: ws },
      })),
      removeWorkspace: (id) => set((s) => {
        const { [id]: _drop, ...rest } = s.workspaces;
        return {
          workspaces: rest,
          activeWorkspaceId: s.activeWorkspaceId === id ? null : s.activeWorkspaceId,
        };
      }),
      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
      list: () => Object.values(get().workspaces).sort((a, b) =>
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
```

- [ ] **Step 3: Type-check the client**

```bash
cd client && npx tsc --noEmit
```

Expected: errors will exist for now because consumers (e.g. `App.tsx`) haven't been updated to use the new fields. You can run `tsc` from the client directory after each task to track progress; it's expected to be red until Task 13.

- [ ] **Step 4: Commit**

```bash
git add client/src/stores/workspace-store.ts client/src/stores/session-store.ts
git commit -m "feat(client): add workspace-store and extend session-store with workspaceId"
```

---

## Task 8: `use-websocket` — workspace request/response handlers

**Files:**
- Modify: `client/src/hooks/use-websocket.ts`

- [ ] **Step 1: Add request methods**

In `client/src/hooks/use-websocket.ts`, near the other `useCallback` hooks (e.g. before `disconnectSession`), add:

```typescript
  const listWorkspaces = useCallback(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'list-workspaces' }));
  }, []);

  const createWorkspace = useCallback((serverId: string, repoPath: string, name?: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'create-workspace', serverId, repoPath, workspaceName: name }));
  }, []);

  const deleteWorkspace = useCallback((workspaceId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'delete-workspace', workspaceId }));
  }, []);

  const updateWorkspace = useCallback((workspaceId: string, updates: { name?: string; autoOpenLastSession?: boolean }) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'update-workspace',
      workspaceId,
      workspaceName: updates.name,
      autoOpenLastSession: updates.autoOpenLastSession,
    }));
  }, []);
```

Add `listWorkspaces, createWorkspace, deleteWorkspace, updateWorkspace` to the `return { ... }` at the bottom of `useWebSocket`.

- [ ] **Step 2: Add response handlers in the WS message handler**

In `setupSocket()`, in the `socket.onmessage` handler's switch/if-chain over `data.type`, add:

```typescript
        if (data.type === 'workspace-list') {
          // import at top of file: import { useWorkspaceStore } from '../stores/workspace-store';
          useWorkspaceStore.getState().setWorkspaces(data.workspaces ?? []);
          return;
        }
        if (data.type === 'workspace-update') {
          if (data.workspace) useWorkspaceStore.getState().upsertWorkspace(data.workspace);
          return;
        }
        if (data.type === 'workspace-deleted') {
          useWorkspaceStore.getState().removeWorkspace(data.workspaceId);
          // Drop any sessions returned in removedSessionIds from the session-store
          const removedIds: string[] = data.removedSessionIds ?? [];
          if (removedIds.length > 0) {
            const sessionStore = useSessionStore.getState();
            const all = sessionStore.sessions;
            for (const [serverId, list] of Object.entries(all)) {
              for (const s of list) {
                if (removedIds.includes(s.id)) sessionStore.removeSession(serverId, s.id);
              }
            }
          }
          return;
        }
        if (data.type === 'session-update') {
          // session-update carries the full Session row after probe-and-link
          if (data.session) {
            useSessionStore.getState().updateSession(data.session.serverId, data.session);
          }
          return;
        }
```

Add these imports at the top of `use-websocket.ts` (the file does not currently import `sonner`):

```typescript
import { toast } from 'sonner';
import { useWorkspaceStore } from '../stores/workspace-store';
```

Add a workspace-error handler alongside the others:

```typescript
        if (data.type === 'workspace-error') {
          toast.error(data.error ?? 'Workspace error');
          return;
        }
```

Update the `stores()` helper to include workspace if useful (optional):

```typescript
function stores() {
  return {
    session: useSessionStore.getState(),
    chat: useChatStore.getState(),
    planMode: usePlanModeStore.getState(),
    git: useGitStore.getState(),
    workspace: useWorkspaceStore.getState(),
  };
}
```

- [ ] **Step 3: Smoke build the client**

```bash
cd client && npx tsc --noEmit
```

Expected: still red because `App.tsx` consumers haven't been updated. Confirm at least there are no new errors in `use-websocket.ts` or `workspace-store.ts`.

- [ ] **Step 4: Commit**

```bash
git add client/src/hooks/use-websocket.ts
git commit -m "feat(client): wire workspace WS messages through use-websocket and workspace-store"
```

---

## Task 9: AddWorkspaceDialog component

**Files:**
- Create: `client/src/components/workspace/AddWorkspaceDialog.tsx`

- [ ] **Step 1: Create the directory and component file**

```bash
mkdir -p client/src/components/workspace
```

- [ ] **Step 2: Implement the dialog**

Create `client/src/components/workspace/AddWorkspaceDialog.tsx`:

```typescript
import { useState, useEffect, useCallback } from 'react';
import { Folder } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RemoteDirPicker, type BrowseResult } from '@/components/RemoteDirPicker';
import { useServerStore } from '@/stores/server-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { toast } from 'sonner';

interface AddWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddWorkspaceDialog({ open, onOpenChange }: AddWorkspaceDialogProps) {
  const servers = useServerStore((s) => s.servers);
  const [serverId, setServerId] = useState<string>('');
  const [repoPath, setRepoPath] = useState('');
  const [name, setName] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const { createWorkspace } = useWebSocket();

  useEffect(() => {
    if (open) {
      setServerId(servers[0]?.id ?? '');
      setRepoPath('');
      setName('');
    }
  }, [open, servers]);

  // Auto-fill name from basename of repoPath
  useEffect(() => {
    if (!name && repoPath) {
      const base = repoPath.split('/').filter(Boolean).pop();
      if (base) setName(base);
    }
  }, [repoPath, name]);

  const fetchDirs = useCallback(async (path: string): Promise<BrowseResult> => {
    if (!serverId) throw new Error('Pick a server first');
    const res = await fetch(`/api/servers/${serverId}/browse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw new Error('Browse failed');
    return res.json();
  }, [serverId]);

  const createDir = useCallback(async (parentPath: string, dirName: string): Promise<string> => {
    if (!serverId) throw new Error('Pick a server first');
    const res = await fetch(`/api/servers/${serverId}/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentPath, name: dirName }),
    });
    if (!res.ok) throw new Error('Failed to create folder');
    const data = await res.json();
    return data.path;
  }, [serverId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverId || !repoPath.trim()) {
      toast.error('Server and repo path are required');
      return;
    }
    createWorkspace(serverId, repoPath.trim(), name.trim() || undefined);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add workspace</DialogTitle>
            <DialogDescription>Pick a server and the root of a remote git repository.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Server</span>
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
              >
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
                {servers.length === 0 && <option value="">(no servers)</option>}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Repository path</span>
              <div className="flex gap-2">
                <Input
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder="/home/user/my-repo"
                  className="flex-1"
                  readOnly
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setPickerOpen(true)}
                  disabled={!serverId}
                >
                  <Folder className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Name</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="auto from path"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit">Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <RemoteDirPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={setRepoPath}
        fetchDirs={fetchDirs}
        createDir={createDir}
        initialPath={repoPath}
      />
    </>
  );
}
```

The `workspace-error` toast is already wired up in Task 8 alongside the other workspace handlers — no extra work here.

- [ ] **Step 3: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: file-local errors should be 0; the project still has unresolved consumers in `App.tsx` (Task 13 fixes those).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/workspace/AddWorkspaceDialog.tsx
git commit -m "feat(workspace): add AddWorkspaceDialog with server + remote dir picker"
```

---

## Task 10: Sidebar restructure (workspace top-level + Loose footer)

**Files:**
- Modify: `client/src/components/layout/Sidebar.tsx`

- [ ] **Step 1: Replace the top-level iteration**

This is a substantial rewrite of the rendering loop. The exterior shell, notifications dropdown, dark-mode toggle, and AlertDialog stay. Replace the body inside the `<div className={cn('overflow-y-auto px-2 space-y-1', !isMobile && 'flex-1')}>` block with workspace-centric rendering.

Replace `client/src/components/layout/Sidebar.tsx`'s rendering core (the part that maps over `servers` and renders sessions inside each) with the following structure. Keep the imports, helpers, and bottom toolbar untouched; modify the imports to add workspace-store and add an "Add workspace" callback prop.

At the top of the file, add:

```typescript
import { useWorkspaceStore, type WorkspaceWithAggregates } from '@/stores/workspace-store';
import { GitBranch as GitBranchIcon } from 'lucide-react';
```

Update `SidebarProps`:

```typescript
interface SidebarProps {
  onAddServer: () => void;
  onEditServer: (server: ServerType) => void;
  onSelectSession?: (serverId: string, sessionId: string) => void;
  onSelectWorkspace?: (workspaceId: string) => void;
  onAddWorkspace?: () => void;
  onClose?: () => void;
}
```

Inside `Sidebar`, replace the existing `servers.map(...)` block with this rendering: a flat list of workspaces (each with its sessions nested), followed by a "Loose sessions" footer grouped per server.

```tsx
        <div className={cn('overflow-y-auto px-2 space-y-1', !isMobile && 'flex-1')}>
          {/* Header row with Add workspace */}
          <div className="flex items-center justify-between px-1 pt-1 pb-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Workspaces</span>
            {onAddWorkspace && (
              <button
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => { onAddWorkspace(); onClose?.(); }}
                title="Add workspace"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Workspace list */}
          {useWorkspaceStore.getState().list().map((ws) => {
            const workspaceSessions = (allSessions[ws.serverId] ?? []).filter((s) => s.workspaceId === ws.id);
            const expanded = !collapsed[`ws:${ws.id}`];
            const anyActive = workspaceSessions.some((s) => isAgentWorking(agentStatus[s.id]));
            const server = servers.find((sv) => sv.id === ws.serverId);
            return (
              <div key={ws.id}>
                <button
                  className={cn(
                    'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                    'text-foreground/70 hover:bg-accent/50 hover:text-accent-foreground',
                  )}
                  onClick={() => { onSelectWorkspace?.(ws.id); onClose?.(); }}
                >
                  <span
                    role="button"
                    className="shrink-0 text-muted-foreground/60 p-0.5 -m-0.5 rounded hover:bg-accent"
                    onClick={(e) => { e.stopPropagation(); toggleCollapse(`ws:${ws.id}`); }}
                  >
                    {workspaceSessions.length === 0 || !expanded
                      ? <ChevronRight className="h-3.5 w-3.5" />
                      : <ChevronDown className="h-3.5 w-3.5" />}
                  </span>
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium text-xs">{ws.name}</span>
                      {anyActive && <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {server?.name ?? '?'}
                      {ws.defaultBranch && (<><span className="mx-1">·</span><GitBranchIcon className="inline h-2.5 w-2.5 mr-0.5" />{ws.defaultBranch}</>)}
                    </div>
                  </div>
                </button>
                {expanded && workspaceSessions.length > 0 && (
                  <div className="ml-5 mt-1 border-l border-border/50 pl-0 space-y-px">
                    {workspaceSessions.map((session) => {
                      const isActiveSession = currentActiveSessionId === session.id;
                      const agent = agentStatus[session.id];
                      const git = gitInfo[session.id];
                      const dirName = session.name;
                      const label = agentLabel(agent);
                      const isWorktree = git?.worktree && git.worktree !== ws.repoPath;

                      return (
                        <button
                          key={session.id}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-r-md pl-3 pr-2 py-1.5 text-xs transition-colors',
                            isActiveSession
                              ? 'bg-primary/10 text-primary border-l-2 border-primary -ml-px'
                              : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                          )}
                          onClick={() => { onSelectSession?.(session.serverId, session.id); onClose?.(); }}
                        >
                          {isWorktree
                            ? <GitBranchIcon className={cn('h-3.5 w-3.5 shrink-0', isActiveSession ? 'text-primary' : 'text-muted-foreground/60')} />
                            : <FolderOpen className={cn('h-3.5 w-3.5 shrink-0', isActiveSession ? 'text-primary' : 'text-muted-foreground/60')} />}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-medium">{dirName}</span>
                              {isAgentWorking(agent) ? (
                                <span className={cn('agent-dots shrink-0', agentDotsColor(agent))}>
                                  <span /><span /><span />
                                </span>
                              ) : (
                                <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', agentDot(agent))} />
                              )}
                            </div>
                            {(git || label) && (
                              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                                {git && (
                                  <span className="flex items-center gap-0.5 truncate">
                                    <GitBranchIcon className="h-2.5 w-2.5 shrink-0" />
                                    {git.branch}
                                  </span>
                                )}
                                {label && (
                                  <span className={cn(
                                    'truncate',
                                    agent?.state === 'thinking' && 'text-blue-500',
                                    agent?.state === 'tool_call' && 'text-purple-500',
                                  )}>
                                    {label}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Loose sessions footer (per server) */}
          {servers.map((server) => {
            const loose = (allSessions[server.id] ?? []).filter((s) => s.workspaceId === null);
            if (loose.length === 0) return null;
            const expanded = !collapsed[`loose:${server.id}`];
            return (
              <div key={`loose-${server.id}`} className="mt-3">
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                  onClick={() => toggleCollapse(`loose:${server.id}`)}
                >
                  {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  <Server className="h-3.5 w-3.5" />
                  <span className="truncate">Loose · {server.name}</span>
                  <span className="ml-auto text-[10px]">{loose.length}</span>
                </button>
                {expanded && (
                  <div className="ml-5 mt-1 border-l border-border/50 pl-0 space-y-px">
                    {loose.map((session) => {
                      const isActiveSession = currentActiveSessionId === session.id;
                      return (
                        <button
                          key={session.id}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-r-md pl-3 pr-2 py-1.5 text-xs transition-colors',
                            isActiveSession
                              ? 'bg-primary/10 text-primary border-l-2 border-primary -ml-px'
                              : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                          )}
                          onClick={() => { onSelectSession?.(server.id, session.id); onClose?.(); }}
                        >
                          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                          <span className="truncate flex-1">{session.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
```

Note: The "+ Server" button at the bottom and the notifications/darkmode controls stay; we removed only the per-server `<button>` rendering. Move the existing `useWorkspaceStore` import and `onSelectWorkspace`/`onAddWorkspace` callback wiring through props. Make `setActiveServer` calls happen inside `onSelectWorkspace`'s parent (in `App.tsx`, Task 13).

The previous "Servers" header text in the top of the sidebar should be replaced. The block:

```tsx
        {!isMobile && (
          <div className="px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Servers
          </div>
        )}
```

becomes:

```tsx
        {!isMobile && (
          <div className="px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Workspaces
          </div>
        )}
```

The mobile `<SheetTitle>Servers</SheetTitle>` should become `Workspaces` in `AppShell.tsx` — but that change is Task 13.

- [ ] **Step 2: Subscribe to workspace store changes (re-render on update)**

Calling `s.list()` inside a selector creates a new array on every render and would thrash. Subscribe to the raw map and memoize:

```typescript
  const workspaceMap = useWorkspaceStore((s) => s.workspaces);
  const workspaceList = useMemo(
    () => Object.values(workspaceMap).sort((a, b) => (b.lastActivityAt ?? b.updatedAt) - (a.lastActivityAt ?? a.updatedAt)),
    [workspaceMap],
  );
```

Add `import { useMemo } from 'react';` at the top. In the rendering JSX use `workspaceList.map(...)` (replacing the `useWorkspaceStore.getState().list().map(...)` line written above).

- [ ] **Step 3: Build the client and check the sidebar at least compiles**

```bash
cd client && npx tsc --noEmit
```

Expected: file-local errors should be 0 (consumers in `App.tsx` updated in Task 13; the missing prop `onSelectWorkspace`/`onAddWorkspace` will trigger errors there).

- [ ] **Step 4: Commit**

```bash
git add client/src/components/layout/Sidebar.tsx
git commit -m "feat(sidebar): switch to workspace-top-level with Loose sessions footer"
```

---

## Task 11: WorkspaceHome component

**Files:**
- Create: `client/src/components/workspace/WorkspaceHome.tsx`

- [ ] **Step 1: Implement the page**

Create `client/src/components/workspace/WorkspaceHome.tsx`:

```typescript
import { GitBranch, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSessionStore } from '@/stores/session-store';
import { useServerStore } from '@/stores/server-store';
import { useWebSocket } from '@/hooks/use-websocket';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useState } from 'react';

interface WorkspaceHomeProps {
  workspaceId: string;
  onNewSession: () => void;
  onSelectSession: (serverId: string, sessionId: string) => void;
}

export function WorkspaceHome({ workspaceId, onNewSession, onSelectSession }: WorkspaceHomeProps) {
  const ws = useWorkspaceStore((s) => s.workspaces[workspaceId]);
  const sessions = useSessionStore((s) => s.sessionsByWorkspace(workspaceId));
  const gitInfo = useSessionStore((s) => s.gitInfo);
  const agentStatus = useSessionStore((s) => s.agentStatus);
  const serverName = useServerStore((s) => s.servers.find((sv) => sv.id === ws?.serverId)?.name ?? '');
  const { updateWorkspace, deleteWorkspace } = useWebSocket();
  const [confirmDelete, setConfirmDelete] = useState(false);

  function relativeTime(ts: number | null | undefined): string {
    if (!ts) return '—';
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
  function isWorking(s?: { state: string }): boolean {
    return !!s && (s.state === 'thinking' || s.state === 'tool_call');
  }

  if (!ws) {
    return <div className="p-8 text-sm text-muted-foreground">Workspace not found.</div>;
  }

  // Map each non-main-checkout worktree path to the sessions bound to it
  const worktreeBindings = (() => {
    const map = new Map<string, string[]>();
    for (const s of sessions) {
      const wt = gitInfo[s.id]?.worktree;
      if (wt && wt !== ws?.repoPath) {
        const existing = map.get(wt) ?? [];
        existing.push(s.name);
        map.set(wt, existing);
      }
    }
    return Array.from(map.entries()).map(([path, names]) => ({ path, sessions: names }));
  })();

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b px-6 py-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <h1 className="truncate text-xl font-semibold">{ws.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{serverName || 'server'}</span>
              {ws.defaultBranch && (<><span>·</span><span className="flex items-center gap-1"><GitBranch className="h-3 w-3" />{ws.defaultBranch}</span></>)}
              {ws.remoteUrl && (<><span>·</span><a href={ws.remoteUrl} target="_blank" rel="noreferrer" className="underline">{ws.remoteUrl}</a></>)}
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">{ws.repoPath}</div>
          </div>
          <Button size="sm" onClick={onNewSession}>
            <Plus className="h-4 w-4" /> New session
          </Button>
        </div>
      </div>

      <section className="px-6 py-4">
        <h2 className="text-sm font-semibold mb-2">Sessions ({sessions.length})</h2>
        {sessions.length === 0 ? (
          <div className="text-xs text-muted-foreground">No sessions yet.</div>
        ) : (
          <ul className="divide-y rounded border">
            {sessions.map((s) => {
              const git = gitInfo[s.id];
              const status = agentStatus[s.id];
              const working = isWorking(status);
              const isWorktree = git?.worktree && git.worktree !== ws.repoPath;
              return (
                <li key={s.id}>
                  <button
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent/50"
                    onClick={() => onSelectSession(s.serverId, s.id)}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${working ? (status?.state === 'tool_call' ? 'bg-purple-500' : 'bg-blue-500') : 'bg-muted-foreground/40'}`} />
                    <span className="truncate flex-1">{s.name}</span>
                    {isWorktree && git && (
                      <span className="text-[11px] text-muted-foreground font-mono truncate max-w-[180px]" title={git.worktree}>{git.worktree}</span>
                    )}
                    {git && (
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1"><GitBranch className="h-3 w-3" />{git.branch}</span>
                    )}
                    <span className="text-[11px] text-muted-foreground shrink-0">{relativeTime(s.lastActiveAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {worktreeBindings.length > 0 && (
        <section className="px-6 py-4">
          <h2 className="text-sm font-semibold mb-2">Worktrees ({worktreeBindings.length})</h2>
          <ul className="divide-y rounded border">
            {worktreeBindings.map((b) => (
              <li key={b.path} className="px-3 py-2 text-xs">
                <div className="font-mono text-muted-foreground truncate">{b.path}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {b.sessions.length} session{b.sessions.length === 1 ? '' : 's'}: {b.sessions.join(', ')}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="px-6 py-4 border-t mt-auto">
        <h2 className="text-sm font-semibold mb-2">Settings</h2>
        <label className="flex items-center justify-between gap-4 text-sm cursor-pointer">
          <span>Auto-open most recent session when entering this workspace</span>
          <Checkbox
            checked={ws.autoOpenLastSession}
            onCheckedChange={(checked) => updateWorkspace(ws.id, { autoOpenLastSession: !!checked })}
          />
        </label>

        <div className="mt-4">
          <Button variant="outline" size="sm" className="text-destructive" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="h-4 w-4" /> Delete workspace
          </Button>
        </div>
      </section>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace</AlertDialogTitle>
            <AlertDialogDescription>
              "{ws.name}" and its {sessions.length} session(s) ({sessions.map((s) => s.name).join(', ') || 'none'}) will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteWorkspace(ws.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
```

- [ ] **Step 2: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: file-local errors 0.

- [ ] **Step 3: Commit**

```bash
git add client/src/components/workspace/WorkspaceHome.tsx
git commit -m "feat(workspace): add WorkspaceHome with sessions list, worktrees, and settings"
```

---

## Task 12: CommandCenter (active-runs strip + workspace grid)

**Files:**
- Create: `client/src/components/home/CommandCenter.tsx`

- [ ] **Step 1: Create directory and file**

```bash
mkdir -p client/src/components/home
```

- [ ] **Step 2: Implement the component**

Create `client/src/components/home/CommandCenter.tsx`:

```typescript
import { GitBranch, Plus, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWorkspaceStore, type WorkspaceWithAggregates } from '@/stores/workspace-store';
import { useSessionStore } from '@/stores/session-store';
import { useServerStore } from '@/stores/server-store';
import { cn } from '@/lib/utils';
import { useMemo } from 'react';

interface CommandCenterProps {
  onAddWorkspace: () => void;
  onSelectWorkspace: (id: string) => void;
  onSelectSession: (serverId: string, sessionId: string) => void;
}

function relativeTime(ts: number | null): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

export function CommandCenter({ onAddWorkspace, onSelectWorkspace, onSelectSession }: CommandCenterProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const sessionsByServer = useSessionStore((s) => s.sessions);
  const agentStatus = useSessionStore((s) => s.agentStatus);
  const servers = useServerStore((s) => s.servers);

  const workspaceList = useMemo(() => Object.values(workspaces).sort((a, b) =>
    (b.lastActivityAt ?? b.updatedAt) - (a.lastActivityAt ?? a.updatedAt),
  ), [workspaces]);

  // Active runs: every session whose agentStatus is thinking/tool_call
  const activeRuns = useMemo(() => {
    const out: { sessionId: string; serverId: string; sessionName: string; workspaceName: string | null; state: string }[] = [];
    for (const [serverId, list] of Object.entries(sessionsByServer)) {
      for (const s of list) {
        const status = agentStatus[s.id];
        if (status?.state === 'thinking' || status?.state === 'tool_call') {
          out.push({
            sessionId: s.id,
            serverId,
            sessionName: s.name,
            workspaceName: s.workspaceId ? (workspaces[s.workspaceId]?.name ?? null) : null,
            state: status.state,
          });
        }
      }
    }
    return out;
  }, [sessionsByServer, agentStatus, workspaces]);

  const serverName = (id: string) => servers.find((s) => s.id === id)?.name ?? id;

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Active runs strip */}
      <div className="border-b bg-muted/30">
        <div className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-muted-foreground">
          <Activity className="h-3.5 w-3.5" /> Active runs
          <span className="ml-1 rounded bg-background px-1.5 py-0.5 text-[10px]">{activeRuns.length}</span>
        </div>
        {activeRuns.length === 0 ? (
          <div className="px-4 pb-3 text-xs text-muted-foreground/70">Nothing is running right now.</div>
        ) : (
          <div className="flex gap-2 overflow-x-auto px-4 pb-3">
            {activeRuns.map((r) => (
              <button
                key={r.sessionId}
                className="flex shrink-0 items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs hover:bg-accent"
                onClick={() => onSelectSession(r.serverId, r.sessionId)}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', r.state === 'thinking' ? 'bg-blue-500' : 'bg-purple-500')} />
                <span className="truncate max-w-[140px]">{r.sessionName}</span>
                {r.workspaceName && <span className="text-muted-foreground">· {r.workspaceName}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Workspace grid */}
      <div className="flex-1 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Workspaces</h1>
          <Button size="sm" onClick={onAddWorkspace}><Plus className="h-4 w-4" /> Add workspace</Button>
        </div>
        {workspaceList.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
            <p className="text-sm text-muted-foreground">No workspaces yet.</p>
            <Button className="mt-4" onClick={onAddWorkspace}><Plus className="h-4 w-4" /> Add your first workspace</Button>
          </div>
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {workspaceList.map((w) => (
              <WorkspaceCard
                key={w.id}
                workspace={w}
                serverName={serverName(w.serverId)}
                onClick={() => onSelectWorkspace(w.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkspaceCard({ workspace, serverName, onClick }: { workspace: WorkspaceWithAggregates; serverName: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col rounded-lg border bg-background p-3 text-left transition-colors hover:border-primary hover:bg-accent/30"
    >
      <div className="flex items-center justify-between">
        <span className="truncate font-medium text-sm">{workspace.name}</span>
        {workspace.activeSessionCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-blue-500">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            {workspace.activeSessionCount} active
          </span>
        )}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground truncate">{serverName}</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        {workspace.defaultBranch && (
          <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" />{workspace.defaultBranch}</span>
        )}
        <span>{workspace.totalSessionCount} session{workspace.totalSessionCount === 1 ? '' : 's'}</span>
        {workspace.dirtyFileCount !== null && workspace.dirtyFileCount > 0 && (
          <span className="text-orange-500">{workspace.dirtyFileCount} dirty</span>
        )}
        <span>{relativeTime(workspace.lastActivityAt)}</span>
      </div>
    </button>
  );
}
```

- [ ] **Step 3: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: file-local errors 0.

- [ ] **Step 4: Commit**

```bash
git add client/src/components/home/CommandCenter.tsx
git commit -m "feat(home): add CommandCenter with active-runs strip and workspace grid"
```

---

## Task 13: AppShell + App.tsx routing + CreateSessionDialog adaptation

**Files:**
- Modify: `client/src/components/layout/AppShell.tsx`
- Modify: `client/src/App.tsx`
- Modify: `client/src/components/chat/CreateSessionDialog.tsx`

- [ ] **Step 1: Update `CreateSessionDialog` to accept a workspace context**

Replace the props interface in `client/src/components/chat/CreateSessionDialog.tsx`:

```typescript
interface CreateSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, workingDir: string | null, claudeSessionId?: string | null, provider?: string) => void;
  defaultName: string;
  defaultWorkingDir?: string;
  serverId: string;
  workspaceContext?: { workspaceId: string; repoPath: string } | null;
  onListClaudeSessions?: (serverId: string, workingDir: string) => Promise<string[]>;
  onListCliSessions?: (serverId: string, workingDir: string, provider: string) => Promise<string[]>;
}
```

When `workspaceContext` is provided:
- Default `workingDir` to `workspaceContext.repoPath`
- Hide the workingDir input + browse button (`workingDir` is read-only)

In the component body, change the `useEffect` that resets fields and the JSX for the Working directory section:

```tsx
  useEffect(() => {
    if (open) {
      setName(defaultName);
      setWorkingDir(workspaceContext?.repoPath ?? defaultWorkingDir ?? '');
      setProvider('claude');
      setClaudeSessions([]);
      setSelectedClaudeSession(null);
    }
  }, [open, defaultName, defaultWorkingDir, workspaceContext]);
```

```tsx
            {!workspaceContext && (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Working directory</span>
                <div className="flex gap-2">
                  <Input
                    value={workingDir}
                    onChange={(e) => setWorkingDir(e.target.value)}
                    placeholder="Optional — defaults to home directory"
                    className="flex-1"
                    readOnly
                  />
                  <Button type="button" variant="outline" size="icon" onClick={() => setPickerOpen(true)} title="Browse remote directories">
                    <Folder className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            )}
```

The submit handler can stay — it passes `workingDir`, which is set from the workspace context when present.

- [ ] **Step 2: Update `AppShell` props**

In `client/src/components/layout/AppShell.tsx`, add to `AppShellProps`:

```typescript
  mainView: ReactNode;            // replaces chatView; can be CommandCenter / WorkspaceHome / ChatView
  onSelectWorkspace?: (id: string) => void;
  onAddWorkspace?: () => void;
```

Replace the existing `chatView` prop usage:

```tsx
export function AppShell({
  mainView, onAddServer, onEditServer, onSendToChat, onSelectSession,
  onSelectWorkspace, onAddWorkspace,
}: AppShellProps) {
```

Pass `onSelectWorkspace` and `onAddWorkspace` to both the desktop and mobile `<Sidebar>`. Replace `chatView` with `mainView` in the rendered tree.

Change the mobile sheet title from `<SheetTitle className="text-base">Servers</SheetTitle>` to `<SheetTitle className="text-base">Workspaces</SheetTitle>`.

- [ ] **Step 3: Rewrite `App.tsx` orchestration**

In `client/src/App.tsx`:

1. Import workspace store + new components:

```typescript
import { useWorkspaceStore } from '@/stores/workspace-store';
import { CommandCenter } from '@/components/home/CommandCenter';
import { WorkspaceHome } from '@/components/workspace/WorkspaceHome';
import { AddWorkspaceDialog } from '@/components/workspace/AddWorkspaceDialog';
```

2. Extend the existing destructure of `useWebSocket()` to include the new workspace methods, and add a workspace-fetch effect:

Replace the existing line:

```typescript
  const { connectToSession, sendInput, createSession, deleteSession, fetchGitInfo, listBranches, switchBranch, execCommand, syncTranscript, listCliSessions, listClaudeSessions, loadMoreMessages, listCheckpoints } = useWebSocket();
```

with:

```typescript
  const { connectToSession, sendInput, createSession, deleteSession, fetchGitInfo, listBranches, switchBranch, execCommand, syncTranscript, listCliSessions, listClaudeSessions, loadMoreMessages, listCheckpoints, listWorkspaces } = useWebSocket();
```

Then add a fetch effect (place it after the existing `setServers` effect):

```typescript
  // Fetch workspaces over WS on mount and refresh periodically
  useEffect(() => {
    listWorkspaces();
    const interval = setInterval(() => listWorkspaces(), 30_000);
    return () => clearInterval(interval);
  }, [listWorkspaces]);
```

3. Remove the auto-create-Default-session behavior so empty workspaces stay empty.

In the existing per-server sessions-fetch effect, locate the `else { createSession(serverId, 'Default'); }` branch:

```typescript
        if (sessionList.length > 0) {
          const persisted = useSessionStore.getState().activeSessionId[serverId];
          if (!persisted || !sessionList.find((s: any) => s.id === persisted)) {
            setActiveSession(serverId, sessionList[0].id);
          }
        } else {
          createSession(serverId, 'Default');
        }
```

Replace with:

```typescript
        if (sessionList.length > 0) {
          const persisted = useSessionStore.getState().activeSessionId[serverId];
          if (!persisted || !sessionList.find((s: any) => s.id === persisted)) {
            setActiveSession(serverId, sessionList[0].id);
          }
        }
        // No auto-create: empty workspaces show "New session" affordance instead.
```

4. Add workspace-store hooks, the `Route` state, and route helpers. Place these in the same area as the existing `useState`/`useCallback` block (after the existing `setSessions`/`setActiveSession` selectors):

```typescript
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  type Route = { kind: 'home' } | { kind: 'workspace'; id: string } | { kind: 'session'; serverId: string; sessionId: string };
  const [route, setRoute] = useState<Route>({ kind: 'home' });
  const enterWorkspace = useCallback((id: string) => setRoute({ kind: 'workspace', id }), []);
  const enterSession = useCallback(
    (serverId: string, sessionId: string) => setRoute({ kind: 'session', serverId, sessionId }),
    [],
  );

  const [addWorkspaceOpen, setAddWorkspaceOpen] = useState(false);
```

5. Define the workspace selection and session selection handlers. Each picks the right route as a side effect:

```typescript
  // Picking a workspace: if auto-open is on AND it has sessions, jump straight
  // to the most-recent session's chat. Otherwise land on Workspace Home.
  const handleSelectWorkspace = useCallback((id: string) => {
    const workspace = workspaces[id];
    if (!workspace) return;
    setActiveWorkspace(id);
    setActiveServer(workspace.serverId);
    if (workspace.autoOpenLastSession) {
      const wsSessions = useSessionStore.getState().sessionsByWorkspace(id);
      if (wsSessions.length > 0) {
        const mostRecent = [...wsSessions].sort((a, b) => b.lastActivityAt - a.lastActivityAt)[0];
        setActiveSession(workspace.serverId, mostRecent.id);
        connectToSession(workspace.serverId, mostRecent.id);
        enterSession(workspace.serverId, mostRecent.id);
        return;
      }
    }
    enterWorkspace(id);
  }, [workspaces, setActiveWorkspace, setActiveServer, setActiveSession, connectToSession, enterSession, enterWorkspace]);

  // Sidebar / Workspace Home / Command Center can all open a session: route to chat
  // and connect, also setting active workspace if the session is linked to one.
  const handleSidebarSelectSession = useCallback((serverId: string, sessionId: string) => {
    const session = useSessionStore.getState().sessions[serverId]?.find((s) => s.id === sessionId);
    setActiveServer(serverId);
    setActiveSession(serverId, sessionId);
    if (session?.workspaceId) setActiveWorkspace(session.workspaceId);
    connectToSession(serverId, sessionId);
    enterSession(serverId, sessionId);
  }, [setActiveServer, setActiveSession, setActiveWorkspace, connectToSession, enterSession]);
```

6. Compute `mainView`. The `ChatView` props mirror the existing call site verbatim — copy them through the existing handlers we already keep around:

```typescript
  const mainView = (() => {
    if (route.kind === 'session') {
      return (
        <ChatView
          onSend={handleSend}
          onCreateSession={handleCreateSession}
          onDeleteSession={handleDeleteSession}
          onSelectSession={handleSelectSession}
          onListBranches={listBranches}
          onSwitchBranch={switchBranch}
          onSyncTranscript={handleSyncTranscript}
          onListClaudeSessions={listClaudeSessions}
          onListCliSessions={listCliSessions}
          onSendToSession={handleSendToSession}
          onLoadMore={handleLoadMore}
        />
      );
    }
    if (route.kind === 'workspace') {
      return (
        <WorkspaceHome
          workspaceId={route.id}
          onNewSession={() => handleNewSessionInWorkspace(route.id)}
          onSelectSession={enterSession}
        />
      );
    }
    return (
      <CommandCenter
        onAddWorkspace={() => setAddWorkspaceOpen(true)}
        onSelectWorkspace={handleSelectWorkspace}
        onSelectSession={enterSession}
      />
    );
  })();
```

Update the rendered `<AppShell mainView={mainView} ... />`.

7. Add the dialog at the bottom of `App` next to `<ServerDialog>`:

```tsx
      <AddWorkspaceDialog open={addWorkspaceOpen} onOpenChange={setAddWorkspaceOpen} />
```

8. The "New session" button in `WorkspaceHome` needs to open `CreateSessionDialog` with `workspaceContext`. Hoist the `CreateSessionDialog` open state to App.tsx so it can be seeded from either ChatView or WorkspaceHome:

Add state:

```typescript
  const [createOpen, setCreateOpen] = useState(false);
  const [createCtx, setCreateCtx] = useState<{ workspaceId: string; repoPath: string } | null>(null);
  const handleNewSessionInWorkspace = useCallback((workspaceId: string) => {
    const ws = useWorkspaceStore.getState().workspaces[workspaceId];
    if (!ws) return;
    setActiveServer(ws.serverId);
    setCreateCtx({ workspaceId, repoPath: ws.repoPath });
    setCreateOpen(true);
  }, [setActiveServer]);
```

When the dialog submits:

```typescript
  const handleCreateSessionFromDialog = (name: string, workingDir: string | null, claudeSessionId?: string | null, provider?: string) => {
    if (!activeServerId) return;
    createSession(activeServerId, name, workingDir, claudeSessionId, provider);
    setCreateOpen(false);
  };
```

Render the dialog (as a sibling of `<ServerDialog>`):

```tsx
      {activeServerId && (
        <CreateSessionDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          onSubmit={handleCreateSessionFromDialog}
          defaultName="Default"
          defaultWorkingDir={createCtx?.repoPath}
          serverId={activeServerId}
          workspaceContext={createCtx}
          onListClaudeSessions={listClaudeSessions}
          onListCliSessions={listCliSessions}
        />
      )}
```

Pass `handleNewSessionInWorkspace` to `WorkspaceHome` via `onNewSession`:

```typescript
return (
  <WorkspaceHome
    workspaceId={route.id}
    onNewSession={() => handleNewSessionInWorkspace(route.id)}
    onSelectSession={enterSession}
  />
);
```

The existing `ChatView`'s own session-creation flow may also have a "New session" button. Leave that path alone for v1 (it can still fall through `handleCreateSession` from `App.tsx`, which now does NOT seed workspace context — sessions created from inside a chat view stay loose until next probe).

9. Pass `onSelectWorkspace`/`onAddWorkspace` to `AppShell`:

```tsx
<AppShell
  mainView={mainView}
  onAddServer={() => { setEditingServer(null); setServerDialogOpen(true); }}
  onEditServer={(server) => { setEditingServer(server); setServerDialogOpen(true); }}
  onSendToChat={handleSend}
  onSelectSession={handleSidebarSelectSession}
  onSelectWorkspace={enterWorkspace}
  onAddWorkspace={() => setAddWorkspaceOpen(true)}
/>
```

- [ ] **Step 4: Type-check**

```bash
cd client && npx tsc --noEmit
```

Expected: 0 errors. Fix any remaining type mismatches inline (e.g. `Session` consumers expecting workspaceId).

- [ ] **Step 5: Commit**

```bash
git add client/src/App.tsx client/src/components/layout/AppShell.tsx client/src/components/chat/CreateSessionDialog.tsx
git commit -m "feat(client): route between Command Center, Workspace Home, and Chat"
```

---

## Task 14: Smoke test pass

**Files:** none — manual testing only

- [ ] **Step 1: Start the dev servers**

```bash
npm run dev
```

Wait for both client (5173) and server (3030) to start, then open `http://localhost:5173` in a browser.

- [ ] **Step 2: Verify empty state**

If the DB is fresh (or has only old sessions):
- Command Center renders with the active-runs strip showing "Nothing is running right now"
- Workspace grid empty state shows "Add your first workspace" CTA

- [ ] **Step 3: Add a workspace**

Click "Add workspace" → pick an existing server → browse to a known git repo path → submit. The dialog closes and a new card appears in the grid.

- [ ] **Step 4: Enter a workspace**

Click the new card → Workspace Home renders with the empty Sessions section, showing "New session" button. Click "New session" → CreateSessionDialog opens **without the working-directory field**. Submit; a new session row appears.

- [ ] **Step 5: Open the session, run a turn**

Click the session in either the workspace home list or the sidebar → ChatView. Send a short prompt (e.g. "say hi"). Verify:
- Active-runs strip on Command Center (open in another tab) shows the session as active during the turn
- Sidebar workspace dot turns blue while the agent is thinking

- [ ] **Step 6: Verify lazy migration on a legacy session**

If you have an existing pre-migration session: open it from the Loose footer; on its first connect after upgrade, check the sidebar — the session should jump from the Loose footer up under a newly-auto-created workspace card.

- [ ] **Step 7: Toggle auto-open and re-enter**

In Workspace Home → Settings → toggle "Auto-open most recent session". Click another workspace then click back. The most recent session's chat should open directly. Toggle off; verify Workspace Home shows again.

- [ ] **Step 8: Delete a workspace**

In Workspace Home → "Delete workspace" → confirm. The card and its sessions disappear from the sidebar and grid.

- [ ] **Step 9: Mobile breakpoint**

Resize the browser to <1024px wide. Tap the sidebar (or its trigger) → bottom sheet opens with "Workspaces" title + workspace list. Loose footer still visible at the bottom.

- [ ] **Step 10: Run server tests one more time**

```bash
cd server && npx vitest run
```

Expected: all green.

- [ ] **Step 11: Type-check both packages**

```bash
cd server && npx tsc --noEmit
cd ../client && npx tsc --noEmit
```

Expected: 0 errors in both.

- [ ] **Step 12: If everything passes, no commit needed (this task is verification only)**

If smoke test reveals a bug, fix it inline with a small commit (`fix(scope): description`) and re-run the relevant smoke step.

---

## Self-review notes

- **Spec coverage:** every section of the spec maps to one of Tasks 1–13: schema (1), workspace CRUD (2), session linkage + aggregation (3), git probe (4), WS protocol (5–6), client store (7), client WS (8), Add dialog (9), Sidebar (10), Workspace Home (11), Command Center (12), routing (13). Smoke verification is Task 14.
- **Defaulted away from non-essential server tests:** ws-handler tests are not added (no existing precedent in `__tests__/`; mocking the WebSocketServer is heavy). The probe parser and DB layer carry the test weight. This matches the project's existing testing posture.
- **`dirtyFileCount` cost:** Task 5's `buildWorkspaceWithAggregates` runs `git status --porcelain` per workspace per `list-workspaces` (only when SSH is already connected). For users with many workspaces this can mean N round-trips on each refresh tick. Acceptable for v1 (typical user has < 10 workspaces); revisit with caching if it shows up as slow.
