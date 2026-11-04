// Explicit opt-in: sends real model requests using existing local provider authentication.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import readline from 'node:readline';
import { createDb } from '../../server/dist/db.js';
import { ExecutionService } from '../../server/dist/workbench/execution.js';
import { RemoteRuntime } from '../../server/dist/workbench/remote.js';

if (process.env.GATE_LIVE_PROVIDER_TEST !== '1') throw new Error('Set GATE_LIVE_PROVIDER_TEST=1 to send real provider requests');
const root = fs.mkdtempSync('/tmp/gate-live-');
const cache = path.join(os.homedir(), '.cache'); fs.mkdirSync(cache, { recursive: true });
const config = fs.mkdtempSync(path.join(cache, 'gate-live-'));
try { execFileSync('/usr/bin/python3', [new URL('./live-config.py', import.meta.url).pathname, config]); }
catch (error) { fs.rmSync(config, { recursive: true, force: true }); fs.rmSync(root, { recursive: true, force: true }); throw error; }
const quote = (value) => `'${value.replaceAll("'", "'\\''")}'`;
for (const provider of ['claude', 'codex']) {
  const executable = process.env[`GATE_${provider.toUpperCase()}_BIN`] ?? path.join(os.homedir(), '.local/bin', provider);
  fs.writeFileSync(path.join(root, provider), `#!/bin/sh\nexport ${provider === 'codex' ? 'CODEX_HOME' : 'CLAUDE_CONFIG_DIR'}=${quote(path.join(config, provider))}\nexec ${quote(executable)} ` +
    (provider === 'codex' ? '--disable apps --disable hooks ' : '--setting-sources user ') + '"$@"\n', { mode: 0o700 });
}
const db = createDb(path.join(root, 'gate.db'));
const remote = new RemoteRuntime(db);
let service = new ExecutionService(db, remote);
const machine = db.createServer({ name: 'Isolated live providers', host: '127.0.0.1', port: 22,
  username: os.userInfo().username, authType: 'privateKey', privateKeyPath: process.env.GATE_TEST_SSH_KEY ?? path.join(os.homedir(), '.ssh/id_rsa') });
const settings = { serverId: machine.id, nodePath: process.execPath, directory: path.join(root, 'rt'),
  claudePath: path.join(root, 'claude'), codexPath: path.join(root, 'codex') };
