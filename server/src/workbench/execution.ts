import type { Database } from '../db.js';
import { ACTIVE_RUN_STATES } from './store.js';
import { RemoteRuntime, type RemoteEvent, type RuntimeSettings } from './remote.js';
import type { CodeSnapshot, RunEvent } from './types.js';
import path from 'node:path';
import { collaborationPacket } from './collaboration.js';
import { supportsStructuredAnswers } from './attention.js';

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
    const ready = await this.remote.install(settings);
    this.db.workbench.saveRuntimeSettings(ready);
  }

  run(taskId: string, requestId: string, prompt: string) {
    const run = this.db.workbench.enqueue(taskId, requestId, prompt);
    void this.reconcile(run.id);
    return run;
  }

  verify(taskId: string, requestId: string, command: string) {
    const run = this.db.workbench.enqueue(taskId, requestId, command, 'test');
    void this.reconcile(run.id);
    return run;
  }

  collaborate(taskId: string, requestId: string, kind: 'handoff' | 'review', provider: string,
    instructions: string, sourceRunId?: string) {
    const run = this.db.workbench.enqueue(taskId, requestId, instructions, { kind, provider, sourceRunId });
    void this.reconcile(run.id);
    return run;
  }

  decide(id: string, response: unknown) {
    const item = this.db.workbench.decide(id, response);
    if (item.state === 'sending') void this.reconcile(item.runId);
    return item;
  }

  async result(taskId: string) {
    const task = this.db.workbench.task(taskId);
    if (!task) throw new Error('Task not found');
    const checkout = this.db.workbench.checkout(task.checkoutId)!;
    const settings = this.db.workbench.runtimeSettings(checkout.serverId);
    if (!settings) throw new Error('Set up the remote runtime first');
    return this.remote.result(settings, checkout.path);
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
      let checkout = store.checkout(run.checkoutId)!;
      if (!execution.launch) {
        if (execution.stopRequested) {
          store.updateRun(runId, { state: 'interrupted', endedAt: Date.now() });
          const verification = store.verification(runId);
          if (verification) store.saveVerification({ ...verification, state: 'interrupted', endedAt: Date.now() });
          const collaboration = store.collaboration(runId);
          if (collaboration) store.saveCollaboration({ ...collaboration, state: 'interrupted' });
          store.releaseCheckout(runId);
          return;
        }
        execution.settings = await this.remote.install(execution.settings);
        store.saveExecution({ ...store.execution(runId)!, settings: execution.settings });
        let codeRef = await this.remote.prepare(execution.settings, checkout.path, execution.source, execution.branch);
        let collaboration = store.collaboration(runId);
        if (collaboration && !collaboration.snapshot) {
          const reviewPath = collaboration.kind === 'review' ? `${checkout.path}.gate-reviews/${runId}` : undefined;
          const snapshot = await this.remote.freeze(execution.settings, checkout.path, runId, collaboration.kind, reviewPath,
            store.project(store.task(run.taskId)!.projectId)?.defaultBranch);
          const messages = collaboration.sourceRunId ? store.agentMessages(collaboration.sourceRunId) : [];
          const evidence = store.verifications().filter((item) => item.taskId === run.taskId).slice(-10);
          const packet = collaborationPacket(collaboration, snapshot, messages, evidence);
          store.prepareCollaboration(runId, snapshot, packet, reviewPath);
          collaboration = store.collaboration(runId)!;
          run = store.run(runId)!;
          checkout = store.checkout(run.checkoutId)!;
        }
        if (collaboration?.snapshot) codeRef = collaboration.snapshot.commit;
        // Persist the exact spawn bytes before sending start. A lost acknowledgement is retried with identical identity.
        execution.launch = run.kind === 'test' ? this.remote.verification(execution.settings, checkout.path, run.prompt)
          : this.remote.launch(execution.settings, run.provider, checkout.path, collaboration?.packet ?? run.prompt,
            collaboration?.kind === 'review' ? collaboration.snapshot! : undefined);
        store.prepareRun(runId, execution.launch, codeRef);
      }
      // P2 executions predate release pinning; recover their client from the already persisted worker path.
      if (!execution.settings.release) {
        execution.settings.release = path.posix.dirname(execution.launch.args[0]);
        store.saveExecution({ ...store.execution(runId)!, settings: execution.settings });
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
      if (ACTIVE_RUN_STATES.includes(store.run(runId)!.state) && !store.execution(runId)!.stopRequested) {
        for (const item of store.attentionItems(runId).filter((item) => item.state === 'sending')) {
          let response = item.response!;
          if (run.provider === 'codex' && item.kind === 'question' &&
            !supportsStructuredAnswers(execution.launch.initialInput)) {
            response = { answers: Object.fromEntries(Object.entries(response.answers as Record<string, string[]>)
              .map(([id, answers]) => [id, { answers }])) };
          }
          await this.remote.request(execution.settings, { method: 'input', runId, inputId: item.id,
            data: JSON.stringify({ id: item.requestId, ...response }) + '\n' });
        }
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
      case 'started': {
        store.updateRun(run.id, { state: 'running', startedAt: event.time });
        const collaboration = store.collaboration(run.id);
        if (collaboration) store.saveCollaboration({ ...collaboration, state: 'running' });
        break;
      }
      case 'stopping': store.updateRun(run.id, { state: 'stopping' }); break;
      case 'error': store.updateRun(run.id, { error: String(payload.message) }); break;
      case 'lost': {
        store.updateRun(run.id, { state: 'lost', error: String(payload.reason) });
        store.expireAttention(run.id, event.time);
        store.addAttention(run.id, 'ownership-loss', 'failure', { message: payload.reason }, event.time);
        const verification = store.verification(run.id);
        if (verification) store.saveVerification({ ...verification, state: 'lost' });
        const collaboration = store.collaboration(run.id);
        if (collaboration) store.saveCollaboration({ ...collaboration, state: 'lost' });
        break;
      }
      case 'protocol': {
        const message = payload.data as Record<string, unknown>;
        if (message.type === 'session') store.updateRun(run.id, { nativeSessionId: String(message.nativeSessionId) });
        if (message.type === 'attention') {
          store.addAttention(run.id, String(message.id), String(message.kind),
            message.detail as Record<string, unknown>, event.time);
          store.updateRun(run.id, { state: 'waiting' });
        }
        if (message.type === 'attention-resolved' || message.type === 'decision-error') {
          store.resolveAttention(run.id, String(message.id), event.time);
          if (message.type === 'decision-error') {
            const item = store.attentionItems(run.id).find((value) => value.requestId === String(message.id));
            if (item) store.saveAttention({ ...item, state: 'expired' });
            store.addAttention(run.id, `delivery-error-${message.id}`, 'failure', { message: message.message }, event.time);
          }
          const waiting = store.attentionItems(run.id).some((item) => item.kind !== 'failure' &&
            ['pending', 'sending'].includes(item.state));
          store.updateRun(run.id, { state: waiting || message.type === 'decision-error' ? 'waiting' : 'running' });
        }
        const verification = store.verification(run.id);
        if (verification && message.type === 'verification-started') store.saveVerification({ ...verification,
          state: 'running', before: message.before as unknown as CodeSnapshot, startedAt: Number(message.startedAt) });
        if (verification && message.type === 'verification-completed') store.saveVerification({ ...verification,
          after: message.after as unknown as CodeSnapshot | null, endedAt: Number(message.endedAt),
          exitCode: typeof message.exitCode === 'number' ? message.exitCode : null,
          signal: typeof message.signal === 'string' ? message.signal : null });
        if (message.type === 'result' && message.failed) store.updateRun(run.id, { error: String(message.message ?? 'Provider failed') });
        break;
      }
      case 'exited': {
        const failed = run.error || (!payload.interrupted && payload.exitCode !== 0);
        store.updateRun(run.id, { state: failed ? 'failed' : payload.interrupted ? 'interrupted' : 'completed',
          exitCode: typeof payload.exitCode === 'number' ? payload.exitCode : null,
          signal: typeof payload.signal === 'string' ? payload.signal : null, endedAt: event.time });
        store.releaseCheckout(run.id);
        store.expireAttention(run.id, event.time);
        if (failed) store.addAttention(run.id, 'run-failure', 'failure',
          { message: run.error ?? `Process exited ${payload.exitCode ?? payload.signal}`, exitCode: payload.exitCode }, event.time);
        const verification = store.verification(run.id);
        if (verification) store.saveVerification({ ...verification,
          state: failed ? 'failed' : payload.interrupted ? 'interrupted' : 'passed',
          endedAt: verification.endedAt ?? event.time,
          exitCode: verification.endedAt ? verification.exitCode : typeof payload.exitCode === 'number' ? payload.exitCode : null,
          signal: verification.signal ?? (typeof payload.signal === 'string' ? payload.signal : null) });
        const collaboration = store.collaboration(run.id);
        if (collaboration) store.saveCollaboration({ ...collaboration,
          state: failed ? 'failed' : payload.interrupted ? 'interrupted' : 'completed',
          result: store.agentMessages(run.id).join('\n\n') || null });
        // A review finishing in its own checkout must not overwrite a concurrently running implementation's status.
        if (!failed && !payload.interrupted && run.kind !== 'review') store.updateTask(run.taskId, { status: 'review' });
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
