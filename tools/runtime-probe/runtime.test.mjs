import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { startRuntime, requestRuntime } from './runtime.mjs';

let root;
let runtime;
const fixture = fileURLToPath(new URL('./fixture.mjs', import.meta.url));
const rpc = (request) => requestRuntime(root, request);
const start = (runId = 'test', args = [fixture]) => rpc({
  method: 'start', runId, command: process.execPath, args, cwd: root,
});
async function until(fn) {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const result = await fn();
    if (result) return result;
    await delay(20);
  }
  throw new Error('Condition timed out');
}
const events = async (runId = 'test') => (await rpc({ method: 'events', runId })).events;
const output = (list) => list.filter((e) => e.type === 'stdout').map((e) => e.data).join('');

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-p0-'));
  runtime = await startRuntime(root, { stopTimeoutMs: 100 });
});
afterEach(async () => {
  await runtime.close();
  fs.rmSync(root, { recursive: true, force: true });
});

test('replays output across disconnected clients and deduplicates starts and input', async () => {
  await Promise.all([start(), start()]);
  await until(async () => output(await events()).includes('ready'));
  const before = await rpc({ method: 'events', runId: 'test', limit: 2 });
  assert.equal(before.events.length, 2);
  assert.equal(before.more, true);
  const data = 'hello 中文 $(touch never) `echo never`\n';
  const input = { method: 'input', runId: 'test', inputId: 'message-1', data };
  assert.equal((await rpc(input)).duplicate, false);
  assert.equal((await rpc(input)).duplicate, true);
  await assert.rejects(rpc({ ...input, data: 'different\n' }), /different data/);
  await until(async () => output(await events()).includes('echo'));
  await rpc({ method: 'input', runId: 'test', inputId: 'finish', data: 'exit\n' });
  await until(async () => (await rpc({ method: 'get', runId: 'test' })).state === 'exited');
  const all = await events();
  assert.equal(all.filter((e) => e.type === 'started').length, 1);
  assert.equal(output(all).split('\n').filter((line) => line.includes('hello')).length, 1);
  assert.equal(all.at(-1).exitCode, 0);
  const rest = await rpc({ method: 'events', runId: 'test', after: before.next });
  assert.deepEqual([...before.events, ...rest.events], all);
  assert.deepEqual(all.map((e) => e.seq), all.map((_, i) => i + 1));
  await start();
  assert.equal((await events()).filter((e) => e.type === 'started').length, 1);
});

test('concurrent runs have independent input and output', async () => {
  await Promise.all([start('one'), start('two')]);
  await until(async () => output(await events('one')).includes('ready') && output(await events('two')).includes('ready'));
  await rpc({ method: 'input', runId: 'one', inputId: 'message', data: 'one only\n' });
  await until(async () => output(await events('one')).includes('one only'));
  assert.ok(!output(await events('two')).includes('one only'));
  await rpc({ method: 'interrupt', runId: 'one' });
  await until(async () => (await rpc({ method: 'get', runId: 'one' })).state === 'exited');
  assert.equal((await rpc({ method: 'get', runId: 'two' })).state, 'running');
});

test('keeps exit failures and stderr, including executable and cwd failures', async () => {
  await start('failure', ['-e', 'console.error("failed"); process.exit(7)']);
  await until(async () => (await rpc({ method: 'get', runId: 'failure' })).state === 'exited');
  assert.equal((await rpc({ method: 'get', runId: 'failure' })).exitCode, 7);
  assert.ok((await events('failure')).some((e) => e.type === 'stderr' && e.data.includes('failed')));
  for (const [runId, command, cwd] of [
    ['missing-command', '/gate-does-not-exist', root],
    ['missing-cwd', process.execPath, path.join(root, 'absent')],
  ]) {
    await rpc({ method: 'start', runId, command, cwd, args: [] });
    await until(async () => (await rpc({ method: 'get', runId })).state === 'exited');
    assert.ok((await events(runId)).some((e) => e.type === 'error'));
    assert.notEqual((await rpc({ method: 'get', runId })).exitCode, 0);
  }
});

