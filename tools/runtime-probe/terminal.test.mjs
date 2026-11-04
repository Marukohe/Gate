import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { startRuntime, requestRuntime } from '../../server/runtime/runtime.mjs';

test('PTY supports Unicode, resize, Ctrl-C, redacted input and confirmed cleanup of foreground/background jobs', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-pty-'));
  let runtime = await startRuntime(root);
  const rpc = (request) => requestRuntime(root, request);
  const all = async () => (await rpc({ method: 'events', runId: 'terminal', limit: 1000 })).events;
  const output = async () => (await all()).filter((event) => event.type === 'protocol' && event.data.type === 'terminal-output')
    .map((event) => Buffer.from(event.data.data, 'base64').toString()).join('');
  const until = async (fn) => {
    const deadline = Date.now() + 7000;
    while (Date.now() < deadline) { const result = await fn(); if (result) return result; await delay(20); }
    throw new Error('Terminal condition timed out: ' + await output());
  };
  let sequence = 0;
  const send = (message) => rpc({ method: 'input', runId: 'terminal', inputId: `input-${++sequence}`,
    data: JSON.stringify(message) + '\n', redact: true });
  const input = (text) => send({ type: 'input', data: Buffer.from(text).toString('base64') });
  try {
    await rpc({ method: 'start', runId: 'terminal', command: '/usr/bin/python3',
      args: [fileURLToPath(new URL('../../server/runtime/terminal.py', import.meta.url))], cwd: root, protocol: true,
      initialInput: JSON.stringify({ cwd: root, executable: '/bin/bash', args: ['--noprofile', '--norc', '-i'],
        nodeDirectory: path.dirname(process.execPath) }) + '\n' });
    await until(async () => (await all()).some((event) => event.data?.type === 'terminal-resize'));
    await input("printf 'READY-中文\\n'\n");
    await until(async () => (await output()).includes('READY-中文\r\n'));
    await send({ type: 'resize', cols: 95, rows: 31 });
    await input('stty size\n');
    await until(async () => (await output()).includes('31 95\r\n'));
    await input('sleep 100\n'); await delay(100); await input('\x03');
    await input("printf 'AFTER-INT\\n'\n");
    await until(async () => (await output()).includes('AFTER-INT\r\n'));
    const accepted = (await all()).filter((event) => event.type === 'input-accepted');
    assert.ok(accepted.length >= 5); assert.ok(accepted.every((event) => event.digest && event.data === undefined));
    await input(`(trap '' TERM; sleep 100) & echo $! > ${root}/background\nsleep 100 & echo $! > ${root}/other-job\n`);
    await until(() => fs.existsSync(path.join(root, 'other-job')));
    const pids = ['background', 'other-job'].map((name) => Number(fs.readFileSync(path.join(root, name), 'utf8').trim()));
    await rpc({ method: 'interrupt', runId: 'terminal' });
    await until(async () => (await rpc({ method: 'get', runId: 'terminal' })).state === 'exited');
    assert.ok((await all()).some((event) => event.data?.type === 'terminal-exit'));
    for (const pid of pids) {
      const stat = `/proc/${pid}/stat`;
      if (fs.existsSync(stat)) assert.equal(fs.readFileSync(stat, 'utf8').split(') ')[1][0], 'Z');
    }
    const original = accepted[0];
    await runtime.close(); runtime = await startRuntime(root);
    const replay = await rpc({ method: 'input', runId: 'terminal', inputId: original.inputId,
      data: JSON.stringify({ type: 'input', data: Buffer.from("printf 'READY-中文\\n'\n").toString('base64') }) + '\n', redact: true });
    assert.equal(replay.duplicate, true);
    await runtime.close();
    fs.unlinkSync(path.join(root, 'input.key'));
    await assert.rejects(startRuntime(root), /input key is missing/);
    await assert.rejects(startRuntime(root), /input key is missing/);
  } finally { await runtime.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
