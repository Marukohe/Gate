// Explicitly trusts only this fixture's inspected hook definitions in a disposable Codex home.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import readline from 'node:readline';
import { startRuntime, requestRuntime } from '../../server/runtime/runtime.mjs';
import { installHooks } from '../../server/runtime/hook-install.mjs';

if (process.env.GATE_LIVE_PROVIDER_TEST !== '1') throw new Error('Set GATE_LIVE_PROVIDER_TEST=1 to send a real Codex request');
const root = fs.mkdtempSync('/tmp/gate-live-hook-');
const cache = path.join(os.homedir(), '.cache'); fs.mkdirSync(cache, { recursive: true });
const config = fs.mkdtempSync(path.join(cache, 'gate-live-hook-'));
const cwd = path.join(root, 'repo'); const directory = path.join(root, 'rt');
let runtime;
let child;
let closed;
let timeout;
const pending = new Map();
const methods = [];
function call(id, method, params) {
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.stdin.write(JSON.stringify({ id, method, params }) + '\n');
  });
}
async function stop() {
  if (!child) return;
  child.stdin.end(); child.kill('SIGTERM');
  const kill = setTimeout(() => child.kill('SIGKILL'), 2000);
  await closed; clearTimeout(kill); clearTimeout(timeout); child = null;
}
let onTurn;
async function start() {
  child = spawn(process.env.GATE_CODEX_BIN ?? path.join(os.homedir(), '.local/bin/codex'),
    ['--enable', 'hooks', '--disable', 'apps', 'app-server', '--listen', 'stdio://'], {
      cwd, env: { ...process.env, CODEX_HOME: path.join(config, 'codex'), GATE_MANAGED: '' }, stdio: ['pipe', 'pipe', 'pipe'],
    });
  closed = once(child, 'close'); child.stdin.on('error', () => {}); child.stderr.resume();
  timeout = setTimeout(() => child?.kill('SIGTERM'), 60_000);
  child.on('close', () => {
    for (const item of pending.values()) item.reject(new Error('Codex closed before replying'));
    pending.clear(); onTurn?.({ status: 'closed' });
  });
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    let item; try { item = JSON.parse(line); } catch { return; }
    if (pending.has(item.id)) {
      const request = pending.get(item.id); pending.delete(item.id);
      if (item.error) request.reject(new Error(item.error.message)); else request.resolve(item.result);
    }
    if (item.method === 'hook/completed') methods.push(item.params.run.eventName);
    if (item.method === 'turn/completed') onTurn?.(item.params.turn);
  });
  await call('init', 'initialize', { clientInfo: { name: 'gate_live_hook_probe', version: '1' } });
  child.stdin.write('{"method":"initialized"}\n');
}
try {
  execFileSync('/usr/bin/python3', [new URL('./live-config.py', import.meta.url).pathname, config]);
  execFileSync('git', ['init', '-q', cwd]);
  const configFile = path.join(config, 'codex/config.toml');
  fs.appendFileSync(configFile, `\n[projects.${JSON.stringify(cwd)}]\ntrust_level="trusted"\n`);
  runtime = await startRuntime(directory);
  const installed = installHooks({ cwd, directory, scopeId: 'fixture', provider: 'codex', enabled: true,
    nodePath: process.execPath, hookPath: new URL('../../server/runtime/hook.mjs', import.meta.url).pathname });
  await requestRuntime(directory, { method: 'observe-configure', scopeId: 'fixture', provider: 'codex', cwd, enabled: true });
  await start();
  const hooks = (await call('list', 'hooks/list', { cwds: [cwd] })).data[0].hooks;
  assert.equal(hooks.length, 7);
  for (const hook of hooks) {
    assert.equal(hook.sourcePath, installed.file); assert.equal(hook.command, installed.command);
    assert.equal(hook.trustStatus, 'untrusted');
    // Native /hooks writes this exact key/hash pair. No invocation-wide bypass or real user config is changed.
    fs.appendFileSync(configFile, `\n[hooks.state.${JSON.stringify(hook.key)}]\ntrusted_hash=${JSON.stringify(hook.currentHash)}\n`);
  }
  await stop(); await start();
  assert.ok((await call('trusted', 'hooks/list', { cwds: [cwd] })).data[0].hooks.every((hook) => hook.trustStatus === 'trusted'));
  const { thread } = await call('thread', 'thread/start', { cwd, approvalPolicy: 'on-request', sandbox: 'workspace-write' });
  const completed = new Promise((resolve) => { onTurn = resolve; });
  await call('turn', 'turn/start', { threadId: thread.id, input: [{ type: 'text', text: 'Reply exactly: Gate hook verified. Do not call tools.' }] });
  assert.equal((await completed).status, 'completed'); onTurn = null;
  for (const name of ['sessionStart', 'userPromptSubmit', 'stop']) assert.ok(methods.includes(name), name);
  const session = (await requestRuntime(directory, { method: 'observe-list', scopeId: 'fixture' })).sessions.find((item) => item.sessionId === thread.id);
  assert.equal(session.event, 'Stop'); assert.equal(session.state, 'idle'); assert.ok(session.revision >= 3);
  console.log(JSON.stringify({ trustedDefinitions: hooks.length, nativeEvents: methods, observedRevision: session.revision }));
} finally {
  await stop(); await runtime?.close();
  fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(config, { recursive: true, force: true });
}