test('interrupt escalates when a process ignores TERM and records confirmed exit', async () => {
  await start('stubborn', ['-e', 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)']);
  await until(async () => output(await events('stubborn')).includes('ready'));
  assert.equal((await rpc({ method: 'interrupt', runId: 'stubborn' })).state, 'stopping');
  assert.equal((await rpc({ method: 'interrupt', runId: 'stubborn' })).state, 'stopping');
  await until(async () => (await rpc({ method: 'get', runId: 'stubborn' })).state === 'exited');
  const last = (await events('stubborn')).at(-1);
  assert.equal(last.signal, 'SIGKILL');
  assert.equal(last.interrupted, true);
});

test('restart preserves completed runs and marks unowned runs lost without relaunching', async () => {
  await start();
  await until(async () => output(await events()).includes('ready'));
  await runtime.close();
  const completed = fs.readFileSync(path.join(root, 'test.jsonl'), 'utf8');
  fs.writeFileSync(path.join(root, 'lost.jsonl'), JSON.stringify({
    version: 1, runId: 'lost', seq: 1, time: Date.now(), type: 'requested',
    spec: { command: process.execPath, args: [fixture], cwd: root },
  }) + '\n');
  runtime = await startRuntime(root);
  assert.equal((await start('test')).state, 'exited');
  assert.equal(fs.readFileSync(path.join(root, 'test.jsonl'), 'utf8'), completed);
  assert.equal((await start('lost')).state, 'lost');
  assert.equal((await rpc({ method: 'interrupt', runId: 'lost' })).state, 'lost');
  assert.equal((await events('lost')).at(-1).type, 'lost');
});

test('interrupt reaches a child process in the owned group', async () => {
  const marker = path.join(root, 'child-stopped');
  const helper = `process.on('SIGTERM', () => {
    require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'stopped'); process.exit(0);
  }); console.log('child-ready'); setInterval(() => {}, 1000);`;
  const parent = `require('node:child_process').spawn(process.execPath, ['-e', ${JSON.stringify(helper)}],
    { stdio: 'inherit' }); process.on('SIGTERM', () => {});`;
  await start('family', ['-e', parent]);
  await until(async () => output(await events('family')).includes('child-ready'));
  await rpc({ method: 'interrupt', runId: 'family' });
  await until(async () => (await rpc({ method: 'get', runId: 'family' })).state === 'exited');
  assert.equal(fs.readFileSync(marker, 'utf8'), 'stopped');
});

test('shutdown keeps its socket alive until owned children exit', async () => {
  await start('stubborn', ['-e', 'process.on("SIGTERM", () => {}); console.log("ready"); setInterval(() => {}, 1000)']);
  await until(async () => output(await events('stubborn')).includes('ready'));
  await rpc({ method: 'shutdown' });
  assert.equal((await rpc({ method: 'ping' })).closing, true);
  await runtime.close();
  const journal = fs.readFileSync(path.join(root, 'stubborn.jsonl'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(journal.at(-1).type, 'exited');
  await assert.rejects(rpc({ method: 'ping' }));
});

test('rejects ambiguous commands, invalid requests, and a second owner', async () => {
  await start();
  await assert.rejects(start('test', ['-e', '0']), /different command/);
  await assert.rejects(start('../escape'), /identifier/);
  await assert.rejects(rpc({ method: 'ping', version: 999 }), /version/);
  await assert.rejects(rpc({ method: 'unknown' }), /Unknown/);
  await assert.rejects(rpc({ method: 'events', runId: 'test', after: -1 }), /cursor/);
  await assert.rejects(startRuntime(root), /EADDRINUSE/);
  assert.equal((await rpc({ method: 'ping' })).version, 1);
});
