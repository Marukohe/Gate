import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'fs';
import { createDb, type Database } from '../db.js';
import { buildWorkspaceInspector } from '../workspace-inspector.js';

const TEST_DB = '/tmp/gate-workspace-inspector-test.db';

describe('workspace inspector', () => {
  let db: Database;

  beforeEach(() => {
    db = createDb(TEST_DB);
  });

  afterEach(() => {
    vi.useRealTimers();
    db.close();
    if (fs.existsSync(TEST_DB)) fs.unlinkSync(TEST_DB);
  });

  it('prefers the workspace primary session and keeps hidden action sessions separate', () => {
    const server = db.createServer({ name: 'S', host: 'h', port: 22, username: 'u', authType: 'password', password: 'p' });
    const workspace = db.createWorkspace({ serverId: server.id, repoPath: '/repo', remoteUrl: null, defaultBranch: 'main', name: 'repo' });
    const oldVisible = db.createSession(server.id, 'old', '/repo', 'claude', { workspaceId: workspace.id });
    const primary = db.createSession(server.id, 'primary', '/repo', 'codex', { workspaceId: workspace.id });
    const hidden = db.createSession(server.id, 'commit', '/repo', 'claude', {
      workspaceId: workspace.id,
      isHidden: true,
      actionKind: 'commit',
    });
    db.setWorkspacePrimarySession(workspace.id, primary.id);

    const inspector = buildWorkspaceInspector(db, workspace.id);

    expect(inspector?.primarySession?.id).toBe(primary.id);
    expect(inspector?.visibleSessions.map((session) => session.id).sort()).toEqual([oldVisible.id, primary.id].sort());
    expect(inspector?.actionSessions.map((session) => session.id)).toEqual([hidden.id]);
  });

  it('falls back to the most recently active visible session when primary is missing', () => {
    vi.useFakeTimers();
    const server = db.createServer({ name: 'S', host: 'h', port: 22, username: 'u', authType: 'password', password: 'p' });
    const workspace = db.createWorkspace({ serverId: server.id, repoPath: '/repo', remoteUrl: null, defaultBranch: 'main', name: 'repo' });
    vi.setSystemTime(100);
    const oldVisible = db.createSession(server.id, 'old', '/repo', 'claude', { workspaceId: workspace.id });
    vi.setSystemTime(300);
    const latestVisible = db.createSession(server.id, 'latest', '/repo', 'codex', { workspaceId: workspace.id });

    const inspector = buildWorkspaceInspector(db, workspace.id);

    expect(inspector?.primarySession?.id).toBe(latestVisible.id);
    expect(inspector?.visibleSessions.map((session) => session.id).sort()).toEqual([oldVisible.id, latestVisible.id].sort());
  });
});
