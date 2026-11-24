import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { posix } from 'node:path';
import { Client, type ClientChannel } from 'ssh2';
import WebSocket from 'ws';
import { readRemoteFile } from './session-files.js';
import type { ShellResult } from './types.js';

export interface ConnectionSettings {
  host: string; port: number; username: string; authType: 'password' | 'privateKey';
  password?: string; privateKeyPath?: string; codexPath?: string;
}
export interface RpcMessage {
  id?: number | string; method?: string; params?: Record<string, any>;
  result?: any; error?: { code: number; message: string; data?: unknown };
}
export const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

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

export class CodexRpc extends EventEmitter {
  private sequence = 0;
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> }>();
  constructor(private socket: WebSocket, private timeout = 30_000,
    readonly projectPaths: (directories: string[]) => Promise<string[]> = async (directories) => directories,
    readonly readFile: (path: string) => Promise<Buffer> = async () => { throw new Error('File access unavailable'); },
    readonly shell: (cwd: string, command: string) => Promise<ShellResult> = async () => { throw new Error('Shell unavailable'); }) {
    super();
    socket.on('message', (data) => {
      let message: RpcMessage;
      try { message = JSON.parse(data.toString()); } catch { return; }
      if (message.method) { this.emit('event', message); return; }
      const request = this.pending.get(String(message.id));
      if (!request) return;
      clearTimeout(request.timer); this.pending.delete(String(message.id));
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result);
    });
    socket.on('error', () => socket.terminate());
    socket.on('close', () => {
      for (const request of this.pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error('Codex connection lost. Check the session before sending again.'));
      }
      this.pending.clear(); this.emit('disconnected');
    });
  }
  request<T = any>(method: string, params: object = {}): Promise<T> {
    const id = `gate-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      if (this.socket.readyState !== WebSocket.OPEN) { reject(new Error('Codex is disconnected')); return; }
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error('Codex request timed out. Check the session before sending again.'));
      }, this.timeout);
      this.pending.set(id, { resolve, reject, timer });
      this.socket.send(JSON.stringify({ id, method, params }), (error) => {
        if (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
      });
    });
  }
  send(message: RpcMessage) {
    return new Promise<void>((resolve, reject) => {
      if (this.socket.readyState !== WebSocket.OPEN) { reject(new Error('Codex is disconnected')); return; }
      this.socket.send(JSON.stringify(message), (error) => error ? reject(error) : resolve());
    });
  }
  close() { this.socket.terminate(); }
}

function exec(ssh: Client, command: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let channel: ClientChannel | undefined;
    let stdout = '', stderr = '', settled = false;
    const done = (error?: Error) => {
      if (settled) return;
      settled = true; clearTimeout(timer); ssh.off('close', lost);
      if (error) { channel?.close(); reject(error); } else resolve(stdout.trim());
    };
    const lost = () => done(new Error('SSH connection closed'));
    const timer = setTimeout(() => done(new Error('Codex backend setup timed out')), 20_000);
    ssh.once('close', lost);
    ssh.exec(command, (error, stream) => {
      if (error) { done(error); return; }
      channel = stream;
      if (settled) { stream.close(); return; }
      stream.on('data', (data: Buffer) => { stdout += data; if (stdout.length > 1024 * 1024) done(new Error('Unexpected Codex response size')); });
      stream.stderr.on('data', (data: Buffer) => { stderr = (stderr + data).slice(-2000); });
      stream.on('error', done);
      stream.on('close', (code: number) => done(code === 0 ? undefined : new Error(stderr.trim() || `Codex exited ${code}`)));
      stream.end();
    });
  });
}

export async function connectCodex(settings: ConnectionSettings, signal: AbortSignal): Promise<CodexRpc> {
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
    const executable = settings.codexPath || 'codex';
    const prefix = executable.startsWith('/') ? `PATH=${quote(posix.dirname(executable))}:"$PATH" ` : '';
    const command = (args: string) => `$SHELL -lc ${quote(`${prefix}${quote(executable)} app-server daemon ${args}`)}`;
    let info;
    try { info = JSON.parse(await exec(ssh, command('version'))); }
    catch (error) {
      if (/unrecognized subcommand.*daemon/.test((error as Error).message)) {
        throw new Error('This Codex version does not support the shared backend. Update Codex on this server.');
      }
      throw error;
    }
    if (info.status !== 'running') {
      await exec(ssh, command('start'));
      info = JSON.parse(await exec(ssh, command('version')));
    }
    if (info.status !== 'running' || typeof info.socketPath !== 'string' || !info.socketPath.startsWith('/')) {
      throw new Error('Codex shared backend unavailable. Install a Codex version with app-server daemon support.');
    }
    const channel = await new Promise<ClientChannel>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Codex socket connection timed out')), 10_000);
      ssh.openssh_forwardOutStreamLocal(info.socketPath, (error, channel) => {
        clearTimeout(timer); if (error) reject(error); else resolve(channel);
      });
    });
    // SSH carries the Unix socket; there is no public Codex port or Gate runtime on the remote host.
    const socket = new WebSocket('ws://localhost/', { createConnection: () => channel as any,
      handshakeTimeout: 10_000, maxPayload: 32 * 1024 * 1024 });
    const rpc = new CodexRpc(socket, 30_000, async (directories) => {
      if (!directories.length) return [];
      const output = await exec(ssh, `sh -c ${quote(projectPathsCommand(directories))}`);
      const paths = output.split('\0');
      return directories.map((directory, i) => paths[i]?.startsWith('/') ? paths[i] : directory);
    }, (path) => readRemoteFile(ssh, path), (cwd, command) => runShell(ssh, cwd, command));
    ssh.once('close', () => rpc.close());
    rpc.once('disconnected', () => ssh.end());
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve); socket.once('error', reject);
      socket.once('close', () => reject(new Error('Codex connection closed')));
    });
    await rpc.request('initialize', { clientInfo: { name: 'gate', version: '1.1.0' },
      capabilities: { experimentalApi: true } });
    await rpc.send({ method: 'initialized' });
    return rpc;
  } catch (error) { ssh.destroy(); throw error; }
}
