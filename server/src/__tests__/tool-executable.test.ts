import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Client } from 'ssh2';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { execRemote } from '../ssh.js';
import { resolveTool, resolveTools, toolCommand } from '../tool-executable.js';

vi.mock('../ssh.js', async (original) => ({ ...await original<typeof import('../ssh.js')>(), execRemote: vi.fn() }));

const ssh = {} as Client;
let fixture: string;
let env: NodeJS.ProcessEnv;
let login: string;
let interactive: string;

const run = (command: string) => execFileSync('/bin/sh', ['-c', command], { env, encoding: 'utf8' }).trim();
function executable(file: string, script: string) {
  writeFileSync(file, `#!/bin/sh\n${script}\n`, { mode: 0o755 });
}

beforeEach(() => {
  fixture = mkdtempSync(path.join(tmpdir(), 'gate-tool-test-'));
  login = path.join(fixture, 'login');
  interactive = path.join(fixture, "interactive bin's");
  const runtime = path.join(fixture, 'runtime');
  const system = path.join(fixture, 'system');
  for (const dir of [login, interactive, runtime, system]) mkdirSync(dir);
  symlinkSync('/bin/sh', path.join(system, 'sh'));
  const remoteShell = path.join(fixture, 'shell');
  executable(remoteShell, `
    if [ "$1" = '-ilc' ]; then
      [ "$REQUIRE_TTY" -eq 0 ] || exit 1
      printf 'Interactive startup output\\n'
      PATH="$INTERACTIVE_BIN:$RUNTIME_BIN:$PATH"
    else
      PATH="$LOGIN_BIN:$PATH"
    fi
    export PATH
    exec sh -c "$2"`);
  executable(path.join(login, 'agy'), 'exit 0');
  executable(path.join(interactive, 'codex'), 'exec gate-test-runtime "$@"');
  executable(path.join(runtime, 'gate-test-runtime'), 'printf "%s\\n" "$@"');
  env = { PATH: system, SHELL: remoteShell, LOGIN_BIN: login, INTERACTIVE_BIN: interactive, RUNTIME_BIN: runtime, REQUIRE_TTY: '0' };
  vi.mocked(execRemote).mockImplementation(async (_ssh, command) => run(command));
});

afterEach(() => {
  vi.clearAllMocks();
  rmSync(fixture, { recursive: true, force: true });
});

it('finds terminal-only tools and carries their runtime PATH into clean native launches', async () => {
  const tools = await resolveTools(ssh, ['agy', 'codex']);
  expect(tools.get('agy')?.file).toBe(path.join(login, 'agy'));
  expect(tools.get('codex')?.file).toBe(path.join(interactive, 'codex'));
  expect(execRemote).toHaveBeenCalledTimes(2);
  expect(run(toolCommand(tools.get('codex')!, ['app-server', 'daemon', 'version']))).toBe('app-server\ndaemon\nversion');
});

it('uses a configured absolute executable without opening an interactive shell', async () => {
  const tool = await resolveTool(ssh, path.join(login, 'agy'));
  expect(tool.file).toBe(path.join(login, 'agy'));
  expect(execRemote).toHaveBeenCalledTimes(1);
});

it('keeps login tools when interactive startup fails and offers a path for missing tools', async () => {
  env.REQUIRE_TTY = '1';
  const tools = await resolveTools(ssh, ['agy', 'gate-tool-not-on-path']);
  expect([...tools.keys()]).toEqual(['agy']);
  await expect(resolveTool(ssh, 'gate-tool-not-on-path')).rejects.toThrow('Set its absolute path in server settings.');
});
