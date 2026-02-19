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
  channel: ClientChannel | null;
  claudeSessionId: string | null;
}

// Wrap in login shell so PATH includes ~/.local/bin, nvm, etc.
const CLAUDE_CMD =
  "bash -lc 'claude -p --output-format stream-json --input-format stream-json --verbose --dangerously-skip-permissions'";

export class SSHManager extends EventEmitter {
  private connections = new Map<string, SSHConnection>();

  async connect(config: ServerConfig): Promise<void> {
    if (this.connections.has(config.id)) {
      await this.disconnect(config.id);
    }

    const client = new Client();

    return new Promise((resolve, reject) => {
      client.on('ready', () => {
        this.connections.set(config.id, { client, channel: null, claudeSessionId: null });
        this.emit('status', config.id, 'connected');
        resolve();
      });

      client.on('error', (err) => {
        this.emit('status', config.id, 'error', err.message);
        reject(err);
      });

      client.on('close', () => {
        this.connections.delete(config.id);
        this.emit('status', config.id, 'disconnected');
      });

      const connectConfig: ConnectConfig = {
        host: config.host,
        port: config.port,
        username: config.username,
      };

      if (config.authType === 'password') {
        connectConfig.password = config.password;
      } else if (config.authType === 'privateKey' && config.privateKeyPath) {
        connectConfig.privateKey = readFileSync(config.privateKeyPath);
      }

      client.connect(connectConfig);
    });
  }

  /** Launch Claude CLI in stream-json mode via SSH exec. */
  async startClaude(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`No connection for server ${serverId}`);

    const channel = await new Promise<ClientChannel>((resolve, reject) => {
      conn.client.exec(CLAUDE_CMD, (err, ch) => {
        if (err) return reject(err);
        resolve(ch);
      });
    });

    conn.channel = channel;

    channel.on('data', (data: Buffer) => {
      this.emit('data', serverId, data.toString());
    });

    channel.stderr.on('data', (data: Buffer) => {
      this.emit('stderr', serverId, data.toString());
    });

    channel.on('close', () => {
      conn.channel = null;
      this.emit('status', serverId, 'disconnected');
    });
  }

  /** Write a user message to Claude's stdin as a JSON line. */
  sendInput(serverId: string, text: string): void {
    const conn = this.connections.get(serverId);
    if (!conn?.channel) {
      throw new Error(`No active channel for server ${serverId}`);
    }
    const msg = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: text },
    });
    conn.channel.write(msg + '\n');
  }

  async disconnect(serverId: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) return;
    if (conn.channel) {
      conn.channel.end();
    }
    conn.client.end();
    this.connections.delete(serverId);
  }

  isConnected(serverId: string): boolean {
    return this.connections.has(serverId);
  }
}
