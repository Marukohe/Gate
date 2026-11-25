import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { posix } from 'node:path';
import { connectSsh, execRemote, projectPathsCommand, quote, runShell, type ConnectionSettings } from './ssh.js';
import { readRemoteFile } from './session-files.js';
import type { ShellResult } from './types.js';

export interface AcpMessage { jsonrpc?: string; id?: string | number; method?: string; params?: any; result?: any; error?: { code: number; message: string } }

// One long-lived ACP stream per connection. A prompt can run indefinitely; writes are never retried.
export class AcpRpc extends EventEmitter {
  private sequence = 0;
  private buffer = '';
  private closed = false;
  private pending = new Map<string, { resolve: (value: any) => void; reject: (error: Error) => void; timer?: ReturnType<typeof setTimeout> }>();
  capabilities: any = {};
  constructor(private stream: Duplex, private disconnect: () => void = () => stream.destroy(),
    readonly projectPaths: (paths: string[]) => Promise<string[]> = async (paths) => paths,
    readonly readFile: (path: string) => Promise<Buffer> = async () => { throw new Error('File access unavailable'); },
    readonly shell: (cwd: string, command: string) => Promise<ShellResult> = async () => { throw new Error('Shell unavailable'); }) {
    super();
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      this.buffer += chunk;
      let end: number;
      while (!this.closed && (end = this.buffer.indexOf('\n')) >= 0) {
        if (end > 32 * 1024 * 1024) { this.close('ACP message exceeds 32 MB'); break; }
        const line = this.buffer.slice(0, end).trim(); this.buffer = this.buffer.slice(end + 1);
        if (!line) continue;
        let message: AcpMessage;
        try { message = JSON.parse(line); } catch { this.close('Invalid JSON from the ACP agent'); break; }
        if (message.method) { this.emit('event', message); continue; }
        const pending = this.pending.get(String(message.id));
        if (!pending) continue;
        clearTimeout(pending.timer); this.pending.delete(String(message.id));
        if (message.error) pending.reject(new Error(message.error.code === -32000
          ? 'Sign in to the tool on this SSH server, then reconnect.' : message.error.message));
        else pending.resolve(message.result);
      }
      if (this.buffer.length > 32 * 1024 * 1024) this.close('ACP message exceeds 32 MB');
    });
    stream.on('error', () => this.close());
    stream.on('close', () => this.close());
    stream.on('end', () => this.close());
  }
  request<T = any>(method: string, params: object = {}, timeout = 30_000): Promise<T> {
    if (this.closed) return Promise.reject(new Error('ACP is disconnected'));
    const id = `gate-${++this.sequence}`;
    return new Promise((resolve, reject) => {
      const timer = timeout ? setTimeout(() => {
        this.pending.delete(id); reject(new Error('ACP request timed out. Check the session before sending again.'));
      }, timeout) : undefined;
      this.pending.set(id, { resolve, reject, timer });
      void this.send({ id, method, params }).catch((error) => { clearTimeout(timer); this.pending.delete(id); reject(error); });
    });
  }
  send(message: AcpMessage): Promise<void> {
    if (this.closed) return Promise.reject(new Error('ACP is disconnected'));
    return new Promise((resolve, reject) => this.stream.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n',
      (error) => error ? reject(error) : resolve()));
  }
  close(reason = 'ACP connection lost. Check the session before sending again.') {
    if (this.closed) return;
    this.closed = true; this.buffer = '';
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(reason)); }
    this.pending.clear(); this.disconnect(); this.emit('disconnected');
  }
}

export async function connectAgy(settings: ConnectionSettings, signal: AbortSignal): Promise<AcpRpc> {
  const ssh = await connectSsh(settings, signal);
  try {
    const executable = settings.executablePath || 'agy';
    const prefix = executable.startsWith('/') ? `PATH=${quote(posix.dirname(executable))}:"$PATH" ` : '';
    const stream = await new Promise<import('ssh2').ClientChannel>((resolve, reject) => {
      ssh.exec(`$SHELL -lc ${quote(`${prefix}exec ${quote(executable)} acp`)}`, (error, stream) => error ? reject(error) : resolve(stream));
    });
    // Drain diagnostic output without returning logs or authentication data to browsers.
    stream.stderr.resume();
    const rpc = new AcpRpc(stream, () => { stream.end(); ssh.end(); }, async (directories) => {
      if (!directories.length) return [];
      const paths = (await execRemote(ssh, `sh -c ${quote(projectPathsCommand(directories))}`)).split('\0');
      return directories.map((cwd, i) => paths[i]?.startsWith('/') ? paths[i] : cwd);
    }, (path) => readRemoteFile(ssh, path), (cwd, command) => runShell(ssh, cwd, command));
    ssh.once('close', () => rpc.close());
    const result = await rpc.request('initialize', { protocolVersion: 1, clientInfo: { name: 'gate', version: '1.1.0' }, clientCapabilities: {} });
    if (result.protocolVersion !== 1) throw new Error('Unsupported ACP protocol version');
    rpc.capabilities = result.agentCapabilities ?? {};
    if (!rpc.capabilities.loadSession || !rpc.capabilities.sessionCapabilities?.list) throw new Error('This agy version must support ACP session list and load. Update agy on this server.');
    return rpc;
  } catch (error) { ssh.destroy(); throw error; }
}
