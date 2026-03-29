import { Client, type ConnectConfig } from 'ssh2';
import type { ClientChannel } from 'ssh2';
import { EventEmitter } from 'events';
import { readFileSync } from 'fs';

export interface ServerConfig {
  id: string;
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKeyPath?: string;
}

interface SSHConnection {
  client: Client;
  channels: Map<string, ClientChannel>;  // sessionId → channel
}

export interface GitInfo {
  branch: string;
  worktree: string;
}

export interface BranchList {
  current: string;
  local: string[];
  remote: string[];
}

/** Return a shell-safe cd expression. Replaces leading ~ with $HOME so it works unquoted. */
function shellCd(dir: string): string {
  if (dir === '~' || dir.startsWith('~/')) {
    return `cd $HOME${dir.slice(1)}`;
  }
  return `cd '${dir}'`;
}

export class SSHManager extends EventEmitter {
  private connections = new Map<string, SSHConnection>();
  private configs = new Map<string, ServerConfig>();

  async connect(config: ServerConfig): Promise<void> {
    if (this.connections.has(config.id)) {
      await this.disconnect(config.id);
    }
    this.configs.set(config.id, config);

    const client = new Client();

    return new Promise((resolve, reject) => {
      client.on('ready', () => {
        this.connections.set(config.id, { client, channels: new Map() });
        this.emit('status', config.id, null, 'connected');
        resolve();
      });

      client.on('error', (err) => {
        this.connections.delete(config.id);
        this.emit('status', config.id, null, 'error', err.message);
        reject(err);
      });

      client.on('close', () => {
        this.connections.delete(config.id);
        this.emit('status', config.id, null, 'disconnected');
      });

      const connectConfig: ConnectConfig = {
        host: config.host,
        port: config.port,
        username: config.username,
        readyTimeout: 10_000,
        keepaliveInterval: 15_000,
        keepaliveCountMax: 3,
      };

      if (config.authType === 'password') {
        connectConfig.password = config.password;
      } else if (config.authType === 'privateKey' && config.privateKeyPath) {
        connectConfig.privateKey = readFileSync(config.privateKeyPath);
      }

      client.connect(connectConfig);
    });
  }

  /** Reconnect using the last known config. */
  private async reconnect(serverId: string): Promise<void> {
    const config = this.configs.get(serverId);
    if (!config) throw new Error(`No saved config for server ${serverId}`);
    await this.connect(config);
  }

