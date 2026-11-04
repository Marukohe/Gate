import assert from 'node:assert/strict';
import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { captureSnapshot, readResult } from '../../server/runtime/snapshot.mjs';
import { startRuntime, requestRuntime } from '../../server/runtime/runtime.mjs';

test('snapshot includes staged, unstaged and untracked code without changing the real index', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-snapshot-'));
  const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  try {
    git('init', '-q');
    fs.writeFileSync(path.join(root, 'tracked'), 'first');
    fs.writeFileSync(path.join(root, '.gitignore'), 'ignored\n');
    git('add', '.'); git('-c', 'user.name=Gate', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial');
    fs.writeFileSync(path.join(root, 'tracked'), 'staged'); git('add', 'tracked');
    const index = git('write-tree');
    fs.writeFileSync(path.join(root, 'tracked'), 'unstaged');
    fs.writeFileSync(path.join(root, 'untracked'), 'new');
    fs.writeFileSync(path.join(root, 'ignored'), 'ignored');
    const before = captureSnapshot(root);
    assert.equal(before.dirty, true);
    assert.equal(git('show', `${before.tree}:tracked`), 'unstaged');
    assert.equal(git('show', `${before.tree}:untracked`), 'new');
    assert.equal(git('write-tree'), index);
    fs.writeFileSync(path.join(root, 'ignored'), 'different ignored data');
    assert.deepEqual(captureSnapshot(root), before);
    const result = readResult(root);
    assert.ok(result.diff.includes('+new'));
    fs.writeFileSync(path.join(root, 'untracked'), 'different');
    assert.notEqual(captureSnapshot(root).tree, before.tree);
    assert.equal(git('write-tree'), index);
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});

test('verification journals command output, snapshots and actual nonzero exit status', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-verify-'));
  const runtimeDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-verify-runtime-'));
  let runtime;
  try {
    execFileSync('git', ['init', '-q', root]);
    execFileSync('git', ['-C', root, '-c', 'user.name=Gate', '-c', 'user.email=test@example.invalid',
      'commit', '-qm', 'initial', '--allow-empty']);
    runtime = await startRuntime(runtimeDirectory);
    const command = "printf 'verified 中文\\n'; printf 'failure details\\n' >&2; printf changed > changed; exit 7";
    await requestRuntime(runtimeDirectory, { method: 'start', runId: 'verify', command: process.execPath,
      args: [fileURLToPath(new URL('../../server/runtime/verifier.mjs', import.meta.url))], cwd: root, protocol: true,
      initialInput: JSON.stringify({ cwd: root, command }) + '\n' });
    for (let n = 0; n < 200; n++) {
      if ((await requestRuntime(runtimeDirectory, { method: 'get', runId: 'verify' })).state === 'exited') break;
      await delay(20);
    }
    const all = (await requestRuntime(runtimeDirectory, { method: 'events', runId: 'verify' })).events;
    const messages = all.filter((event) => event.type === 'protocol').map((event) => event.data);
    const started = messages.find((event) => event.type === 'verification-started');
    const completed = messages.find((event) => event.type === 'verification-completed');
    assert.equal(started.command, command);
    assert.equal(started.cwd, root);
    assert.equal(completed.exitCode, 7);
    assert.ok(completed.endedAt >= started.startedAt);
    assert.notEqual(started.before.tree, completed.after.tree);
    assert.ok(messages.some((event) => event.type === 'test-output' && event.stream === 'stdout' && event.text.includes('中文')));
    assert.ok(messages.some((event) => event.type === 'test-output' && event.stream === 'stderr' && event.text.includes('failure')));
    assert.equal(all.at(-1).type, 'exited');
  } finally {
    await runtime?.close(); fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(runtimeDirectory, { recursive: true, force: true });
  }
});
