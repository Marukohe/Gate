import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { inspectDelivery, executeDelivery } from '../../server/runtime/delivery.mjs';

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-delivery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const cwd = path.join(root, 'repo');
  const git = (...args) => execFileSync('/usr/bin/git', ['-C', cwd, ...args], { encoding: 'utf8' }).trim();
  fs.mkdirSync(cwd); fs.mkdirSync(path.join(root, 'hooks'));
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Gate'); git('config', 'user.email', 'gate@example.invalid');
  git('config', 'commit.gpgsign', 'false'); git('config', 'core.hooksPath', path.join(root, 'hooks'));
  git('commit', '-qm', 'initial', '--allow-empty');
  return { root, cwd, git };
}

test('delivery rejects stale code before staging and commits the inspected tree with literal text', (t) => {
  const { cwd, git } = fixture(t);
  fs.writeFileSync(path.join(cwd, 'file'), 'one');
  const preview = inspectDelivery(cwd);
  const originalIndex = git('write-tree');
  fs.writeFileSync(path.join(cwd, 'file'), 'two');
  assert.throws(() => executeDelivery(cwd, { ...preview, action: 'commit', message: 'message' }), /Checkout changed/);
  assert.equal(git('write-tree'), originalIndex);
  const current = inspectDelivery(cwd);
  const message = 'feat: literal $(touch injected)\n\nBody with `ticks` and quotes "';
  const result = executeDelivery(cwd, { ...current, action: 'commit', message });
  assert.equal(result.tree, current.snapshot.tree);
  assert.equal(git('log', '-1', '--format=%B'), message);
  assert.equal(fs.existsSync(path.join(cwd, 'injected')), false);
  assert.equal(inspectDelivery(cwd).snapshot.dirty, false);
  assert.throws(() => executeDelivery(cwd, { ...current, action: 'commit', message }), /Checkout changed/);
});

test('commit hooks run and changed committed trees retain their artifact with failure', (t) => {
  const { root, cwd, git } = fixture(t);
  fs.writeFileSync(path.join(cwd, 'file'), 'before');
  fs.writeFileSync(path.join(root, 'hooks/pre-commit'), '#!/bin/sh\nprintf hook-change > file\ngit add file\n', { mode: 0o700 });
  const events = [];
  assert.throws(() => executeDelivery(cwd, { ...inspectDelivery(cwd), action: 'commit', message: 'hook test' }, (event) => events.push(event)), /hooks changed/);
  assert.equal(events.find((event) => event.type === 'delivery-completed').commit, git('rev-parse', 'HEAD'));
  assert.equal(fs.readFileSync(path.join(cwd, 'file'), 'utf8'), 'hook-change');
});

test('push pins the preview commit and rejects changed remote configuration', (t) => {
  const { root, cwd, git } = fixture(t);
  const target = path.join(root, 'origin.git');
  execFileSync('/usr/bin/git', ['init', '-q', '--bare', target]);
  git('remote', 'add', 'origin', target);
  const preview = inspectDelivery(cwd);
  git('remote', 'set-url', 'origin', path.join(root, 'different.git'));
  assert.throws(() => executeDelivery(cwd, { ...preview, action: 'push' }), /Origin changed/);
  git('remote', 'set-url', 'origin', target);
  assert.equal(executeDelivery(cwd, { ...preview, action: 'push' }).pushed, true);
  assert.equal(execFileSync('/usr/bin/git', ['--git-dir', target, 'rev-parse', 'refs/heads/main'], { encoding: 'utf8' }).trim(), preview.snapshot.head);
  fs.writeFileSync(path.join(cwd, 'dirty'), 'dirty');
  assert.throws(() => executeDelivery(cwd, { ...inspectDelivery(cwd), action: 'push' }), /Commit or remove/);
});

test('draft PR uses literal title/body, verifies the push URL, and reuses an existing PR', (t) => {
  const { root, cwd, git } = fixture(t);
  git('checkout', '-qb', 'task');
  git('remote', 'add', 'origin', 'https://github.com/example/repo.git');
  git('remote', 'set-url', '--push', 'origin', 'https://github.com/example/push-repo.git');
  const preview = inspectDelivery(cwd);
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  fs.writeFileSync(path.join(bin, 'git'), `#!${process.execPath}\n` +
    `import {execFileSync} from 'node:child_process'; import fs from 'node:fs';\n` +
    `const args=process.argv.slice(2); if(args.includes('ls-remote')) {\n` +
    `fs.writeFileSync(${JSON.stringify(path.join(root, 'ls-remote'))}, JSON.stringify(args));\n` +
    `console.log(${JSON.stringify(preview.snapshot.head + '\trefs/heads/task')});\n` +
    `} else process.stdout.write(execFileSync('/usr/bin/git',args));\n`, { mode: 0o700 });
  const body = 'Body\n$(touch injected)\n"quotes"';
  const title = 'feat: `literal` title';
  const gh = path.join(bin, 'gh');
  fs.writeFileSync(gh, `#!${process.execPath}\nimport fs from 'node:fs';\n` +
    `const args=process.argv.slice(2); const record=${JSON.stringify(path.join(root, 'pr-record'))};\n` +
    `if(args[1]==='list') console.log(fs.existsSync(record) ? JSON.stringify([{url:'https://github.com/example/push-repo/pull/1',headRefOid:${JSON.stringify(preview.snapshot.head)}}]) : '[]');\n` +
    `else { fs.writeFileSync(record, JSON.stringify({args,body:fs.readFileSync(args[args.indexOf('--body-file')+1],'utf8')})); console.log('https://github.com/example/push-repo/pull/1'); }\n`, { mode: 0o700 });
  const oldPath = process.env.PATH; process.env.PATH = bin + ':' + oldPath;
  t.after(() => { process.env.PATH = oldPath; });
  const request = { ...preview, action: 'create-pr', title, body, base: 'main' };
  assert.equal(executeDelivery(cwd, request, () => {}, gh).reused, false);
  const record = JSON.parse(fs.readFileSync(path.join(root, 'pr-record'), 'utf8'));
  assert.ok(record.args.includes('--draft')); assert.ok(record.args.includes(title)); assert.equal(record.body, body);
  assert.ok(JSON.parse(fs.readFileSync(path.join(root, 'ls-remote'), 'utf8')).includes('https://github.com/example/push-repo.git'));
  assert.equal(executeDelivery(cwd, request, () => {}, gh).reused, true);
  assert.equal(fs.existsSync(path.join(cwd, 'injected')), false);
});
