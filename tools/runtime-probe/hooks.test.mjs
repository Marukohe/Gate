import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { startRuntime, requestRuntime } from '../../server/runtime/runtime.mjs';
import { installHooks } from '../../server/runtime/hook-install.mjs';

test('scoped hook preserves settings and records only identity/activity across runtime restart', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-hooks-'));
  const repo = path.join(root, 'repo');
  const directory = path.join(root, 'runtime');
  execFileSync('git', ['init', '-q', repo]);
  const file = path.join(repo, '.claude/settings.local.json');
  fs.mkdirSync(path.dirname(file));
  const original = { permissions: { deny: ['Bash(rm:*)'] }, hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'echo existing' }] }] } };
  fs.writeFileSync(file, JSON.stringify(original));
  const setup = { scopeId: 'scope', cwd: repo, provider: 'claude', enabled: true, directory, nodePath: process.execPath,
    hookPath: fileURLToPath(new URL('../../server/runtime/hook.mjs', import.meta.url)) };
  let runtime = await startRuntime(directory);
  const rpc = (request) => requestRuntime(directory, request);
  try {
    installHooks(setup); installHooks(setup);
    let config = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(config.permissions, original.permissions);
    assert.equal(config.hooks.SessionStart.length, 2);
    await rpc({ method: 'observe-configure', ...setup });
    const hook = async (event, overrides = {}, env = {}) => {
      const child = spawn(process.execPath, [setup.hookPath, directory, 'scope', 'claude'], {
        env: { ...process.env, ...env }, stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '';
      child.stdout.on('data', (chunk) => output += chunk);
      child.stdin.end(JSON.stringify({ cwd: repo, session_id: 'native-session', hook_event_name: event,
        prompt: 'private input must not be retained', ...overrides }));
      assert.equal((await once(child, 'close'))[0], 0);
      assert.equal(output, '');
    };
    await hook('SessionStart');
    await hook('PermissionRequest');
    let sessions = (await rpc({ method: 'observe-list', scopeId: 'scope' })).sessions;
    assert.equal(sessions.length, 1); assert.equal(sessions[0].state, 'waiting');
    assert.equal(sessions[0].revision, 2);
    assert.equal(JSON.stringify(sessions).includes('private input'), false);
    await hook('Stop', {}, { GATE_MANAGED: '1' });
    await hook('Stop', { agent_id: 'subagent' });
    assert.equal((await rpc({ method: 'observe-list', scopeId: 'scope' })).sessions[0].revision, 2);
    await assert.rejects(rpc({ method: 'observe', scopeId: 'scope', provider: 'claude', sessionId: 'other', cwd: root, event: 'Stop' }), /another checkout/);
    await runtime.close(); runtime = await startRuntime(directory);
    sessions = (await rpc({ method: 'observe-list', scopeId: 'scope' })).sessions;
    assert.equal(sessions[0].state, 'waiting');
    await hook('SessionEnd');
    assert.equal((await rpc({ method: 'observe-list', scopeId: 'scope' })).sessions[0].state, 'ended');
    installHooks({ ...setup, enabled: false });
    config = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.deepEqual(config.permissions, original.permissions);
    assert.deepEqual(config.hooks.SessionStart, original.hooks.SessionStart);
    await rpc({ method: 'observe-configure', ...setup, enabled: false });
    await hook('SessionStart');
    assert.equal((await rpc({ method: 'observe-list', scopeId: 'scope' })).sessions[0].state, 'ended');
    fs.writeFileSync(file, '{bad JSON');
    assert.throws(() => installHooks(setup));
    assert.equal(fs.readFileSync(file, 'utf8'), '{bad JSON');
    fs.unlinkSync(file);
    const linked = path.join(root, 'global-settings.json');
    fs.writeFileSync(linked, JSON.stringify(original)); fs.symlinkSync(linked, file);
    assert.throws(() => installHooks(setup), /not a symlink/);
    assert.equal(fs.readFileSync(linked, 'utf8'), JSON.stringify(original));
  } finally { await runtime.close(); fs.rmSync(root, { recursive: true, force: true }); }
});
