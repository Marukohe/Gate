// Uses only localhost SSH and isolated repositories, runtime state, and database.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { createDb } from '../../server/dist/db.js';
import { ExecutionService } from '../../server/dist/workbench/execution.js';
import { RemoteRuntime } from '../../server/dist/workbench/remote.js';

const quote = (value) => `'${value.replace(/'/g, `'\\''`)}'`;
const ssh = (command, input) => execFileSync('ssh', ['-o', 'BatchMode=yes', 'localhost', command],
  { input, encoding: 'utf8', timeout: 30_000 });
const root = ssh('mktemp -d /tmp/gate-p2.XXXXXX').trim();
const key = process.env.GATE_TEST_SSH_KEY || path.join(os.homedir(), '.ssh/id_rsa');
const dbPath = `${root}/gate.db`;
let backend;
let remote;
let service;
let db;
let success = false;
async function until(fn, label = 'condition') {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    try { const result = await fn(); if (result) return result; } catch {}
    await delay(100);
  }
  throw new Error(`Timed out: ${label}`);
}
const port = await new Promise((resolve) => {
  const listener = net.createServer();
  listener.listen(0, '127.0.0.1', () => {
    const value = listener.address().port;
    listener.close(() => resolve(value));
  });
});
const base = `http://127.0.0.1:${port}`;
async function api(route, method = 'GET', body) {
  const result = await fetch(base + '/api/workbench' + route, { method,
    headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  const data = await result.json();
  if (!result.ok) throw new Error(data.error);
  return data;
}
async function startBackend() {
  backend = spawn(process.execPath, ['server/dist/index.js'], { env: {
    ...process.env, PORT: String(port), HOST: '127.0.0.1', GATE_DATA_DIR: root,
  }, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  backend.stdout.on('data', (chunk) => { output += chunk; });
  backend.stderr.on('data', (chunk) => { output += chunk; });
  try { await until(async () => (await fetch(base + '/api/health')).ok, 'backend startup'); }
  catch (error) { throw new Error(`${error.message}: ${output}`); }
}
async function stopBackend() {
  if (!backend || backend.exitCode !== null) return;
  const exited = once(backend, 'exit');
  backend.kill('SIGTERM');
  await exited;
  backend = null;
}
try {
  const fake = '#!' + process.execPath + '\n' + fs.readFileSync(
    new URL('./workbench-fixture.mjs', import.meta.url), 'utf8').split('\n').slice(1).join('\n');
  ssh(`cat > ${quote(`${root}/fake-codex.mjs`)} && chmod 700 ${quote(`${root}/fake-codex.mjs`)}`, fake);
  ssh(`git init -q ${quote(`${root}/repo`)} && git -C ${quote(`${root}/repo`)} -c user.name=Gate -c user.email=gate@example.invalid commit -qm initial --allow-empty`);
  db = createDb(dbPath);
  const machine = db.createServer({ name: 'Isolated localhost', host: '127.0.0.1', port: 22,
    username: os.userInfo().username, authType: 'privateKey', privateKeyPath: key });
  const { project, checkout } = db.workbench.createProjectWithCheckout({ name: 'P2 smoke', defaultProvider: 'codex' },
    { serverId: machine.id, path: `${root}/repo` });
  const first = db.workbench.createTask({ projectId: project.id, checkoutId: checkout.id, title: 'First', goal: 'first' });
  const second = db.workbench.createTask({ projectId: project.id, checkoutId: checkout.id, title: 'Second', goal: 'second' });
  // Reproduce an interrupted Git preparation that left the task branch but no worktree.
  ssh(`git -C ${quote(`${root}/repo`)} branch ${quote(`gate/${first.id}`)}`);
  db.close(); db = null;
  await startBackend();
  const settings = { serverId: machine.id, nodePath: process.execPath, codexPath: `${root}/fake-codex.mjs`,
    claudePath: `${root}/fake-codex.mjs`, directory: `${root}/rt` };
  await api(`/machines/${machine.id}/runtime`, 'PUT', settings);
  const hook = await api(`/checkouts/${checkout.id}/hooks`, 'PUT', { provider: 'claude', enabled: true });
  const codexHook = await api(`/checkouts/${checkout.id}/hooks`, 'PUT', { provider: 'codex', enabled: true });
  assert.equal(codexHook.needsTrust, true);
  const emitHook = (event, command = hook.command, sessionId = 'external-claude') => ssh(command,
    JSON.stringify({ cwd: checkout.path, session_id: sessionId, hook_event_name: event, prompt: 'private input' }));
  emitHook('SessionStart');
  const observed = await until(async () => (await api('')).observedSessions.find((item) => item.sessionId === 'external-claude'), 'external hook event');
  const externalTask = await api('/tasks', 'POST', { projectId: project.id, checkoutId: checkout.id,
    title: 'External shared task', goal: 'External work', isolation: 'shared' });
  await assert.rejects(api(`/tasks/${externalTask.id}/runs`, 'POST', { requestId: 'conflicting-writer' }), /observed claude/);
  await api(`/observed-sessions/${observed.id}`, 'PATCH', { taskId: externalTask.id });
  await stopBackend(); await startBackend();
  assert.equal((await api('')).observedSessions.find((item) => item.id === observed.id).taskId, externalTask.id);
  await api(`/observed-sessions/${observed.id}`, 'PATCH', { inspected: true });
  emitHook('PermissionRequest');
  await until(async () => (await api('')).observedSessions.find((item) => item.id === observed.id).revision > observed.revision, 'activity after inspection');
  await assert.rejects(api(`/tasks/${externalTask.id}/runs`, 'POST', { requestId: 'conflicting-again' }), /observed claude/);
  emitHook('SessionEnd');
  emitHook('SessionStart', codexHook.command, 'external-codex');
  emitHook('SessionEnd', codexHook.command, 'external-codex');
  await until(async () => {
    const items = (await api('')).observedSessions;
    return items.length === 2 && items.every((item) => item.state === 'ended');
  }, 'external session end');
  const prompt = 'literal 中文 $(touch injected) `touch injected2` $HOME';
  const [one, duplicate] = await Promise.all([
    api(`/tasks/${first.id}/runs`, 'POST', { requestId: 'first-request', prompt }),
    api(`/tasks/${first.id}/runs`, 'POST', { requestId: 'first-request', prompt }),
  ]);
  assert.equal(one.id, duplicate.id);
  const two = await api(`/tasks/${second.id}/runs`, 'POST', { requestId: 'second-request' });
  await until(async () => (await api('')).runs.filter((run) => run.state === 'running').length === 2, 'parallel runs');
  const before = await until(async () => {
    const events = await api(`/runs/${one.id}/events`);
    return events.length > 7 ? events : null;
  }, 'initial output');
  const snapshot = await api('');
  const firstPath = snapshot.checkouts.find((c) => c.id === snapshot.tasks.find((t) => t.id === first.id).checkoutId).path;
  const secondPath = snapshot.checkouts.find((c) => c.id === snapshot.tasks.find((t) => t.id === second.id).checkoutId).path;
  assert.notEqual(firstPath, secondPath);
  const decisionTask = await api('/tasks', 'POST', { projectId: project.id, checkoutId: checkout.id,
    title: 'Decisions', goal: 'approval-fixture', provider: 'codex' });
  const decisionRun = await api(`/tasks/${decisionTask.id}/runs`, 'POST', { requestId: 'decision-request', prompt: 'approval-fixture' });
  await until(async () => (await api('')).attention.filter((item) => item.runId === decisionRun.id).length === 2, 'two pending decisions');
  await stopBackend(); await startBackend();
  const decisions = (await api('')).attention.filter((item) => item.runId === decisionRun.id);
  assert.equal(decisions.length, 2);
  const approval = decisions.find((item) => item.kind === 'approval');
  const responses = await Promise.all(['accept', 'decline'].map((decision) => fetch(
    `${base}/api/workbench/attention/${approval.id}/respond`, { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ decision }) })));
  assert.deepEqual(responses.map((response) => response.status).sort(), [200, 409]);
  await until(async () => (await api('')).attention.find((item) => item.id === approval.id).state === 'resolved', 'approval delivery');
  assert.equal((await api('')).runs.find((run) => run.id === decisionRun.id).state, 'waiting');
  const question = decisions.find((item) => item.kind === 'question');
  await api(`/attention/${question.id}/respond`, 'POST', { answers: { target: ['Linux'] } });
  await until(async () => (await api('')).runs.find((run) => run.id === decisionRun.id).state === 'completed', 'question delivery');
  const decisionSnapshot = await api('');
  const decisionPath = decisionSnapshot.checkouts.find((item) => item.id === decisionSnapshot.tasks.find((item) => item.id === decisionTask.id).checkoutId).path;
  const delivered = ssh(`cat ${quote(`${decisionPath}/decision-replies`)}`).trim().split('\n').map(JSON.parse);
  assert.equal(delivered.length, 2);
  assert.deepEqual(delivered.find((item) => item.id === 101).result.answers, { target: { answers: ['Linux'] } });

  const verificationTask = await api('/tasks', 'POST', { projectId: project.id, checkoutId: checkout.id,
    title: 'Verification', goal: 'verify evidence', provider: 'codex' });
  const testRun = await api(`/tasks/${verificationTask.id}/verify`, 'POST', {
    requestId: 'verify-pass', command: "printf 'verified 中文\\n'",
  });
  const evidence = await until(async () => (await api('')).verifications.find((item) => item.runId === testRun.id && item.state === 'passed'), 'passing verification');
  assert.equal(evidence.exitCode, 0);
  assert.equal(evidence.before.tree, evidence.after.tree);
  const current = await api(`/tasks/${verificationTask.id}/result`);
  assert.equal(current.snapshot.tree, evidence.before.tree);
  ssh(`printf changed > ${quote(`${evidence.cwd}/new-code.txt`)}`);
  const changed = await api(`/tasks/${verificationTask.id}/result`);
  assert.notEqual(changed.snapshot.tree, evidence.before.tree);
  assert.ok(changed.diff.includes('+changed'));
  const failedRun = await api(`/tasks/${verificationTask.id}/verify`, 'POST', {
    requestId: 'verify-fail', command: 'printf expected-failure >&2; exit 7',
  });
  const failed = await until(async () => (await api('')).verifications.find((item) => item.runId === failedRun.id && item.state === 'failed'), 'failing verification');
  assert.equal(failed.exitCode, 7);
  assert.notEqual((await api('')).tasks.find((item) => item.id === verificationTask.id).status, 'done');
  const failure = (await api('')).attention.find((item) => item.runId === failedRun.id && item.kind === 'failure');
  assert.ok(failure);
  await api(`/attention/${failure.id}/respond`, 'POST', { decision: 'acknowledge' });
  const downloaded = await (await fetch(`${base}/api/workbench/runs/${failedRun.id}/log`)).text();
  assert.ok(downloaded.includes('expected-failure'));
  assert.ok(downloaded.includes('verification-completed'));

  assert.equal(ssh(`cat ${quote(`${firstPath}/received-prompt`)}`), prompt);
  assert.equal(ssh(`test ! -e ${quote(`${firstPath}/injected`)} && test ! -e ${quote(`${firstPath}/injected2`)} && printf safe`).trim(), 'safe');
  const collaborationTask = await api('/tasks', 'POST', { projectId: project.id, checkoutId: checkout.id,
    title: 'Collaborative task', goal: 'Implement handoff behavior', acceptance: 'Timeout edge is covered', provider: 'claude' });
  const original = await api(`/tasks/${collaborationTask.id}/runs`, 'POST', { requestId: 'original-claude' });
  await until(async () => (await api('')).runs.find((run) => run.id === original.id).state === 'completed', 'initial Claude fixture');
  const check = await api(`/tasks/${collaborationTask.id}/verify`, 'POST', { requestId: 'handoff-evidence', command: 'printf handoff-test' });
  await until(async () => (await api('')).runs.find((run) => run.id === check.id).state === 'completed', 'handoff evidence');
  const handed = await api(`/tasks/${collaborationTask.id}/collaborate`, 'POST', { requestId: 'handoff', kind: 'handoff',
    sourceRunId: original.id, provider: 'codex', instructions: 'Check edge cases' });
  const handoff = await until(async () => (await api('')).collaborations.find((item) => item.runId === handed.id && item.state === 'running'), 'handoff running');
  assert.ok(handoff.packet.includes('Prior agent finding'));
  assert.ok(handoff.packet.includes('handoff-test'));
  assert.ok(handoff.packet.includes('Timeout edge is covered'));
  const handoffState = await api('');
  const sourcePath = handoffState.checkouts.find((item) => item.id === handed.checkoutId).path;
  assert.ok(ssh(`cat ${quote(`${sourcePath}/received-prompt`)}`).includes('Handoff from claude'));
  ssh(`touch ${quote(`${sourcePath}/finish-fixture`)}`);
  await until(async () => (await api('')).runs.find((run) => run.id === handed.id).state === 'completed', 'handoff completion');
  const reviewed = await api(`/tasks/${collaborationTask.id}/collaborate`, 'POST', { requestId: 'review', kind: 'review',
    provider: 'codex', instructions: 'Find regressions independently' });
  const review = await until(async () => (await api('')).collaborations.find((item) => item.runId === reviewed.id && item.state === 'running'), 'fixed review running');
  assert.ok(!review.packet.includes('Prior agent finding'));
  const reviewState = await api('');
  const reviewCheckout = reviewState.checkouts.find((item) => item.id === reviewState.runs.find((item) => item.id === reviewed.id).checkoutId);
  assert.notEqual(reviewCheckout.path, sourcePath);
  assert.equal(ssh(`git -C ${quote(reviewCheckout.path)} rev-parse HEAD`).trim(), review.snapshot.commit);
  await stopBackend(); await startBackend();
  const writer = await api(`/tasks/${collaborationTask.id}/verify`, 'POST', { requestId: 'parallel-writer',
    command: 'printf changed > after-review.txt; sleep 4; printf verification-done' });
  await until(async () => (await api('')).runs.find((item) => item.id === writer.id).state === 'running', 'writer alongside review');
  ssh(`touch ${quote(`${root}/finish-review`)}`);
  await until(async () => (await api('')).collaborations.find((item) => item.runId === reviewed.id).state === 'completed', 'independent review result');
  const concurrently = await api('');
  assert.equal(concurrently.tasks.find((item) => item.id === collaborationTask.id).status, 'in-progress');
  assert.equal(ssh(`test ! -e ${quote(`${reviewCheckout.path}/after-review.txt`)} && printf isolated`).trim(), 'isolated');
  await until(async () => (await api('')).runs.find((item) => item.id === writer.id).state === 'completed', 'writer completion');
  const latestCode = await api(`/tasks/${collaborationTask.id}/result`);
  assert.notEqual(latestCode.snapshot.tree, review.snapshot.tree);
  const invalidReview = await api(`/tasks/${collaborationTask.id}/collaborate`, 'POST', { requestId: 'mutated-review',
    kind: 'review', provider: 'codex', instructions: 'mutate-fixture' });
  await until(async () => (await api('')).collaborations.find((item) => item.runId === invalidReview.id).state === 'failed', 'review mutation rejection');
  assert.equal(ssh(`test ! -e ${quote(`${sourcePath}/unexpected-review-edit`)} && printf safe`).trim(), 'safe');

  if (process.env.GATE_TEST_PLAYWRIGHT) {
    const { chromium } = await import(process.env.GATE_TEST_PLAYWRIGHT);
    const browser = await chromium.launch({ headless: true, executablePath: process.env.GATE_TEST_CHROMIUM,
      args: ['--no-sandbox'] });
    try {
      const context = await browser.newContext({ serviceWorkers: 'block' });
      const page = await context.newPage();
      const errors = [];
      page.on('pageerror', (error) => errors.push(error.message));
      const third = await api('/tasks', 'POST', { projectId: project.id, checkoutId: checkout.id,
        title: 'Browser task', goal: 'Browser run', provider: 'codex' });
      await page.goto(`${base}/#task/${third.id}`);
      await page.getByRole('button', { name: 'Start task', exact: true }).waitFor();
      await page.getByRole('textbox', { name: 'Run instructions' }).fill('Started from the browser');
      await page.getByRole('button', { name: 'Start task', exact: true }).click();
      await page.getByText(/tick 1/).waitFor();
      await page.getByRole('button', { name: 'Stop run', exact: true }).click();
      await until(async () => (await api('')).runs.some((run) => run.taskId === third.id && run.state === 'interrupted'), 'browser stop');
      const browserDecision = await api('/tasks', 'POST', { projectId: project.id, checkoutId: checkout.id,
        title: 'Browser decisions', goal: 'approval-fixture', provider: 'codex' });
      const browserRun = await api(`/tasks/${browserDecision.id}/runs`, 'POST', { requestId: 'browser-decisions', prompt: 'approval-fixture' });
      const secondPage = await context.newPage();
      await Promise.all([page.goto(`${base}/#task/${browserDecision.id}`), secondPage.goto(`${base}/#task/${browserDecision.id}`)]);
      await page.getByRole('button', { name: 'Allow once' }).waitFor();
      await secondPage.getByRole('button', { name: 'Allow once' }).waitFor();
      await page.setViewportSize({ width: 390, height: 900 });
      await page.screenshot({ path: '/tmp/gate-p3-attention.png', fullPage: true });
      await page.getByRole('button', { name: 'Allow once' }).click();
      await secondPage.getByRole('button', { name: 'Allow once' }).waitFor({ state: 'hidden' });
      await secondPage.getByRole('radio', { name: /Linux/ }).check();
      await secondPage.getByRole('button', { name: 'Send answer' }).click();
      await until(async () => (await api('')).runs.find((item) => item.id === browserRun.id).state === 'completed', 'two-browser decisions');
      await page.getByText('Decision history (2)').waitFor();
      await secondPage.close();
      await page.getByRole('textbox', { name: 'Test command', exact: true }).fill('printf browser-verification');
      await page.getByRole('button', { name: 'Run verification', exact: true }).click();
      await page.getByText('passed ·', { exact: false }).waitFor();
      await page.getByRole('button', { name: 'Refresh changes', exact: true }).click();
      await page.getByText('Matches the last captured checkout.', { exact: true }).waitFor();
      await page.screenshot({ path: '/tmp/gate-p3-verification.png', fullPage: true });
      assert.notEqual((await api('')).tasks.find((item) => item.id === browserDecision.id).status, 'done');
      await page.getByRole('combobox', { name: 'Task status' }).selectOption('done');
      await until(async () => (await api('')).tasks.find((item) => item.id === browserDecision.id).status === 'done', 'explicit task acceptance');
      await page.goto(`${base}/#task/${collaborationTask.id}`);
      await page.getByRole('combobox', { name: 'Next agent' }).selectOption('claude');
      await page.getByRole('textbox', { name: 'Handoff or review instructions' }).fill('Continue with the recorded context');
      const previous = (await api('')).collaborations.length;
      await page.getByRole('button', { name: 'Hand off task', exact: true }).click();
      await until(async () => {
        const items = (await api('')).collaborations;
        return items.length === previous + 1 && items.filter((item) => item.taskId === collaborationTask.id).at(-1).state === 'completed';
      }, 'browser handoff');
      await page.getByRole('button', { name: 'Refresh changes', exact: true }).click();
      await page.getByText('Task code has changed since this review snapshot.', { exact: true }).first().waitFor();
      await page.getByRole('heading', { name: 'Handoff & independent review', exact: true }).scrollIntoViewIfNeeded();
      await page.screenshot({ path: '/tmp/gate-p4-collaboration.png' });
      for (const width of [320, 390, 1365]) {
        await page.setViewportSize({ width, height: 900 });
        const clipped = await page.locator('button:visible, input:visible, textarea:visible, select:visible').evaluateAll((elements) =>
          elements.filter((element) => { const box = element.getBoundingClientRect(); return box.left < 0 || box.right > innerWidth + 1; }).length);
        assert.equal(clipped, 0, `Collaboration controls at ${width}px`);
      }
      emitHook('PermissionRequest');
      await page.goto(`${base}/#task/${externalTask.id}`);
      await page.getByRole('button', { name: 'I confirmed this session exited', exact: true }).waitFor();
      await page.getByRole('combobox', { name: 'Task for external-claude', exact: true }).selectOption(externalTask.id);
      for (const width of [320, 390, 1365]) {
        await page.setViewportSize({ width, height: 900 });
        await page.getByRole('heading', { name: 'External sessions', exact: true }).scrollIntoViewIfNeeded();
        const clipped = await page.locator('button:visible, input:visible, textarea:visible, select:visible').evaluateAll((elements) =>
          elements.filter((element) => { const box = element.getBoundingClientRect(); return box.left < 0 || box.right > innerWidth + 1; }).length);
        assert.equal(clipped, 0, `External session controls at ${width}px`);
        if (width === 390) await page.screenshot({ path: '/tmp/gate-p4-hooks.png' });
      }
      await page.getByRole('button', { name: 'I confirmed this session exited', exact: true }).click();
      await page.getByText('claude · manually cleared', { exact: true }).waitFor();
      await page.getByText('Manage checkout hooks', { exact: true }).click();
      await page.getByRole('button', { name: 'Remove claude hooks', exact: true }).click();
      await page.getByRole('button', { name: 'Install claude hooks', exact: true }).waitFor();
      assert.equal(JSON.stringify(JSON.parse(fs.readFileSync(hook.file, 'utf8'))).includes('gate-observer:'), false);
      await page.goto(`${base}/#task/${first.id}`);
      await page.getByText(/tick 1/).waitFor();
      for (const width of [320, 390, 1365]) {
        await page.setViewportSize({ width, height: 900 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
        const clipped = await page.locator('button:visible, input:visible, textarea:visible, select:visible').evaluateAll((elements) =>
          elements.filter((element) => { const box = element.getBoundingClientRect(); return box.left < 0 || box.right > innerWidth + 1; }).length);
        assert.equal(clipped, 0);
        await page.screenshot({ path: `/tmp/gate-p2-${width}.png`, fullPage: true });
      }
      assert.deepEqual(errors, []);
      console.log('Browser execution, two-client decisions, verification, explicit acceptance, and 320/390/1365px layouts passed');
    } finally { await browser.close(); }
  }
  await stopBackend();
  await delay(400);
  await startBackend();
  const after = await until(async () => {
    const events = await api(`/runs/${one.id}/events`);
    return events.length > before.length + 2 ? events : null;
  }, 'replay after backend restart');
  assert.equal(after.filter((event) => event.type === 'started').length, 1);
  assert.deepEqual(after.map((event) => event.seq), after.map((_, index) => index + 1));
  await stopBackend();

  // Reuse the production service and deliberately close its own SSH transport, without stopping sshd or other sessions.
  db = createDb(dbPath);
  remote = new RemoteRuntime(db);
  service = new ExecutionService(db, remote);
  await service.reconcile(one.id);
  const cursor = db.workbench.run(one.id).eventCursor;
  await remote.disconnect();
  await delay(400);
  await service.reconcile(one.id);
  assert.ok(db.workbench.run(one.id).eventCursor > cursor);
  assert.equal(db.workbench.events(one.id).filter((event) => event.type === 'started').length, 1);
  ssh(`touch ${quote(`${firstPath}/finish-fixture`)}`);
  await until(async () => { await service.reconcile(one.id); return db.workbench.run(one.id).state === 'completed'; }, 'confirmed completion');
  assert.equal(db.workbench.task(first.id).status, 'review');
  assert.equal(db.workbench.task(second.id).status, 'in-progress');
  await service.stop(two.id);
  await until(async () => { await service.reconcile(two.id); return db.workbench.run(two.id).state === 'interrupted'; }, 'confirmed stop');
  assert.equal(db.workbench.run(one.id).exitCode, 0);
  const report = { backendRestart: 'passed', sshReconnect: 'passed', deduplicatedStart: 'passed', literalPrompt: 'passed',
    parallelWorktrees: 'passed', confirmedCompletionAndStop: 'passed',
    durableDecisions: 'passed', concurrentDecisionConflict: 'passed', verificationSnapshotsAndLogs: 'passed', handoff: 'passed', fixedReviewWithConcurrentWriter: 'passed',
    modifiedReviewRejected: 'passed', scopedHooksAndExternalConflicts: 'passed',
    provider: 'deterministic app-server fixture and hook payloads; no model call' };
  console.log(JSON.stringify(report, null, 2));
  await remote.request(settings, { method: 'shutdown' });
  await until(async () => { try { await remote.request(settings, { method: 'ping' }); return false; } catch { return true; } }, 'runtime drain');
  success = true;
} finally {
  await stopBackend();
  await service?.close();
  await remote?.disconnect();
  db?.close();
  if (success) fs.rmSync(root, { recursive: true, force: true });
  else console.error(`Failure state retained at ${root}; inspect its runtime before removing it.`);
}
