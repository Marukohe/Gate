import { EventEmitter } from 'node:events';
import type { ClientChannel } from 'ssh2';
import { connectSsh, execRemote, quote, projectPathsCommand, runShell, type ConnectionSettings } from './ssh.js';
import WebSocket from 'ws';
import { listRemoteDirectory, readRemoteFile } from './session-files.js';
import { resolveTool, toolCommand } from './tool-executable.js';
import type { DirectoryListing, ShellResult } from './types.js';

export interface RpcMessage {
  id?: number | string; method?: string; params?: Record<string, any>;
  result?: any; error?: { code: number; message: string; data?: unknown };
}
export class CodexRpc extends EventEmitter {
  private sequence = 0;
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> }>();
  constructor(private socket: WebSocket, private timeout = 30_000,
    readonly projectPaths: (directories: string[]) => Promise<string[]> = async (directories) => directories,
    readonly readFile: (path: string) => Promise<Buffer> = async () => { throw new Error('File access unavailable'); },
    readonly shell: (cwd: string, command: string) => Promise<ShellResult> = async () => { throw new Error('Shell unavailable'); },
    readonly listDirectory: (path: string) => Promise<Pick<DirectoryListing, 'entries' | 'truncated'>> = async () => { throw new Error('Directory access unavailable'); }) {
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

export async function connectCodex(settings: ConnectionSettings, signal: AbortSignal): Promise<CodexRpc> {
  const ssh = await connectSsh(settings, signal);
  try {
    const executable = await resolveTool(ssh, settings.executablePath || settings.codexPath || 'codex');
    const command = (action: string) => toolCommand(executable, ['app-server', 'daemon', action]);
    let info;
    try { info = JSON.parse(await execRemote(ssh, command('version'))); }
    catch (error) {
      if (/unrecognized subcommand.*daemon/.test((error as Error).message)) {
        throw new Error('This Codex version does not support the shared backend. Update Codex on this server.');
      }
      throw error;
    }
    if (info.status !== 'running') {
      await execRemote(ssh, command('start'));
      info = JSON.parse(await execRemote(ssh, command('version')));
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
      const output = await execRemote(ssh, `sh -c ${quote(projectPathsCommand(directories))}`);
      const paths = output.split('\0');
      return directories.map((directory, i) => paths[i]?.startsWith('/') ? paths[i] : directory);
    }, (path) => readRemoteFile(ssh, path), (cwd, command) => runShell(ssh, cwd, command), (path) => listRemoteDirectory(ssh, path));
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
