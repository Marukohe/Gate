import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import readline from 'node:readline';
import { createAdapter } from '../../server/runtime/provider.mjs';

test('installed Codex review disables an inherited MCP server without launching a model turn',
  { skip: !process.env.GATE_CODEX_BIN, timeout: 25_000 }, async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-review-cli-'));
    const marker = path.join(root, 'mcp-started');
    fs.writeFileSync(path.join(root, 'config.toml'),
      `[mcp_servers."fixture.with.dots"]\ncommand="/usr/bin/touch"\nargs=[${JSON.stringify(marker)}]\n`);
    const child = spawn(process.env.GATE_CODEX_BIN, ['--disable', 'hooks', '--disable', 'apps',
      'app-server', '--listen', 'stdio://'], {
      cwd: root, env: { ...process.env, CODEX_HOME: root }, stdio: ['pipe', 'pipe', 'pipe'],
    });
    const closed = once(child, 'close');
    child.stderr.resume();
    child.stdin.on('error', () => {});
    let timer;
    try {
      await new Promise((resolve, reject) => {
        timer = setTimeout(() => reject(new Error('Codex review handshake timed out')), 20_000);
        child.on('error', reject);
        child.on('close', () => reject(new Error('Codex exited before review configuration was checked')));
        const send = (message) => child.stdin.write(JSON.stringify(message) + '\n');
        const adapter = createAdapter({ provider: 'codex', cwd: root, readOnly: true, prompt: 'Never sent to a model' },
          (message) => {
            if (message.method === 'turn/start') {
              send({ id: 'check-mcp', method: 'mcpServerStatus/list', params: { threadId: message.params.threadId, limit: 100 } });
            } else send(message);
          }, () => {}, () => reject(new Error('Review adapter initialization failed')));
        readline.createInterface({ input: child.stdout }).on('line', (line) => {
          try {
            const message = JSON.parse(line);
            if (message.error) throw new Error(message.error.message);
            if (message.id === 'gate-thread') assert.equal(message.result.sandbox.type, 'readOnly');
            if (message.id === 'check-mcp') {
              assert.equal(message.result.data.find((server) => server.name === 'fixture.with.dots').runtimeStatus, 'disabled');
              resolve();
            } else adapter.message(message);
          } catch (error) { reject(error); }
        });
      });
      assert.equal(fs.existsSync(marker), false);
    } finally {
      clearTimeout(timer);
      child.stdin.end();
      child.kill('SIGTERM');
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 1500);
      await closed;
      clearTimeout(killTimer);
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