  /** Quick ping to verify the SSH connection is still alive. */
  private async checkAlive(serverId: string): Promise<boolean> {
    const conn = this.connections.get(serverId);
    if (!conn) return false;
    return new Promise((resolve) => {
      let settled = false;
      const done = (result: boolean) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(result);
      };
      const timeout = setTimeout(() => done(false), 3_000);
      conn.client.exec('echo 1', (err, ch) => {
        if (err) return done(false);
        ch.on('close', () => done(true));
        ch.on('error', () => done(false));
        ch.on('data', () => {});
        ch.stderr.on('data', () => {});
      });
    });
  }

  /** Ensure the SSH connection for a server is alive, reconnecting if stale. */
  async ensureConnected(serverId: string): Promise<void> {
    if (this.connections.has(serverId)) {
      const alive = await this.checkAlive(serverId);
      if (alive) return;
      // Stale — tear down and reconnect
      this.connections.delete(serverId);
    }
    await this.reconnect(serverId);
  }

  /** Launch a CLI tool via SSH exec on a new channel. The caller provides the full command. */
  async startCLI(serverId: string, sessionId: string, command: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`No connection for server ${serverId}`);

    // Close existing channel for this session if any
    const existing = conn.channels.get(sessionId);
    if (existing) {
      existing.end();
      conn.channels.delete(sessionId);
    }

    const cmd = command;
    const channel = await new Promise<ClientChannel>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('CLI launch timed out')), 10_000);
      conn.client.exec(cmd, (err, ch) => {
        clearTimeout(timeout);
        if (err) return reject(err);
        resolve(ch);
      });
    });

    conn.channels.set(sessionId, channel);

    channel.on('data', (data: Buffer) => {
      this.emit('data', serverId, sessionId, data.toString());
    });

    channel.stderr.on('data', (data: Buffer) => {
      this.emit('stderr', serverId, sessionId, data.toString());
    });

    channel.on('close', () => {
      channel.removeAllListeners();
      conn.channels.delete(sessionId);
      this.emit('status', serverId, sessionId, 'disconnected');
    });

    channel.on('error', (err: Error) => {
      console.error(`[ssh] channel error for ${serverId}:${sessionId}:`, err.message);
      channel.removeAllListeners();
      conn.channels.delete(sessionId);
      this.emit('status', serverId, sessionId, 'disconnected');
    });
  }

  /** Write pre-formatted input to the CLI's stdin. The provider is responsible for formatting. */
  sendInput(serverId: string, sessionId: string, formattedInput: string): void {
    const conn = this.connections.get(serverId);
    const channel = conn?.channels.get(sessionId);
    if (!channel) {
      throw new Error(`No active channel for server ${serverId} session ${sessionId}`);
    }
    channel.write(formattedInput);
  }

  /** Write raw text to the channel stdin (for CLI prompts that bypass stream-json). */
  writeRaw(serverId: string, sessionId: string, data: string): void {
    const conn = this.connections.get(serverId);
    const channel = conn?.channels.get(sessionId);
    if (channel) channel.write(data);
  }

  /** Close a single session channel without dropping the SSH connection. */
  stopSession(serverId: string, sessionId: string): void {
    const conn = this.connections.get(serverId);
    if (!conn) return;
    const channel = conn.channels.get(sessionId);
    if (channel) {
      channel.end();
      conn.channels.delete(sessionId);
    }
  }

  /** Run a one-shot command over SSH and return stdout, stderr, and exit code. */
  async runCommand(serverId: string, workingDir: string | null, command: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`No connection for server ${serverId}`);

    const cdPrefix = workingDir ? `${shellCd(workingDir)} && ` : 'cd $HOME && ';
    const cmd = `$SHELL -lc "${cdPrefix}${command.replace(/"/g, '\\"')}"`;

    return new Promise((resolve, reject) => {
      conn.client.exec(cmd, (err, channel) => {
        if (err) return reject(err);
        let stdout = '';
        let stderr = '';
        let exitCode = 0;
        let settled = false;

        const finish = (result: { stdout: string; stderr: string; exitCode: number } | null, error?: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timeout);
          channel.removeAllListeners();
          if (error) reject(error); else resolve(result!);
        };

        const timeout = setTimeout(() => {
          channel.close();
          finish(null, new Error('Command timed out after 30 seconds'));
        }, 30_000);

        channel.on('data', (data: Buffer) => { stdout += data.toString(); });
        channel.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
        channel.on('close', (code: number) => {
          exitCode = code ?? 0;
          finish({ stdout, stderr, exitCode });
        });
        channel.on('error', (err: Error) => finish(null, err));
      });
    });
  }

  /** Close all channels and the SSH connection. */
  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;
    for (const channel of conn.channels.values()) {
      channel.end();
    }
    conn.channels.clear();
    conn.client.end();
    this.connections.delete(serverId);
  }

  /** Run a one-shot command over SSH and return stdout. */
  private async execCommand(serverId: string, cmd: string): Promise<string> {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`No connection for server ${serverId}`);

    return new Promise((resolve, reject) => {
      conn.client.exec(cmd, (err, channel) => {
        if (err) return reject(err);
        let stdout = '';
        let settled = false;
        const done = (result: string | null, error?: Error) => {
          if (settled) return;
          settled = true;
          channel.removeAllListeners();
          if (error) reject(error); else resolve(result!);
        };
        channel.on('data', (data: Buffer) => { stdout += data.toString(); });
        channel.on('close', () => done(stdout.trim()));
        channel.on('error', (err: Error) => done(null, err));
        channel.stderr.on('data', () => {});
      });
    });
  }

  /** Fetch git branch and worktree root for a directory. */
  async fetchGitInfo(serverId: string, workingDir: string): Promise<GitInfo | null> {
    try {
      const cmd = `${shellCd(workingDir)} && git rev-parse --abbrev-ref HEAD && git rev-parse --show-toplevel`;
      const output = await this.execCommand(serverId, cmd);
      const lines = output.split('\n');
      if (lines.length < 2 || !lines[0]) return null;
      return { branch: lines[0], worktree: lines[1] };
    } catch {
      return null;
    }
  }

  /** List local and remote branches. */
  async listBranches(serverId: string, workingDir: string): Promise<BranchList> {
    const cd = shellCd(workingDir);
    const current = await this.execCommand(serverId,
      `${cd} && git rev-parse --abbrev-ref HEAD`);
    const localRaw = await this.execCommand(serverId,
      `${cd} && git branch --format='%(refname:short)'`);
    const remoteRaw = await this.execCommand(serverId,
      `${cd} && git branch -r --format='%(refname:short)'`);
    const local = localRaw.split('\n').filter(Boolean);
    // Filter out HEAD pointers like "origin/HEAD"
    const remote = remoteRaw.split('\n').filter((b) => b && !b.endsWith('/HEAD'));
    return { current, local, remote };
  }

  /** Switch branch and return the new git info. */
  async switchBranch(serverId: string, workingDir: string, branch: string): Promise<GitInfo> {
    await this.execCommand(serverId, `${shellCd(workingDir)} && git checkout '${branch}'`);
    const info = await this.fetchGitInfo(serverId, workingDir);
    if (!info) throw new Error('Failed to read git info after checkout');
    return info;
  }

  /** Disconnect all SSH connections. */
  async disconnectAll(): Promise<void> {
    const serverIds = [...this.connections.keys()];
    for (const id of serverIds) {
      await this.disconnect(id);
    }
  }

  isConnected(serverId: string): boolean {
    return this.connections.has(serverId);
  }

  /** True if SSH is connected AND the given session channel is still open. */
  hasActiveChannel(serverId: string, sessionId: string): boolean {
    const conn = this.connections.get(serverId);
    return conn?.channels.has(sessionId) ?? false;
  }
}
