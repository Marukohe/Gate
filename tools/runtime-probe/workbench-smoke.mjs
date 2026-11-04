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
  const fake = `#!${process.execPath}
import readline from 'node:readline';
import fs from 'node:fs';
const send = (value) => console.log(JSON.stringify(value));
let timer;
const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.method === 'initialize') send({ id: msg.id, result: {} });
  if (msg.method === 'thread/start') send({ id: msg.id, result: { thread: { id: 'fixture-thread' } } });
  if (msg.method === 'turn/start') {
    fs.writeFileSync('received-prompt', msg.params.input[0].text);
    send({ id: msg.id, result: { turn: { id: 'fixture-turn' } } });
    let tick = 0;
    timer = setInterval(() => {
      send({ method: 'item/completed', params: { item: { type: 'agentMessage', text: 'tick ' + ++tick } } });
      if (fs.existsSync('finish-fixture')) {
        clearInterval(timer);
        send({ method: 'turn/completed', params: { turn: { status: 'completed' } } });
      }
    }, 100);
  }
});
input.on('close', () => { clearInterval(timer); process.exit(0); });
`;
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
  assert.equal(ssh(`cat ${quote(`${firstPath}/received-prompt`)}`), prompt);
  assert.equal(ssh(`test ! -e ${quote(`${firstPath}/injected`)} && test ! -e ${quote(`${firstPath}/injected2`)} && printf safe`).trim(), 'safe');
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
      console.log('Browser start, output, stop, and 320/390/1365px layouts passed');
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
    parallelWorktrees: 'passed', confirmedCompletionAndStop: 'passed', provider: 'deterministic app-server fixture; no model call' };
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
