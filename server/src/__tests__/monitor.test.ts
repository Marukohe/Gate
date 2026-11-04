import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createDb, type Database } from '../db.js';
import { monitorSnapshot } from '../monitor.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import express from 'express';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { createServerRoutes } from '../routes/servers.js';

describe('Session monitor', () => {
  let db: Database;
  let root: string;
  let serverId: string;
  const active = new Set<string>();
  const ssh = { hasActiveChannel: vi.fn((_server: string, id: string) => active.has(id)), connect: vi.fn(), startCLI: vi.fn() };
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'gate-monitor-'));
    db = createDb(join(root, 'gate.db'));
    serverId = db.createServer({ name: 'Development', host: 'localhost', port: 22, username: 'test',
      authType: 'password', password: 'do-not-expose' }).id;
    active.clear(); vi.clearAllMocks();
  });
  afterEach(() => { db.close(); rmSync(root, { recursive: true, force: true }); });
  const rows = () => monitorSnapshot(db, ssh).servers[0].sessions;

  it('creates a session with the selected provider without starting SSH', async () => {
    const app = express(); app.use(express.json()); app.use('/servers', createServerRoutes(db));
    const http = createServer(app);
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    try {
      const url = `http://127.0.0.1:${(http.address() as AddressInfo).port}/servers/${serverId}/sessions`;
      const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'New work', workingDir: '/repo', provider: 'codex' }) });
      expect(response.status).toBe(201);
      expect(await response.json()).toMatchObject({ provider: 'codex', workingDir: '/repo', cliSessionId: null });
      const invalid = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'Bad provider', provider: 'unknown' }) });
      expect(invalid.status).toBe(400);
      expect(db.listSessions(serverId)).toHaveLength(1);
    } finally { await new Promise<void>((resolve) => http.close(() => resolve())); }
  });

  it('reads sessions without launching and keeps unknown history distinct from live progress', () => {
    const session = db.createSession(serverId, 'Work', '/repo', 'codex');
    active.add(session.id);
    db.saveMessage({ sessionId: session.id, type: 'system', subType: 'init', content: 'Session started', timestamp: 0 });
    expect(rows()[0].state).toBe('idle');
    active.clear();
    db.saveMessage({ sessionId: session.id, type: 'assistant', content: 'Still thinking', timestamp: 1 });
    expect(rows()[0]).toMatchObject({ state: 'unknown', activity: 'Still thinking' });
    active.add(session.id);
    expect(rows()[0].state).toBe('running');
    db.saveMessage({ sessionId: session.id, type: 'tool_call', toolName: 'AskUserQuestion', content: 'Choose', timestamp: 2 });
    expect(rows()[0].state).toBe('waiting');
    db.saveMessage({ sessionId: session.id, type: 'tool_result', content: 'Answered', timestamp: 3 });
    expect(rows()[0].state).toBe('running');
    active.clear();
    expect(rows()[0].state).toBe('unknown');
    expect(JSON.stringify(monitorSnapshot(db, ssh))).not.toContain('do-not-expose');
    expect(ssh.connect).not.toHaveBeenCalled(); expect(ssh.startCLI).not.toHaveBeenCalled();
    expect(db.getMessageCount(session.id)).toBe(4);
  });

  it('persists explicit completion/errors, orders equal timestamps, and honors conversation reset', () => {
    const session = db.createSession(serverId, 'Work', '/repo', 'codex');
    db.saveMessages([
      { sessionId: session.id, type: 'user', content: 'Begin', timestamp: 10 },
      { sessionId: session.id, type: 'system', subType: 'result', content: 'Turn complete', timestamp: 10 },
    ]);
    db.close(); db = createDb(join(root, 'gate.db'));
    expect(rows()[0].state).toBe('completed');
    db.saveMessage({ sessionId: session.id, type: 'user', content: 'Again', timestamp: 11 });
    expect(rows()[0].state).toBe('unknown');
    db.saveMessage({ sessionId: session.id, type: 'system', subType: 'error', content: 'Authentication failed', timestamp: 12 });
    expect(rows()[0]).toMatchObject({ state: 'failed', activity: 'Authentication failed' });
    db.updateChatStartedAt(session.id, 13);
    expect(rows()[0]).toMatchObject({ state: 'unknown', activity: 'Open to connect' });
  });

  it('keeps an externally resumed saved conversation observed instead of offering to launch it', () => {
    const { checkout } = db.workbench.createProjectWithCheckout({ name: 'Gate' }, { serverId, path: '/repo' });
    const session = db.createSession(serverId, 'Saved work', '/repo', 'codex');
    db.updateCliSessionId(session.id, 'same-native-id');
    db.workbench.saveObservedSession({ id: 'external', scopeId: checkout.id, checkoutId: checkout.id, taskId: null,
      provider: 'codex', sessionId: 'same-native-id', cwd: '/repo', event: 'PermissionRequest', state: 'waiting', revision: 1,
      firstSeenAt: Date.now() - 1, lastSeenAt: Date.now() - 1, dismissedRevision: null });
    expect(rows()).toHaveLength(1);
    expect(rows()[0]).toMatchObject({ source: 'external', name: 'Saved work', state: 'waiting' });
    expect(rows()[0].sessionId).toBeUndefined();
    active.add(session.id);
    expect(rows()[0].source).toBe('chat');
  });

  it('does not claim stale hooks or disconnected runtimes are running, and deduplicates native identities', () => {
    const { project, checkout } = db.workbench.createProjectWithCheckout({ name: 'Gate', defaultProvider: 'codex' },
      { serverId, path: '/repo' });
    const task = db.workbench.createTask({ projectId: project.id, checkoutId: checkout.id, goal: 'Work', title: 'Task' });
    const run = db.workbench.createRun({ taskId: task.id, kind: 'implementation', requestId: 'run', prompt: 'Work' });
    const now = Date.now();
    db.workbench.updateRun(run.id, { state: 'running', nativeSessionId: 'native' });
    db.workbench.saveExecution({ runId: run.id, launch: null, source: null, branch: null, stopRequested: false,
      connectionError: null, lastSeenAt: now, settings: { serverId, nodePath: '/node', claudePath: '/claude',
        codexPath: '/codex', directory: '/runtime' } });
    db.workbench.saveObservedSession({ id: 'observer', scopeId: checkout.id, checkoutId: checkout.id, taskId: null,
      provider: 'codex', sessionId: 'native', cwd: '/repo', event: 'UserPromptSubmit', state: 'busy', revision: 1,
      firstSeenAt: now, lastSeenAt: now, dismissedRevision: null });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].state).toBe('running');
    db.workbench.ingestEvent({ runId: run.id, seq: 1, time: now, type: 'protocol',
      data: { data: { type: 'message', text: 'Working '.repeat(1000) } } });
    expect(rows()[0].activity).toHaveLength(200);
    expect(rows()[0].updatedAt).toBe(now);
    db.workbench.saveExecution({ ...db.workbench.execution(run.id)!, connectionError: 'SSH unavailable' });
    expect(rows()[0]).toMatchObject({ state: 'unknown', activity: 'Connection unconfirmed: SSH unavailable' });
    db.workbench.updateRun(run.id, { nativeSessionId: null, state: 'completed', endedAt: now });
    const stale = monitorSnapshot(db, ssh, now + 61_000).servers[0].sessions;
    expect(stale.find((item) => item.source === 'external')).toMatchObject({ state: 'unknown', activity: 'No recent update · Working on a request' });
    expect(stale.find((item) => item.source === 'managed')?.state).toBe('completed');
  });
});
