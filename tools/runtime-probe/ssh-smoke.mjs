import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import { parseArgs } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';

const { values } = parseArgs({ options: {
  host: { type: 'string', default: 'localhost' },
  node: { type: 'string' },
  codex: { type: 'string' },
  claude: { type: 'string' },
  report: { type: 'string' },
} });
const remoteNode = values.node ?? (values.host === 'localhost' ? process.execPath : 'node');
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const sshArgs = ['-T', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=5', '--', values.host];
function remote(command, input = '') {
  return new Promise((resolve, reject) => {
    const child = spawn('ssh', [...sshArgs, command], { stdio: ['pipe', 'pipe', 'pipe'] });
    const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (data) => { stdout += data; });
    child.stderr.setEncoding('utf8').on('data', (data) => { stderr += data; });
    child.stdin.on('error', () => {});
    child.on('error', (error) => { clearTimeout(timer); reject(error); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`SSH exited ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(input);
  });
}
async function until(fn) {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const value = await fn();
    if (value) return value;
    await delay(100);
  }
  throw new Error('Remote condition timed out');
}

const report = { protocol: 1, transport: 'OpenSSH', checks: [], providers: {} };
let root;
let watch;
let watchClosed;
let daemonStarted = false;
let rpc;
let passed = false;
try {
  report.node = await remote(`${quote(remoteNode)} --version`);
  root = await remote('mktemp -d /tmp/gate-p0.XXXXXX');
  assert.match(root, /^\/tmp\/gate-p0\.[a-zA-Z0-9]+$/);
  for (const name of ['runtime.mjs', 'cli.mjs', 'fixture.mjs']) {
    await remote(`cat > ${quote(`${root}/${name}`)}`, fs.readFileSync(new URL(name, import.meta.url), 'utf8'));
  }
  const cli = `${quote(remoteNode)} ${quote(`${root}/cli.mjs`)}`;
  rpc = async (request) => JSON.parse(await remote(`${cli} request ${quote(root)}`, JSON.stringify(request)));
  const boot = async () => {
    await remote(`nohup ${cli} serve ${quote(root)} </dev/null >${quote(`${root}/daemon.log`)} 2>&1 &`);
    daemonStarted = true;
    await until(async () => {
      try { return (await rpc({ method: 'ping' })).version === 1; } catch { return false; }
    });
  };
  const start = (runId, command = remoteNode, args = [`${root}/fixture.mjs`]) => rpc({
    method: 'start', runId, command, args, cwd: root,
  });
  const allEvents = async (runId, after = 0) => {
    const events = [];
    let page;
    do {
      page = await rpc({ method: 'events', runId, after, limit: 1000 });
      events.push(...page.events);
      after = page.next;
    } while (page.more);
    return events;
  };
  const stdout = async (runId) => (await allEvents(runId)).filter((e) => e.type === 'stdout').map((e) => e.data).join('');
  const exited = (runId) => until(async () => {
    const run = await rpc({ method: 'get', runId });
    return run.state === 'exited' ? run : false;
  });

  await boot();
  await start('interactive');
  await start('parallel');
  await until(async () => (await stdout('interactive')).includes('ready'));
  const before = await allEvents('interactive');
  const cursor = before.at(-1).seq;
  watch = spawn('ssh', [...sshArgs, `${cli} watch ${quote(root)} interactive ${cursor}`], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  watchClosed = once(watch, 'close');
  let observed = '';
  watch.stdout.on('data', (chunk) => { observed += chunk; });
  watch.stderr.resume();
  await until(() => observed.includes('tick'));
  watch.kill('SIGKILL');
  await watchClosed;
  watch = null;
  const afterDisconnect = await rpc({ method: 'get', runId: 'interactive' });
  assert.equal(afterDisconnect.state, 'running');
  await until(async () => (await rpc({ method: 'get', runId: 'interactive' })).seq > afterDisconnect.seq);
  report.checks.push('Agent continues after the watching SSH process is killed');

  const startAgain = await start('interactive');
  assert.equal(startAgain.state, 'running');
  const input = { method: 'input', runId: 'interactive', inputId: 'first', data: 'hello 中文\n' };
  assert.equal((await rpc(input)).duplicate, false);
  assert.equal((await rpc(input)).duplicate, true);
  await until(async () => (await stdout('interactive')).includes('hello 中文'));
  assert.ok(!(await stdout('parallel')).includes('hello 中文'));
  await rpc({ method: 'input', runId: 'interactive', inputId: 'finish', data: 'exit\n' });
  assert.equal((await exited('interactive')).exitCode, 0);
  const replay = await allEvents('interactive', cursor);
  const complete = await allEvents('interactive');
  assert.deepEqual([...before, ...replay], complete);
  assert.equal(complete.filter((e) => e.type === 'started').length, 1);
  assert.equal((await stdout('interactive')).split('\n').filter((line) => line.includes('hello 中文')).length, 1);
  report.checks.push('Fresh SSH clients replay contiguous events and deduplicate starts and input');
  report.checks.push('Parallel runs have independent input and output');

  await rpc({ method: 'interrupt', runId: 'parallel' });
  await exited('parallel');
  assert.equal((await allEvents('parallel')).at(-1).interrupted, true);
  await start('failure', remoteNode, ['-e', 'console.error("expected failure"); process.exit(7)']);
  assert.equal((await exited('failure')).exitCode, 7);
  assert.ok((await allEvents('failure')).some((e) => e.type === 'stderr' && e.data.includes('expected failure')));
  report.checks.push('Interrupt confirms exit; nonzero exit and stderr remain visible');

  for (const provider of ['claude', 'codex']) {
    if (!values[provider]) continue;
    await start(`${provider}-version`, values[provider], ['--version']);
    assert.equal((await exited(`${provider}-version`)).exitCode, 0);
    report.providers[provider] = { version: (await stdout(`${provider}-version`)).trim(), modelTurn: 'not tested' };
  }
  if (values.codex) {
    // Isolate configuration and avoid loading the user's MCP servers, hooks, or conversations.
    await remote(`mkdir ${quote(`${root}/codex-home`)}`);
    await start('codex-protocol', '/usr/bin/env', [
      `CODEX_HOME=${root}/codex-home`, values.codex, 'app-server', '--listen', 'stdio://',
    ]);
    await until(async () => (await rpc({ method: 'get', runId: 'codex-protocol' })).state === 'running');
    const initialize = { id: 1, method: 'initialize', params: {
      clientInfo: { name: 'gate_runtime_probe', version: '0.1.0' },
    } };
    await rpc({ method: 'input', runId: 'codex-protocol', inputId: 'initialize', data: JSON.stringify(initialize) + '\n' });
    await until(async () => (await stdout('codex-protocol')).split('\n').some((line) => {
      try { const message = JSON.parse(line); return message.id === 1 && !!message.result; } catch { return false; }
    }));
    await rpc({ method: 'input', runId: 'codex-protocol', inputId: 'initialized',
      data: JSON.stringify({ method: 'initialized' }) + '\n' });
    await rpc({ method: 'interrupt', runId: 'codex-protocol' });
    await exited('codex-protocol');
    report.providers.codex.initialize = 'passed; no model turn or account access';
  }

  await rpc({ method: 'shutdown' });
  await until(async () => {
    try { await rpc({ method: 'ping' }); return false; } catch { return true; }
  });
  await boot();
  assert.deepEqual(await allEvents('interactive'), complete);
  assert.equal((await start('interactive')).state, 'exited');
  report.checks.push('Graceful runtime restart preserves completed journals and start deduplication');
  passed = true;
} finally {
  if (watch) { watch.kill('SIGKILL'); await watchClosed; }
  if (daemonStarted && rpc) {
    try {
      await rpc({ method: 'shutdown' });
      await until(async () => {
        try { await rpc({ method: 'ping' }); return false; } catch { return true; }
      });
      if (passed) await remote(`rm -rf -- ${quote(root)}`);
      else console.error(`Probe failed; inspect the isolated runtime directory: ${root}`);
    } catch (error) {
      passed = false;
      console.error(`Runtime cleanup needs inspection at ${root}: ${error.message}`);
      process.exitCode = 1;
    }
  }
}
report.passed = passed;
report.limits = ['No model turn, semantic approval, PTY, hook integration, or runtime-crash process recovery'];
if (values.report) fs.writeFileSync(values.report, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
