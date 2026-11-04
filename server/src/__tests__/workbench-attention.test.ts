import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDb, type Database } from '../db.js';
import { describeAttention } from '../workbench/attention.js';
import BetterSqlite3 from 'better-sqlite3';

describe('Durable decisions', () => {
  let db: Database;
  let directory: string;
  let runId: string;
  beforeEach(() => {
    directory = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-attention-'));
    db = createDb(path.join(directory, 'gate.db'));
    const machine = db.createServer({ name: 'test', host: 'localhost', port: 22, username: 'test', authType: 'privateKey' });
    const { project, checkout } = db.workbench.createProjectWithCheckout({ name: 'test' }, { serverId: machine.id, path: '/repo' });
    const task = db.workbench.createTask({ projectId: project.id, checkoutId: checkout.id, title: 'Task', goal: 'Goal' });
    runId = db.workbench.createRun({ taskId: task.id, provider: 'codex', kind: 'implementation', requestId: 'start', prompt: 'work' }).id;
    db.workbench.updateRun(runId, { state: 'waiting' });
  });
  afterEach(() => { db.close(); fs.rmSync(directory, { recursive: true, force: true }); });

  it('preserves a single submitted answer across concurrent writers and database reopen', () => {
    const item = db.workbench.addAttention(runId, '42', 'item/commandExecution/requestApproval',
      { command: 'npm test', availableDecisions: ['accept', 'decline'] }, Date.now());
    expect(db.workbench.decide(item.id, { decision: 'accept' }).state).toBe('sending');
    expect(db.workbench.decide(item.id, { decision: 'accept' }).id).toBe(item.id);
    expect(() => db.workbench.decide(item.id, { decision: 'decline' })).toThrow(/already answered/);
    db.close(); db = createDb(path.join(directory, 'gate.db'));
    expect(db.workbench.attentionItem(item.id)).toMatchObject({ state: 'sending', response: { decision: 'accept' } });
    db.workbench.resolveAttention(runId, '42', Date.now());
    expect(db.workbench.attentionItem(item.id)?.state).toBe('resolved');
    expect(db.workbench.task(db.workbench.run(runId)!.taskId)?.status).toBe('backlog');
  });

  it('offers cancellation when the provider offers cancel instead of decline', () => {
    const item = db.workbench.addAttention(runId, '42', 'item/commandExecution/requestApproval',
      { command: 'printf probe', availableDecisions: ['accept', { acceptWithExecpolicyAmendment: {} }, 'cancel'] }, Date.now());
    expect(item.choices).toEqual(['accept', 'cancel']);
    expect(() => db.workbench.decide(item.id, { decision: 'decline' })).toThrow(/not offered/);
    expect(db.workbench.decide(item.id, { decision: 'cancel' }).response).toEqual({ decision: 'cancel' });
    db.workbench.saveExecution({ runId, settings: { serverId: 'fixture', nodePath: '/node', directory: '/runtime',
      claudePath: '/claude', codexPath: '/codex' }, source: null, branch: null, stopRequested: false,
      connectionError: null, lastSeenAt: null, launch: { command: '/node', args: ['/old/worker.mjs'], cwd: '/repo',
        initialInput: '{"gateProtocol":2}', protocol: true } });
    const old = db.workbench.addAttention(runId, 'old-worker', 'item/commandExecution/requestApproval',
      { availableDecisions: ['accept', 'cancel'] }, Date.now());
    expect(old.choices).toEqual(['accept']);
  });

  it('expires provider-cancelled and terminal-run requests without treating them as answered', () => {
    const item = db.workbench.addAttention(runId, '42', 'item/fileChange/requestApproval', {}, Date.now());
    db.workbench.resolveAttention(runId, '42', Date.now());
    expect(db.workbench.attentionItem(item.id)).toMatchObject({ state: 'expired', response: null });
    expect(() => db.workbench.decide(item.id, { decision: 'accept' })).toThrow(/expired/);
    const next = db.workbench.addAttention(runId, '43', 'item/fileChange/requestApproval', {}, Date.now());
    db.workbench.decide(next.id, { decision: 'decline' });
    db.workbench.expireAttention(runId, Date.now());
    expect(db.workbench.attentionItem(next.id)?.state).toBe('expired');
  });

  it('validates complete answers, keeps unknown requests unsupported, and records failure acknowledgement', () => {
    const item = db.workbench.addAttention(runId, 'question', 'item/tool/requestUserInput', {
      questions: [{ id: 'choice', question: 'Which target?', options: [{ label: 'Linux', description: 'Local tests' }] }],
    }, Date.now());
    expect(item.kind).toBe('question');
    expect(() => db.workbench.decide(item.id, { answers: {} })).toThrow(/every question/);
    expect(db.workbench.decide(item.id, { answers: { choice: ['Windows'], ignored: ['extra'] } }).response)
      .toEqual({ answers: { choice: ['Windows'] } });
    const unsupported = db.workbench.addAttention(runId, 'unknown', 'new/request', {}, Date.now());
    expect(unsupported.kind).toBe('unsupported');
    expect(() => db.workbench.decide(unsupported.id, { decision: 'accept' })).toThrow(/Unsupported/);
    db.workbench.updateRun(runId, { state: 'failed' });
    const failure = db.workbench.addAttention(runId, 'failure', 'failure', { message: 'Tests failed' }, Date.now());
    expect(db.workbench.decide(failure.id, { decision: 'acknowledge' }).state).toBe('resolved');
    expect(db.workbench.run(runId)?.state).toBe('failed');
    expect(describeAttention('claude', 'can_use_tool', { tool_name: 'AskUserQuestion', input: {
      questions: [{ question: 'Which features?', multiSelect: true, options: [] }],
    } })).toMatchObject({ kind: 'question', questions: [{ id: '0', multiSelect: true }] });
  });

  it('imports already-consumed P2 requests once without rewinding the runtime cursor', () => {
    db.workbench.ingestEvent({ runId, seq: 1, time: Date.now(), type: 'protocol', data: { data: {
      type: 'attention', id: 'old-request', kind: 'item/commandExecution/requestApproval', detail: { command: 'npm test' },
    } } });
    db.close();
    const previous = new BetterSqlite3(path.join(directory, 'gate.db'));
    previous.exec("DELETE FROM workbench_features WHERE name = 'attention-v1'"); previous.close();
    db = createDb(path.join(directory, 'gate.db'));
    const imported = db.workbench.attentionItems(runId);
    expect(imported).toHaveLength(1);
    expect(imported[0]).toMatchObject({ requestId: 'old-request', state: 'pending' });
    expect(db.workbench.run(runId)?.eventCursor).toBe(1);
    db.workbench.decide(imported[0].id, { decision: 'decline' });
    db.workbench.resolveAttention(runId, 'old-request', Date.now());
    db.close(); db = createDb(path.join(directory, 'gate.db'));
    expect(db.workbench.attentionItems(runId)).toHaveLength(1);
    expect(db.workbench.attentionItem(imported[0].id)?.state).toBe('resolved');
  });
});
