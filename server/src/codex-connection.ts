import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { Client, type ClientChannel } from 'ssh2';
import WebSocket from 'ws';

export interface ConnectionSettings {
  host: string; port: number; username: string; authType: 'password' | 'privateKey';
  password?: string; privateKeyPath?: string; codexPath?: string;
}
export interface RpcMessage {
  id?: number | string; method?: string; params?: Record<string, any>;
  result?: any; error?: { code: number; message: string; data?: unknown };
}
export const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

export class CodexRpc extends EventEmitter {
  private sequence = 0;
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> }>();
  constructor(private socket: WebSocket, private timeout = 30_000) {
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
    const command = (args: string) => `$SHELL -lc ${quote(`${quote(settings.codexPath || 'codex')} app-server daemon ${args}`)}`;
    let info = JSON.parse(await exec(ssh, command('version')));
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
    const rpc = new CodexRpc(socket);
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