const input = readline.createInterface({ input: process.stdin });
input.on('line', (line) => {
  try { const value = JSON.parse(line); service.decide(value.id, value.response); }
  catch (error) { console.log('decision-error', error.message); }
});
let success = false;
const report = {};
try {
  await service.configure(settings);
  for (const provider of (process.env.GATE_LIVE_PROVIDERS ?? 'codex').split(',')) {
    assert.ok(['claude', 'codex'].includes(provider), 'Choose claude or codex');
    const cancel = provider === 'codex' && process.env.GATE_LIVE_CANCEL === '1';
    const expectedState = cancel ? 'interrupted' : 'completed';
    const cwd = path.join(root, `${provider}-repo`);
    execFileSync('git', ['init', '-q', '-b', 'main', cwd]);
    execFileSync('git', ['-C', cwd, '-c', 'user.name=Gate', '-c', 'user.email=gate@example.invalid',
      '-c', 'commit.gpgsign=false', 'commit', '-qm', 'initial', '--allow-empty']);
    const { project, checkout } = db.workbench.createProjectWithCheckout({ name: `Live ${provider}`, defaultProvider: provider },
      { serverId: machine.id, path: cwd });
    const prompt = provider === 'claude'
      ? 'This is an isolated Gate integration test. First call AskUserQuestion with one question: "Which color should the fixture use?", options Blue and Green. Wait for the answer. Then use the Write tool to create gate-smoke.txt in the current directory containing exactly the chosen color followed by a newline. Do not use Bash, plugins, subagents, or network tools. Finish with one sentence.'
      : 'This is an isolated Gate integration test. First run exactly `printf gate-approval-probe` using sandbox_permissions=require_escalated and a short justification asking to verify the approval UI. Wait for approval. Then create gate-smoke.txt in the current directory containing exactly Blue followed by a newline. Use only built-in local tools. Do not access other files, use plugins, subagents, or network tools. Finish with one sentence.';
    const task = db.workbench.createTask({ projectId: project.id, checkoutId: checkout.id, title: `Live ${provider}`, goal: prompt, isolation: 'shared' });
    const run = service.run(task.id, `live-${provider}`, prompt);
    const seen = new Set(); let restarted = false;
    console.log(JSON.stringify({ provider, root, runId: run.id }));
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
      await service.reconcile(run.id);
      const current = db.workbench.run(run.id);
      for (const item of db.workbench.attentionItems(run.id).filter((item) => item.state === 'pending' && !seen.has(item.id))) {
        seen.add(item.id);
        console.log(JSON.stringify({ attention: item.id, kind: item.kind, detail: item.detail, questions: item.questions }));
        if (!restarted && item.kind !== 'failure') {
          await service.close(); service = new ExecutionService(db, new RemoteRuntime(db));
          await service.reconcile(run.id); restarted = true;
          assert.equal(db.workbench.attentionItem(item.id).state, 'pending');
        }
        if (item.kind === 'question') service.decide(item.id, { answers: Object.fromEntries(item.questions.map((q) => [q.id, ['Blue']])) });
        else if (provider === 'claude' && item.kind === 'approval' && item.detail.tool_name === 'Write' &&
          item.detail.input?.file_path === path.join(cwd, 'gate-smoke.txt') && item.detail.input?.content === 'Blue\n') {
          service.decide(item.id, { decision: 'accept' });
        } else if (provider === 'codex' && item.kind === 'approval' &&
          /^\/(?:usr\/)?bin\/(?:bash|zsh|sh) -lc ['"]?printf gate-approval-probe['"]?$/.test(item.detail.command ?? '')) {
          service.decide(item.id, { decision: cancel ? 'cancel' : 'accept' });
        }
      }
      if (['completed', 'failed', 'interrupted', 'lost'].includes(current.state)) {
        console.log(JSON.stringify({ provider, state: current.state, error: current.error }));
        assert.equal(current.state, expectedState, current.error ?? 'Live provider did not finish as expected');
        break;
      }
      await delay(300);
    }
    assert.equal(db.workbench.run(run.id).state, expectedState, 'Live provider timed out');
    if (cancel) assert.equal(fs.existsSync(path.join(cwd, 'gate-smoke.txt')), false);
    else assert.equal(fs.readFileSync(path.join(cwd, 'gate-smoke.txt'), 'utf8'), 'Blue\n');
    const decisions = db.workbench.attentionItems(run.id).filter((item) => item.state === 'resolved');
    assert.ok(decisions.some((item) => item.kind === 'approval'), 'Expected a real approval');
    if (provider === 'claude') assert.ok(decisions.some((item) => item.kind === 'question'), 'Expected a real question');
    if (!cancel) assert.ok(db.workbench.agentMessages(run.id).length);
    assert.equal(db.workbench.task(task.id).status, cancel ? 'in-progress' : 'review');
    report[provider] = { state: 'passed', outcome: expectedState, decisions: decisions.map((item) => item.kind), restartWhileWaiting: restarted };
  }
  console.log(JSON.stringify(report, null, 2)); success = true;
} finally {
  for (const run of db.workbench.activeRuns()) {
    await service.stop(run.id);
    for (let i = 0; i < 40 && db.workbench.activeRuns().some((item) => item.id === run.id); i++) {
      await delay(100); await service.reconcile(run.id);
    }
  }
  await service.close();
  await remote.request(settings, { method: 'shutdown' }).catch(() => {});
  for (let i = 0; i < 50 && fs.existsSync(path.join(root, 'rt/runtime.sock')); i++) await delay(100);
  await remote.disconnect(); db.close(); input.close();
  if (!fs.existsSync(path.join(root, 'rt/runtime.sock'))) {
    fs.rmSync(config, { recursive: true, force: true });
    if (success) fs.rmSync(root, { recursive: true, force: true });
  }
  if (!success) console.log(`Failure evidence retained at ${root}; private provider config removed after runtime drain.`);
}
