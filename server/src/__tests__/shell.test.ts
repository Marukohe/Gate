import { expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Client } from 'ssh2';
import { runShell, shellCommand } from '../ssh.js';

it('runs shell syntax in the exact cwd and never runs a command when cd fails', () => {
  const root = mkdtempSync(join(tmpdir(), 'gate-shell-'));
  const cwd = join(root, "a ' $(false)"); mkdirSync(cwd);
  try {
    const options = { env: { ...process.env, SHELL: '/bin/sh' }, encoding: 'utf8' as const };
    expect(execFileSync('/bin/sh', ['-c', shellCommand(cwd, 'pwd; printf "hello world" | tr a-z A-Z')], options))
      .toBe(`${cwd}\nHELLO WORLD`);
    const failed = spawnSync('/bin/sh', ['-c', shellCommand(join(root, 'missing'), 'printf BAD; pwd')], options);
    expect(failed.status).not.toBe(0); expect(failed.stdout).toBe('');
  } finally { rmSync(root, { recursive: true, force: true }); }
});

function fixture() {
  const stderr = Object.assign(new EventEmitter(), { setEncoding: vi.fn() });
  const stream = Object.assign(new EventEmitter(), { stderr, setEncoding: vi.fn(), end: vi.fn(), close: vi.fn(), signal: vi.fn() });
  const ssh = Object.assign(new EventEmitter(), { exec: vi.fn((_command, callback) => callback(null, stream)) });
  return { ssh, stream, run: () => runShell(ssh as unknown as Client, '/repo', 'command', 1000) };
}

it('keeps stdout, stderr, exit status and bounded output without shell/LLM retries', async () => {
  const { ssh, stream, run } = fixture();
  const pending = run();
  stream.emit('data', 'hello\n'); stream.stderr.emit('data', 'error\n');
  stream.emit('exit', 7); stream.emit('close');
  expect(await pending).toEqual({ stdout: 'hello\n', stderr: 'error\n', exitCode: 7, timedOut: false, truncated: false });
  expect(stream.end).toHaveBeenCalledOnce(); expect(ssh.listenerCount('close')).toBe(0);
  const large = run(); stream.emit('data', 'x'.repeat(200_000)); stream.emit('exit', 0); stream.emit('close');
  const result = await large;
  expect(result.stdout.length).toBe(128_000); expect(result.truncated).toBe(true);
  expect(ssh.exec).toHaveBeenCalledTimes(2);
});

it('retains partial output on disconnect and times out only its own channel', async () => {
  vi.useFakeTimers();
  try {
    const { ssh, stream, run } = fixture();
    const pending = run(); stream.emit('data', 'partial'); ssh.emit('close');
    expect(await pending).toMatchObject({ stdout: 'partial', exitCode: null, error: expect.stringContaining('may still be running') });
    const other = fixture(); const timeout = other.run();
    await vi.advanceTimersByTimeAsync(1000);
    expect(await timeout).toMatchObject({ timedOut: true, exitCode: null });
    expect(other.stream.signal).toHaveBeenCalledWith('TERM');
    expect(other.stream.close).toHaveBeenCalledOnce(); expect(other.ssh.exec).toHaveBeenCalledOnce();
    expect(other.ssh.listenerCount('close')).toBe(0);
  } finally { vi.useRealTimers(); }
});
