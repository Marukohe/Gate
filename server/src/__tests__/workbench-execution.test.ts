import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../db.js';
import { ExecutionService } from '../workbench/execution.js';
import type { RemoteEvent, RemoteRuntime, RuntimeSettings } from '../workbench/remote.js';

class RemoteFixture {
  offline = false;
  loseStartReply = false;
  inputs = new Map<string, string>();
  loseInputReply = false;
  starts = new Map<string, object>();
  releases: (string | undefined)[] = [];
  events = new Map<string, RemoteEvent[]>();
  async install(settings: RuntimeSettings) { return settings; }
  async disconnect() {}
  async prepare() { if (this.offline) throw new Error('SSH disconnected'); return 'abc123'; }
  launch(_settings: RuntimeSettings, _provider: string, cwd: string, prompt: string) {
    return { command: '/node', args: ['/worker'], cwd, protocol: true, initialInput: prompt };
  }
  async terminal(settings: RuntimeSettings, cwd: string, provider: string) { return this.launch(settings, provider, cwd, 'terminal'); }
  verification(settings: RuntimeSettings, cwd: string, command: string) { return this.launch(settings, 'shell', cwd, command); }
  async scripts() { return { scripts: { test: { command: 'npm test', source: 'gate.json' } }, warning: null }; }
  push(runId: string, type: string, data = {}) {
    const all = this.events.get(runId) ?? [];
    all.push({ runId, seq: all.length + 1, time: Date.now(), type, ...data });
    this.events.set(runId, all);
  }
  async request(_settings: RuntimeSettings, input: { method: string; runId: string; after: number; inputId: string; data: string }) {
    if (this.offline) throw new Error('SSH disconnected');
    this.releases.push(_settings.release);
    if (input.method === 'start') {
      if (!this.starts.has(input.runId)) {
        this.starts.set(input.runId, input);
        this.push(input.runId, 'requested'); this.push(input.runId, 'started');
      } else expect(input).toEqual(this.starts.get(input.runId));
      if (this.loseStartReply) { this.loseStartReply = false; throw new Error('Acknowledgement lost'); }
      return {};
    }
    if (input.method === 'input') {
      if (!this.inputs.has(input.inputId)) {
        this.inputs.set(input.inputId, input.data);
        this.push(input.runId, 'protocol', { data: { type: 'attention-resolved', id: JSON.parse(input.data).id } });
      }
      if (this.loseInputReply) { this.loseInputReply = false; throw new Error('Input reply lost'); }
      return { accepted: true };
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
  it('replays a lost decision acknowledgement and keeps other requests waiting', async () => {
    const run = service.run(taskId, 'request-decisions', 'work');
    await service.reconcile(run.id);
    for (const id of ['first', 'second']) remote.push(run.id, 'protocol', { data: {
      type: 'attention', id, kind: 'item/commandExecution/requestApproval', detail: { command: 'npm test' },
    } });
    await service.reconcile(run.id);
    const first = db.workbench.attentionItems(run.id).find((item) => item.requestId === 'first')!;
    remote.offline = true;
    service.decide(first.id, { decision: 'accept' });
    await service.reconcile(run.id);
    expect(db.workbench.attentionItem(first.id)?.state).toBe('sending');
    remote.offline = false; remote.loseInputReply = true;
    await service.reconcile(run.id);
    expect(db.workbench.attentionItem(first.id)?.state).toBe('sending');
    await service.close();
    service = new ExecutionService(db, remote as unknown as RemoteRuntime);
    await service.reconcile(run.id);
    expect(db.workbench.attentionItem(first.id)?.state).toBe('resolved');
    expect(remote.inputs.size).toBe(1);
    expect(db.workbench.run(run.id)?.state).toBe('waiting');
  });

  it('pins requests for pre-upgrade runs to their persisted remote release', async () => {
    const run = db.workbench.enqueue(taskId, 'old-run', 'work');
    db.workbench.prepareRun(run.id, { command: '/node', args: ['/runtime/releases/older/worker.mjs'],
      cwd: '/repo', initialInput: '{}', protocol: true }, 'old-head');
    await service.reconcile(run.id);
    expect(remote.releases.length).toBeGreaterThan(0);
    expect(remote.releases.every((release) => release === '/runtime/releases/older')).toBe(true);
    expect(db.workbench.execution(run.id)?.settings.release).toBe('/runtime/releases/older');
  });

  it('retains terminal ownership when the PTY worker exits without confirming child cleanup', async () => {
    const run = service.terminal(taskId, 'terminal', 'shell');
    await service.reconcile(run.id);
    remote.push(run.id, 'exited', { exitCode: 0, signal: null });
    await service.reconcile(run.id);
    expect(db.workbench.run(run.id)?.state).toBe('lost');
    expect(() => service.run(otherTaskId, 'unsafe', 'work')).toThrow(/in use/);
  });

  it('releases confirmed terminal exit without accepting or advancing the task', async () => {
    const run = service.terminal(taskId, 'terminal', 'shell');
    await service.reconcile(run.id);
    remote.push(run.id, 'protocol', { data: { type: 'terminal-exit', exitCode: 0, signal: null } });
    remote.push(run.id, 'exited', { exitCode: 0, signal: null });
    await service.reconcile(run.id);
    expect(db.workbench.run(run.id)?.state).toBe('completed');
    expect(db.workbench.task(taskId)?.status).toBe('in-progress');
    expect(() => service.run(otherTaskId, 'next', 'work')).not.toThrow();
  });

  it('captures project script commands, rejects stale previews, and distinguishes setup from tests', async () => {
    const task = db.workbench.task(taskId)!;
    db.workbench.updateProject(task.projectId, { scripts: { setup: 'npm ci', test: 'npm run check' } });
    expect((await service.scripts(taskId)).scripts.test).toEqual({ command: 'npm run check', source: 'project' });
    await expect(service.script(taskId, 'old-preview', 'test', 'npm test')).rejects.toThrow(/Script changed/);
    const run = await service.script(taskId, 'setup-once', 'setup', 'npm ci');
    await service.reconcile(run.id);
    db.workbench.updateProject(task.projectId, { scripts: { setup: 'another command' } });
    expect((await service.script(taskId, 'setup-once', 'setup', 'npm ci')).id).toBe(run.id);
    await expect(service.script(taskId, 'setup-once', 'test', 'npm ci')).rejects.toThrow(/another request/);
    remote.push(run.id, 'exited', { exitCode: 0 });
    await service.reconcile(run.id);
    expect(db.workbench.verification(run.id)).toMatchObject({ purpose: 'setup', command: 'npm ci', state: 'passed' });
    expect(db.workbench.task(taskId)?.status).toBe('in-progress');
    const test = await service.script(taskId, 'real-test', 'test', 'npm test');
    await service.reconcile(test.id);
    remote.push(test.id, 'exited', { exitCode: 0 });
    await service.reconcile(test.id);
    expect(db.workbench.verification(test.id)?.purpose).toBe('test');
    expect(db.workbench.task(taskId)?.status).toBe('review');
  });

});
