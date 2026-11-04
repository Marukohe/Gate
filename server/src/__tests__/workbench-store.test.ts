import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createDb, type Database } from '../db.js';

describe('Workbench persistence', () => {
  let directory: string;
  let file: string;
  let db: Database;
  beforeEach(() => {
    directory = mkdtempSync(path.join(tmpdir(), 'gate-workbench-'));
    file = path.join(directory, 'gate.db');
    db = createDb(file);
  });
  afterEach(() => { db.close(); rmSync(directory, { recursive: true, force: true }); });

  function server() {
    return db.createServer({ name: 'Test', host: 'localhost', port: 22, username: 'test', authType: 'privateKey' });
  }
  function project() {
    const machine = server();
    const project = db.workbench.createProject({ name: 'Gate' });
    const checkout = db.workbench.createCheckout({ projectId: project.id, serverId: machine.id, path: '/repo' });
    return { project, checkout, machine };
  }
  function task() {
    const setup = project();
    const task = db.workbench.createTask({ projectId: setup.project.id, checkoutId: setup.checkout.id,
      title: 'Fix reconnect', goal: 'Reconnect without losing output', acceptance: 'Replay only missing events' });
    return { ...setup, task };
  }

  it('imports explicit legacy goals once and preserves all session and message history', () => {
    const machine = server();
    const workspace = db.createWorkspace({ name: 'Legacy', serverId: machine.id, repoPath: '/legacy',
      remoteUrl: 'git@example:repo', defaultBranch: 'main', goal: 'Fix reconnect', status: 'review', prUrl: 'https://example/pr/1' });
    const primary = db.createSession(machine.id, 'Primary', '/legacy', 'codex', { workspaceId: workspace.id });
    const other = db.createSession(machine.id, 'Other work', '/legacy', 'claude', { workspaceId: workspace.id });
    db.setWorkspacePrimarySession(workspace.id, primary.id);
    db.saveMessage({ sessionId: other.id, type: 'assistant', content: 'Keep this history', timestamp: 123 });
    db.close();
    db = createDb(file);
    const imported = db.workbench.snapshot();
    expect(imported.projects).toHaveLength(1);
    expect(imported.tasks).toHaveLength(1);
    expect(imported.tasks[0]).toMatchObject({ goal: 'Fix reconnect', status: 'review',
      provider: 'codex', legacySessionId: primary.id, prUrl: 'https://example/pr/1' });
    expect(imported.runs).toEqual([]);
    expect(db.getMessages(other.id)[0].content).toBe('Keep this history');
    expect(db.listSessions(machine.id)).toHaveLength(2);
    db.workbench.updateTask(imported.tasks[0].id, { goal: 'New task goal' });
    db.updateWorkspace(workspace.id, { goal: 'Legacy changed independently' });
    db.close();
    db = createDb(file);
    expect(db.workbench.snapshot().tasks.map((task) => task.goal)).toEqual(['New task goal']);
  });

  it('does not attach an unrelated primary session or merge repositories by remote URL', () => {
    const machine = server();
    const other = db.createSession(machine.id, 'Unrelated', '/other');
    for (const repoPath of ['/one', '/two']) {
      db.createWorkspace({ name: repoPath, serverId: machine.id, repoPath,
        remoteUrl: 'git@example:repo', defaultBranch: 'main', goal: 'Goal', primarySessionId: other.id });
    }
    const snapshot = db.workbench.snapshot();
    expect(snapshot.projects).toHaveLength(2);
    expect(snapshot.tasks.every((task) => task.legacySessionId === null)).toBe(true);
    expect(snapshot.runs).toHaveLength(0);
  });

  it('keeps tasks independent and supports checkouts on different machines', () => {
    const { project: p, checkout, task: first } = task();
    const second = db.workbench.createTask({ projectId: p.id, checkoutId: checkout.id,
      title: 'Add review', goal: 'Review a fixed snapshot' });
    const remote = server();
    const otherCheckout = db.workbench.createCheckout({ projectId: p.id, serverId: remote.id, path: '/repo' });
    db.workbench.updateTask(first.id, { goal: 'Changed first goal', status: 'done' });
    expect(db.workbench.task(second.id)).toMatchObject({ goal: 'Review a fixed snapshot', status: 'backlog' });
    expect(db.workbench.snapshot().checkouts).toHaveLength(2);
    db.workbench.updateTask(second.id, { checkoutId: otherCheckout.id });
    expect(db.workbench.task(second.id)?.checkoutId).toBe(otherCheckout.id);
  });

  it('rejects cross-project checkouts and duplicate paths', () => {
    const { project: p, checkout, machine, task: t } = task();
    const other = db.workbench.createProject({ name: 'Other' });
    const otherCheckout = db.workbench.createCheckout({ projectId: other.id, serverId: machine.id, path: '/other' });
    expect(() => db.workbench.createTask({ projectId: other.id, checkoutId: checkout.id, title: 'Bad', goal: 'Bad' }))
      .toThrow('Checkout must belong');
    expect(() => db.workbench.updateTask(t.id, { checkoutId: otherCheckout.id })).toThrow('Checkout must belong');
    expect(() => db.workbench.createCheckout({ projectId: p.id, serverId: machine.id, path: '/repo/.' })).toThrow();
  });

  it('deduplicates run requests, keeps task acceptance explicit, and rejects conflicting retries', () => {
    const { task: t } = task();
    const input = { taskId: t.id, kind: 'implementation' as const, requestId: 'client-1', prompt: 'Implement the goal' };
    const run = db.workbench.createRun(input);
    expect(db.workbench.createRun(input).id).toBe(run.id);
    expect(() => db.workbench.createRun({ ...input, prompt: 'Different goal' })).toThrow('different run request');
    expect(() => db.workbench.updateTask(t.id, { status: 'done' })).toThrow('Stop active runs');
    db.workbench.updateRun(run.id, { state: 'completed', exitCode: 0 });
    expect(db.workbench.task(t.id)?.status).toBe('backlog');
    db.workbench.updateTask(t.id, { status: 'done' });
    db.close();
    db = createDb(file);
    expect(db.workbench.createRun(input).id).toBe(run.id);
    expect(db.workbench.snapshot().runs).toHaveLength(1);
  });

  it('holds checkout ownership until exit is confirmed, including after a backend restart', () => {
    const { task: t } = task();
    const one = db.workbench.createRun({ taskId: t.id, kind: 'implementation', requestId: 'one', prompt: 'First' });
    const two = db.workbench.createRun({ taskId: t.id, kind: 'implementation', requestId: 'two', prompt: 'Second' });
    db.workbench.acquireCheckout(one.id);
    expect(() => db.workbench.acquireCheckout(two.id)).toThrow('in use');
    expect(() => db.workbench.releaseCheckout(one.id)).toThrow('not confirmed');
    db.workbench.updateRun(one.id, { state: 'lost' });
    expect(() => db.workbench.releaseCheckout(one.id)).toThrow('not confirmed');
    db.close();
    db = createDb(file);
    expect(() => db.workbench.acquireCheckout(two.id)).toThrow('in use');
    db.workbench.updateRun(one.id, { state: 'interrupted' });
    db.workbench.releaseCheckout(one.id);
    db.workbench.acquireCheckout(two.id);
  });

  it('atomically projects contiguous events and replays without duplicate effects', () => {
    const { task: t } = task();
    const run = db.workbench.createRun({ taskId: t.id, kind: 'implementation', requestId: 'one', prompt: 'First' });
    const event = { runId: run.id, seq: 1, time: 123, type: 'started', data: {} };
    expect(() => db.workbench.ingestEvent(event, () => {
      db.workbench.updateRun(run.id, { state: 'running' });
      throw new Error('Projection failed');
    })).toThrow('Projection failed');
    expect(db.workbench.run(run.id)).toMatchObject({ state: 'queued', eventCursor: 0 });
    expect(db.workbench.events(run.id)).toEqual([]);
    expect(db.workbench.ingestEvent(event, () => db.workbench.updateRun(run.id, { state: 'running' }))).toBe(true);
    expect(db.workbench.ingestEvent(event, () => { throw new Error('Must not replay'); })).toBe(false);
    expect(() => db.workbench.ingestEvent({ ...event, seq: 3 })).toThrow('gap');
    db.workbench.ingestEvent({ ...event, seq: 2, type: 'stdout', data: { text: 'output' } });
    expect(db.workbench.events(run.id, 1)).toEqual([{ ...event, seq: 2, type: 'stdout', data: { text: 'output' } }]);
  });
});
