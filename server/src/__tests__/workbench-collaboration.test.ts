import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createDb, type Database } from '../db.js';
import { collaborationPacket } from '../workbench/collaboration.js';
import type { FrozenSnapshot } from '../workbench/types.js';

describe('Task handoff and independent review', () => {
  let db: Database;
  let taskId: string;
  let sourceRunId: string;
  const frozen: FrozenSnapshot = { head: 'head', tree: 'tree', dirty: true, commit: 'fixed', ref: 'refs/gate/review/test',
    base: 'base', patchPath: '/repo/.git/context.patch' };
  beforeEach(() => {
    db = createDb(':memory:');
    const machine = db.createServer({ name: 'test', host: 'localhost', port: 22, username: 'test', authType: 'privateKey' });
    const { project, checkout } = db.workbench.createProjectWithCheckout({ name: 'test' }, { serverId: machine.id, path: '/repo' });
    taskId = db.workbench.createTask({ projectId: project.id, checkoutId: checkout.id, title: 'Task', goal: 'Fix bug',
      acceptance: 'Reproducer passes', isolation: 'shared', provider: 'codex' }).id;
    db.workbench.saveRuntimeSettings({ serverId: machine.id, nodePath: '/node', claudePath: '/claude', codexPath: '/codex', directory: '/runtime' });
    const run = db.workbench.enqueue(taskId, 'implementation', 'Implement');
    sourceRunId = run.id;
    db.workbench.updateRun(run.id, { state: 'completed' }); db.workbench.releaseCheckout(run.id);
  });
  afterEach(() => db.close());

  it('hands off only a confirmed task run and records provider/context identity separately', () => {
    const run = db.workbench.enqueue(taskId, 'handoff', 'Check edge cases', { kind: 'handoff', provider: 'claude', sourceRunId });
    expect(run.provider).toBe('claude');
    expect(db.workbench.task(taskId)?.provider).toBe('claude');
    expect(db.workbench.collaboration(run.id)).toMatchObject({ sourceRunId, sourceProvider: 'codex', goal: 'Fix bug' });
    expect(db.workbench.enqueue(taskId, 'handoff', 'Check edge cases', { kind: 'handoff', provider: 'claude', sourceRunId }).id).toBe(run.id);
    expect(() => db.workbench.enqueue(taskId, 'handoff', 'Check edge cases', { kind: 'handoff', provider: 'codex', sourceRunId })).toThrow(/another request/);
    expect(() => db.workbench.enqueue(taskId, 'next', '', { kind: 'handoff', provider: 'codex', sourceRunId: run.id })).toThrow(/active/);
  });

  it('transfers review ownership atomically and allows another writer without changing the task checkout', () => {
    const checkoutId = db.workbench.task(taskId)!.checkoutId;
    const review = db.workbench.enqueue(taskId, 'review', 'Find regressions', { kind: 'review', provider: 'claude' });
    expect(() => db.workbench.enqueue(taskId, 'writer', 'Continue')).toThrow(/in use/);
    db.workbench.prepareCollaboration(review.id, frozen, 'Review packet', '/review');
    expect(db.workbench.task(taskId)!.checkoutId).toBe(checkoutId);
    expect(db.workbench.run(review.id)!.checkoutId).not.toBe(checkoutId);
    const writer = db.workbench.enqueue(taskId, 'writer', 'Continue');
    expect(writer.checkoutId).toBe(checkoutId);
    const request = db.workbench.addAttention(review.id, 'escalate', 'can_use_tool', { tool_name: 'Bash' }, Date.now());
    expect(request.kind).toBe('unsupported');
    expect(() => db.workbench.decide(request.id, { decision: 'accept' })).toThrow(/Unsupported/);
  });

  it('keeps implementation conclusions out of the independent review prompt', () => {
    const review = db.workbench.enqueue(taskId, 'review', '', { kind: 'review', provider: 'codex' });
    const record = db.workbench.collaboration(review.id)!;
    const packet = collaborationPacket(record, frozen, ['Implementation is definitely correct'], []);
    expect(packet).toContain('Fix bug'); expect(packet).toContain('Reproducer passes');
    expect(packet).toContain('/repo/.git/context.patch'); expect(packet).toContain('Fixed comparison base: base');
    expect(packet).not.toContain('Implementation is definitely correct');
    expect(collaborationPacket({ ...record, kind: 'handoff', sourceRunId }, frozen, ['Check the timeout edge'], []))
      .toContain('Check the timeout edge');
  });
});
