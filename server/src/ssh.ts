import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Client, type ClientChannel } from 'ssh2';
import type { ShellResult } from './types.js';

export interface ConnectionSettings {
  host: string; port: number; username: string; authType: 'password' | 'privateKey';
  password?: string; privateKeyPath?: string; executablePath?: string; codexPath?: string;
}
export const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export function connectionKey(settings: ConnectionSettings, executable: string) {
  const { host, port, username, authType, password, privateKeyPath } = settings;
  return JSON.stringify([host, port, username, authType, authType === 'password' ? password : privateKeyPath, executable]);
}

export function shellCommand(cwd: string, command: string) {
  // Group the whole command so a failed cd cannot run a later pipeline/list in the wrong directory.
  return `"$SHELL" -lc ${quote(`cd -- ${quote(cwd)} && (\n${command}\n)`)}`;
}

export function runShell(ssh: Client, cwd: string, command: string, timeout = 60_000): Promise<ShellResult> {
  return new Promise((resolve) => {
    let channel: ClientChannel | undefined;
    let settled = false;
    let remaining = 128_000;
    const result: ShellResult = { stdout: '', stderr: '', exitCode: null, timedOut: false, truncated: false };
    const finish = (error?: string) => {
      if (settled) return;
      settled = true; clearTimeout(timer); ssh.off('close', lost);
      if (error) result.error = error;
      if (error || result.timedOut) {
        // Only signal this command's channel, never the shared daemon or another session.
        try { channel?.signal('TERM'); } catch { /* The connection may already be closed. */ }
        channel?.close();
      }
      resolve(result);
    };
    const lost = () => finish('SSH connection lost. The command may still be running; check before running it again.');
    const timer = setTimeout(() => { result.timedOut = true; finish(); }, timeout);
    ssh.once('close', lost);
    ssh.exec(shellCommand(cwd, command), (error, stream) => {
      if (error) { finish(error.message); return; }
      channel = stream;
      if (settled) { try { stream.signal('TERM'); } catch { /* Closed during setup. */ } stream.close(); return; }
      const append = (target: 'stdout' | 'stderr', chunk: string) => {
        if (settled) return;
        result[target] += chunk.slice(0, remaining);
        if (chunk.length > remaining) result.truncated = true;
        remaining = Math.max(0, remaining - chunk.length);
      };
      stream.setEncoding('utf8'); stream.stderr.setEncoding('utf8');
      stream.on('data', (chunk: string) => append('stdout', chunk));
      stream.stderr.on('data', (chunk: string) => append('stderr', chunk));
      stream.on('error', (error: Error) => finish(`${error.message}. Check the command before running it again.`));
      stream.on('exit', (code: number | null, signal?: string) => {
        result.exitCode = typeof code === 'number' ? code : null;
        if (signal) result.signal = signal;
      });
      stream.on('close', () => finish());
      stream.end(); // One-shot commands have no interactive stdin or PTY.
    });
  });
}

export function projectPathsCommand(directories: string[]) {
  // Common Git directories identify linked worktrees without merging unrelated clones by name or URL.
  return `for directory in ${directories.map(quote).join(' ')}; do
    root="$directory"
    common=$(git -C "$directory" rev-parse --path-format=absolute --git-common-dir 2>/dev/null) || common=''
    case "$common" in
      */.git) root="\${common%/.git}" ;;
      ?*) root=$(git -C "$directory" rev-parse --show-toplevel 2>/dev/null) || root="$directory" ;;
    esac
    printf '%s\\0' "$root"
  done`;
}

export function execRemote(ssh: Client, command: string, timeout = 20_000): Promise<string> {
  return new Promise((resolve, reject) => {
    let channel: ClientChannel | undefined;
    let stdout = '', stderr = '', settled = false;
    const done = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); ssh.off('close', lost);
      if (error) { channel?.close(); reject(error); } else resolve(stdout.trim());
    };
    const lost = () => done(new Error('SSH connection closed'));
    const timer = setTimeout(() => done(new Error('Remote command timed out')), timeout);
    ssh.once('close', lost);
    ssh.exec(command, (error, stream) => {
      if (error) { done(error); return; }
      channel = stream;
      if (settled) { stream.close(); return; }
      stream.on('data', (data: Buffer) => { stdout += data; if (stdout.length > 1024 * 1024) done(new Error('Unexpected remote response size')); });
      stream.stderr.on('data', (data: Buffer) => { stderr = (stderr + data).slice(-2000); });
      stream.on('error', done);
      stream.on('close', (code: number) => done(code === 0 ? undefined : new Error(stderr.trim() || `Remote command exited ${code}`)));
      stream.end();
    });
  });
}

export async function connectSsh(settings: ConnectionSettings, signal: AbortSignal): Promise<Client> {
  const ssh = new Client();
  const cancel = () => ssh.destroy();
  signal.addEventListener('abort', cancel, { once: true });
  ssh.once('close', () => signal.removeEventListener('abort', cancel));
  try {
    await new Promise<void>((resolve, reject) => {
      if (signal.aborted) { reject(new Error('Connection canceled')); return; }
      const lost = () => reject(new Error('SSH connection closed'));
      ssh.once('close', lost);
      ssh.on('error', reject);
      ssh.once('ready', () => { ssh.off('close', lost); resolve(); });
      const keyPath = settings.privateKeyPath?.replace(/^~(?=\/)/, homedir());
      ssh.connect({ host: settings.host, port: settings.port, username: settings.username, readyTimeout: 10_000,
        keepaliveInterval: 15_000, keepaliveCountMax: 3,
        ...(settings.authType === 'password' ? { password: settings.password }
          : { privateKey: keyPath ? readFileSync(keyPath) : undefined }) });
    });
    return ssh;
  } catch (error) { ssh.destroy(); throw error; }
}
