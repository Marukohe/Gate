import assert from 'node:assert/strict';
import { test } from 'node:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { startRuntime, requestRuntime } from '../../server/runtime/runtime.mjs';
import { installHooks } from '../../server/runtime/hook-install.mjs';

for (const provider of ['claude', 'codex']) test(`installed ${provider} discovers checkout hooks without a model turn`,
  { skip: !process.env[`GATE_${provider.toUpperCase()}_BIN`], timeout: 25_000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-hook-cli-'));
    const cwd = path.join(root, 'repo');
    const directory = path.join(root, 'runtime');
    const config = path.join(root, 'config');
    execFileSync('git', ['init', '-q', cwd]);
    fs.mkdirSync(config);
    const runtime = await startRuntime(directory);
    const installed = installHooks({ cwd, directory, scopeId: 'native', provider, enabled: true, nodePath: process.execPath,
      hookPath: fileURLToPath(new URL('../../server/runtime/hook.mjs', import.meta.url)) });
    await requestRuntime(directory, { method: 'observe-configure', scopeId: 'native', provider, cwd, enabled: true });
    if (provider === 'codex') fs.writeFileSync(path.join(config, 'config.toml'),
      `[projects.${JSON.stringify(cwd)}]\ntrust_level="trusted"\n`);
    const child = spawn(process.env[`GATE_${provider.toUpperCase()}_BIN`], provider === 'claude'
      ? ['-p', '--verbose', '--input-format', 'stream-json', '--output-format', 'stream-json',
        '--permission-prompt-tool', 'stdio', '--setting-sources', 'project,local']
      : ['--enable', 'hooks', 'app-server', '--listen', 'stdio://'], {
      cwd, env: { ...process.env, GATE_MANAGED: '', [provider === 'claude' ? 'CLAUDE_CONFIG_DIR' : 'CODEX_HOME']: config },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    const closed = once(child, 'close');
    child.stderr.resume(); child.stdin.on('error', () => {});
    const messages = [];
    readline.createInterface({ input: child.stdout }).on('line', (line) => {
      try { messages.push(JSON.parse(line)); } catch {}
    });
    const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
    const until = async (fn) => {
      const deadline = Date.now() + 15_000;
      while (Date.now() < deadline) { const value = await fn(); if (value) return value; await delay(50); }
      throw new Error('Native hook discovery timed out');
    };
    try {
      if (provider === 'claude') {
        send({ type: 'control_request', request_id: 'init', request: { subtype: 'initialize' } });
        await until(() => messages.find((item) => item.type === 'control_response' && item.response?.subtype === 'success'));
        const session = await until(async () => (await requestRuntime(directory, { method: 'observe-list', scopeId: 'native' })).sessions[0]);
        assert.equal(session.event, 'SessionStart'); assert.equal(session.provider, 'claude');
      } else {
        send({ id: 'init', method: 'initialize', params: { clientInfo: { name: 'gate_hook_probe', version: '0.1.0' } } });
        await until(() => messages.find((item) => item.id === 'init' && item.result));
        send({ method: 'initialized' });
        send({ id: 'hooks', method: 'hooks/list', params: { cwds: [cwd] } });
        const result = await until(() => messages.find((item) => item.id === 'hooks'));
        assert.equal(result.error, undefined);
        const serialized = JSON.stringify(result.result);
        assert.ok(serialized.includes(installed.file), 'Codex lists the checkout hook file');
        assert.ok(serialized.includes('gate-observer:native:codex'), 'Codex discovers Gate hook commands');
        assert.ok(serialized.includes('untrusted'), 'Gate does not grant hook trust');
        assert.equal((await requestRuntime(directory, { method: 'observe-list', scopeId: 'native' })).sessions.length, 0);
      }
    } finally {
      child.stdin.end(); child.kill('SIGTERM');
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 1500);
      await closed; clearTimeout(killTimer);
      await runtime.close(); fs.rmSync(root, { recursive: true, force: true });
    }
  });
