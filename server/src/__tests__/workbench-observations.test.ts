import { expect, it } from 'vitest';
import { createDb } from '../db.js';
import type { ObservedSession } from '../workbench/types.js';

it('observations block shared writers until ended or inspected, and later activity restores the conflict', () => {
  const db = createDb(':memory:');
  try {
    const server = db.createServer({ name: 'test', host: 'localhost', port: 22, username: 'test', authType: 'privateKey' });
    const { project, checkout } = db.workbench.createProjectWithCheckout({ name: 'project' }, { serverId: server.id, path: '/repo' });
    const task = db.workbench.createTask({ projectId: project.id, checkoutId: checkout.id, title: 'Shared task', goal: 'Test', isolation: 'shared' });
    db.workbench.saveRuntimeSettings({ serverId: server.id, nodePath: '/node', claudePath: '/claude', codexPath: '/codex', directory: '/runtime' });
    const observed: ObservedSession = { id: 'observation', checkoutId: checkout.id, scopeId: checkout.id, provider: 'claude',
      sessionId: 'native', cwd: '/repo', event: 'Stop', state: 'idle', revision: 1, firstSeenAt: 1, lastSeenAt: 2,
      taskId: null, dismissedRevision: null };
    db.workbench.ingestObserved(checkout.id, [observed]);
    expect(() => db.workbench.enqueue(task.id, 'run', 'Test')).toThrow(/observed claude/);
    const isolated = db.workbench.createTask({ projectId: project.id, checkoutId: checkout.id, title: 'Isolated', goal: 'Test' });
    expect(db.workbench.enqueue(isolated.id, 'isolated', 'Test').checkoutId).not.toBe(checkout.id);
    db.workbench.updateObserved(observed.id, { taskId: task.id, inspected: true });
    db.workbench.ingestObserved(checkout.id, [observed]);
    expect(db.workbench.observedSessions()[0].dismissedRevision).toBe(1);
    db.workbench.ingestObserved(checkout.id, [{ ...observed, revision: 2 }]);
    expect(() => db.workbench.assertNoObservedWriter(checkout.id)).toThrow(/observed/);
    expect(db.workbench.observedSessions()[0].taskId).toBe(task.id);
    expect(() => db.workbench.updateObserved(observed.id, { taskId: isolated.id })).toThrow(/this checkout/);
    db.workbench.ingestObserved(checkout.id, [{ ...observed, revision: 3, event: 'SessionEnd', state: 'ended' }]);
    expect(db.workbench.enqueue(task.id, 'run', 'Test').checkoutId).toBe(checkout.id);
  } finally { db.close(); }
});
