import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { freezeCheckout } from '../../server/runtime/collaboration.mjs';
import { captureSnapshot } from '../../server/runtime/snapshot.mjs';

test('review retries keep the original code and base while source commits and untracked files change', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-review-'));
  const source = path.join(root, 'source');
  const reviewPath = path.join(root, 'review');
  const git = (...args) => execFileSync('git', ['-C', source, ...args], { encoding: 'utf8' }).trim();
  try {
    execFileSync('git', ['init', '-q', '-b', 'main', source]);
    fs.writeFileSync(path.join(source, 'code'), 'base\n'); git('add', '.');
    git('-c', 'user.name=Gate', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'initial');
    const base = git('rev-parse', 'HEAD');
    git('checkout', '-qb', 'task');
    fs.writeFileSync(path.join(source, 'code'), 'committed change\n'); git('add', '.');
    git('-c', 'user.name=Gate', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'implementation');
    fs.writeFileSync(path.join(source, 'untracked'), 'captured');
    const index = git('write-tree');
    const request = { source, reviewPath, runId: 'fixed-review', kind: 'review', baseRef: 'main' };
    const frozen = freezeCheckout(request);
    assert.equal(frozen.base, base);
    assert.equal(fs.readFileSync(path.join(reviewPath, 'untracked'), 'utf8'), 'captured');
    assert.ok(fs.readFileSync(frozen.patchPath, 'utf8').includes('+committed change'));
    assert.ok(fs.readFileSync(frozen.patchPath, 'utf8').includes('+captured'));
    assert.equal(git('write-tree'), index);
    fs.writeFileSync(path.join(source, 'untracked'), 'later source change');
    assert.deepEqual(freezeCheckout(request), frozen);
    assert.equal(captureSnapshot(reviewPath).tree, frozen.tree);
    assert.notEqual(captureSnapshot(source).tree, frozen.tree);
    assert.equal(git('rev-parse', frozen.ref), frozen.commit);
    fs.writeFileSync(path.join(reviewPath, 'untracked'), 'unexpected reviewer edit');
    assert.throws(() => freezeCheckout(request), /does not match/);
    assert.equal(fs.readFileSync(path.join(source, 'untracked'), 'utf8'), 'later source change');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
});
