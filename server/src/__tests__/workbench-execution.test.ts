import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../db.js';
import { ExecutionService } from '../workbench/execution.js';
import type { RemoteEvent, RemoteRuntime, RuntimeSettings } from '../workbench/remote.js';

class RemoteFixture {
  offline = false;
  loseStartReply = false;
  starts = new Map<string, object>();
  events = new Map<string, RemoteEvent[]>();
  async install() {}
  async disconnect() {}
  async prepare() { if (this.offline) throw new Error('SSH disconnected'); return 'abc123'; }
  launch(_settings: RuntimeSettings, _provider: string, cwd: string, prompt: string) {
    return { command: '/node', args: ['/worker'], cwd, protocol: true, initialInput: prompt };
  }
  push(runId: string, type: string, data = {}) {
    const all = this.events.get(runId) ?? [];
    all.push({ runId, seq: all.length + 1, time: Date.now(), type, ...data });
    this.events.set(runId, all);
  }
  async request(_settings: RuntimeSettings, input: { method: string; runId: string; after: number }) {
    if (this.offline) throw new Error('SSH disconnected');
    if (input.method === 'start') {
      if (!this.starts.has(input.runId)) {
        this.starts.set(input.runId, input);
        this.push(input.runId, 'requested'); this.push(input.runId, 'started');
      } else expect(input).toEqual(this.starts.get(input.runId));
      if (this.loseStartReply) { this.loseStartReply = false; throw new Error('Acknowledgement lost'); }
      return {};
    }
    if (input.method === 'interrupt') {
      this.push(input.runId, 'stopping');
      this.push(input.runId, 'exited', { exitCode: null, signal: 'SIGTERM', interrupted: true });
      return {};
    }
    return { events: (this.events.get(input.runId) ?? []).filter((event) => event.seq > input.after), more: false };
  }
}

describe('Managed execution recovery', () => {
  let db: Database;
  let service: ExecutionService;
  let remote: RemoteFixture;
  let taskId: string;
  let otherTaskId: string;
  beforeEach(() => {
    db = createDb(':memory:');
    const machine = db.createServer({ name: 'Local', host: 'localhost', port: 22, username: 'test', authType: 'privateKey' });
    const { project, checkout } = db.workbench.createProjectWithCheckout({ name: 'Test', defaultProvider: 'codex' },
      { serverId: machine.id, path: '/repo' });
    const task = { projectId: project.id, checkoutId: checkout.id, goal: 'Goal', title: 'Task', isolation: 'shared' as const };
    taskId = db.workbench.createTask(task).id;
    otherTaskId = db.workbench.createTask(task).id;
    db.workbench.saveRuntimeSettings({ serverId: machine.id, nodePath: '/node', claudePath: '/claude', codexPath: '/codex', directory: '/runtime' });
    remote = new RemoteFixture();
    service = new ExecutionService(db, remote as unknown as RemoteRuntime);
  });
  afterEach(async () => { await service.close(); db.close(); });

  it('reconciles an acknowledged-lost start after service restart without launching a second writer', async () => {
    remote.loseStartReply = true;
    const run = service.run(taskId, 'request-1', 'literal $HOME');
    await service.reconcile(run.id);
    expect(db.workbench.execution(run.id)?.connectionError).toContain('Acknowledgement lost');
    expect(db.workbench.run(run.id)?.state).toBe('starting');
    expect(() => service.run(otherTaskId, 'other', 'other')).toThrow(/in use/);
    await service.close();
    remote.push(run.id, 'protocol', { data: { type: 'message', text: 'Produced while Gate was down' } });
    service = new ExecutionService(db, remote as unknown as RemoteRuntime);
    await service.reconcile(run.id);
    expect(service.run(taskId, 'request-1', 'literal $HOME').id).toBe(run.id);
    await service.reconcile(run.id);
    expect(remote.starts.size).toBe(1);
    expect(db.workbench.events(run.id)).toHaveLength(3);
    expect(db.workbench.execution(run.id)?.connectionError).toBeNull();
    expect(db.workbench.task(taskId)?.status).toBe('in-progress');
  });

  it('keeps a durable stop request and checkout lock while SSH is unavailable', async () => {
    const run = service.run(taskId, 'request-1', 'work');
    await service.reconcile(run.id);
    remote.offline = true;
    await service.stop(run.id);
    expect(db.workbench.run(run.id)?.state).toBe('running');
    expect(db.workbench.execution(run.id)?.stopRequested).toBe(true);
    expect(() => service.run(otherTaskId, 'other', 'other')).toThrow(/in use/);
    remote.offline = false;
    await service.reconcile(run.id);
    expect(db.workbench.run(run.id)?.state).toBe('interrupted');
    expect(() => service.run(otherTaskId, 'other', 'other')).not.toThrow();
  });

  it('projects provider errors even with exit zero and never releases a lost checkout', async () => {
    const run = service.run(taskId, 'request-1', 'work');
    await service.reconcile(run.id);
    remote.push(run.id, 'protocol', { data: { type: 'result', failed: true, message: 'API failure' } });
    remote.push(run.id, 'exited', { exitCode: 0 });
    await service.reconcile(run.id);
    expect(db.workbench.run(run.id)).toMatchObject({ state: 'failed', error: 'API failure' });
    expect(db.workbench.task(taskId)?.status).not.toBe('done');
    const next = service.run(otherTaskId, 'request-2', 'work');
    await service.reconcile(next.id);
    remote.push(next.id, 'lost', { reason: 'Runtime ownership was lost' });
    await service.reconcile(next.id);
    expect(db.workbench.run(next.id)?.state).toBe('lost');
    expect(() => service.run(taskId, 'request-3', 'work')).toThrow(/in use/);
    await expect(service.stop(next.id)).rejects.toThrow(/ownership is lost/);
  });
});
