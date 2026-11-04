import type { Database } from '../db.js';
import { ACTIVE_RUN_STATES } from './store.js';
import { RemoteRuntime, type RemoteEvent, type RuntimeSettings } from './remote.js';
import type { RunEvent } from './types.js';

export class ExecutionService {
  private timer?: ReturnType<typeof setTimeout>;
  private pending = new Map<string, Promise<void>>();
  private closed = false;
  constructor(private db: Database, readonly remote = new RemoteRuntime(db)) {}

  start() {
    const tick = async () => {
      if (this.closed) return;
      await Promise.all(this.db.workbench.activeRuns().map((run) => this.reconcile(run.id)));
      if (!this.closed) this.timer = setTimeout(() => void tick(), 1000);
    };
    void tick();
  }

  async configure(settings: RuntimeSettings): Promise<void> {
    for (const key of ['nodePath', 'claudePath', 'codexPath', 'directory'] as const) {
      if (typeof settings[key] !== 'string' || !settings[key].startsWith('/') || settings[key].includes('\0')) {
        throw new Error(`${key} must be an absolute remote path`);
      }
    }
    if (Buffer.byteLength(`${settings.directory}/runtime.sock`) > 100) throw new Error('Runtime directory is too long');
    await this.remote.install(settings);
    this.db.workbench.saveRuntimeSettings(settings);
  }

  run(taskId: string, requestId: string, prompt: string) {
    const run = this.db.workbench.enqueue(taskId, requestId, prompt);
    void this.reconcile(run.id);
    return run;
  }

  async stop(runId: string): Promise<void> {
    const store = this.db.workbench;
    const run = store.run(runId);
    const execution = store.execution(runId);
    if (!run || !execution) throw new Error('Managed run not found');
    if (run.state === 'lost') throw new Error('Runtime ownership is lost; process exit cannot be confirmed');
    if (!ACTIVE_RUN_STATES.includes(run.state)) return;
    store.saveExecution({ ...execution, stopRequested: true });
    await this.reconcile(runId);
  }

  reconcile(runId: string): Promise<void> {
    const current = this.pending.get(runId);
    if (current) return current;
    if (this.closed) return Promise.resolve();
    const promise = this.sync(runId).finally(() => this.pending.delete(runId));
    this.pending.set(runId, promise);
    return promise;
  }

  private async sync(runId: string): Promise<void> {
    const store = this.db.workbench;
    const execution = store.execution(runId);
    if (!execution) return;
    let run = store.run(runId)!;
    if (!ACTIVE_RUN_STATES.includes(run.state)) return;
    try {
      const checkout = store.checkout(run.checkoutId)!;
      if (!execution.launch) {
        if (execution.stopRequested) {
          store.updateRun(runId, { state: 'interrupted', endedAt: Date.now() });
          store.releaseCheckout(runId);
          return;
        }
        const codeRef = await this.remote.prepare(execution.settings, checkout.path, execution.source, execution.branch);
        // Persist the exact spawn bytes before sending start. A lost acknowledgement is retried with identical identity.
        execution.launch = this.remote.launch(execution.settings, run.provider, checkout.path, run.prompt);
        store.prepareRun(runId, execution.launch, codeRef);
      }
      await this.remote.request(execution.settings, { method: 'start', runId, ...execution.launch });
      if (store.execution(runId)!.stopRequested) {
        await this.remote.request(execution.settings, { method: 'interrupt', runId });
      }
      let more = true;
      // Bound each poll to avoid starving other runs when replaying a large journal.
      for (let page = 0; page < 10 && more; page++) {
        const result = await this.remote.request<{ events: RemoteEvent[]; more: boolean }>(execution.settings,
          { method: 'events', runId, after: store.run(runId)!.eventCursor, limit: 100 });
        for (const raw of result.events) {
          const { runId: eventRunId, seq, time, type, version: _version, ...data } = raw;
          if (eventRunId !== runId) throw new Error('Runtime returned events for a different run');
          const event: RunEvent = { runId, seq, time, type, data };
          store.ingestEvent(event, () => this.project(event));
        }
        more = result.more;
      }
      store.saveExecution({ ...store.execution(runId)!, connectionError: null, lastSeenAt: Date.now() });
    } catch (error) {
      // Transport failure is not a process failure. Keep both run state and checkout ownership until reconciled.
      store.saveExecution({ ...store.execution(runId)!, connectionError: (error as Error).message });
    }
  }

  private project(event: RunEvent): void {
    const store = this.db.workbench;
    const run = store.run(event.runId)!;
    const payload = event.data;
    switch (event.type) {
      case 'started': store.updateRun(run.id, { state: 'running', startedAt: event.time }); break;
      case 'stopping': store.updateRun(run.id, { state: 'stopping' }); break;
      case 'error': store.updateRun(run.id, { error: String(payload.message) }); break;
      case 'lost': store.updateRun(run.id, { state: 'lost', error: String(payload.reason) }); break;
      case 'protocol': {
        const message = payload.data as Record<string, unknown>;
        if (message.type === 'session') store.updateRun(run.id, { nativeSessionId: String(message.nativeSessionId) });
        if (message.type === 'attention') store.updateRun(run.id, { state: 'waiting' });
        if (message.type === 'attention-resolved') store.updateRun(run.id, { state: 'running' });
        if (message.type === 'result' && message.failed) store.updateRun(run.id, { error: String(message.message ?? 'Provider failed') });
        break;
      }
      case 'exited': {
        const failed = run.error || (!payload.interrupted && payload.exitCode !== 0);
        store.updateRun(run.id, { state: failed ? 'failed' : payload.interrupted ? 'interrupted' : 'completed',
          exitCode: typeof payload.exitCode === 'number' ? payload.exitCode : null,
          signal: typeof payload.signal === 'string' ? payload.signal : null, endedAt: event.time });
        store.releaseCheckout(run.id);
        // Execution completion offers a review; accepting the task remains an explicit user action.
        if (!failed && !payload.interrupted) store.updateTask(run.taskId, { status: 'review' });
        break;
      }
    }
  }

  async close(): Promise<void> {
    this.closed = true;
    clearTimeout(this.timer);
    await this.remote.disconnect();
    await Promise.all(this.pending.values());
    await this.remote.disconnect();
  }
}
