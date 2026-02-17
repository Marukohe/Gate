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
  tmuxSession: string | null;
}

export class SSHManager extends EventEmitter {
  private connections = new Map<string, SSHConnection>();

  async connect(config: ServerConfig): Promise<void> {
    if (this.connections.has(config.id)) {
      await this.disconnect(config.id);
    }

    const client = new Client();

    return new Promise((resolve, reject) => {
      client.on('ready', () => {
        this.connections.set(config.id, { client, channel: null, tmuxSession: null });
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

  async attachTmux(serverId: string, sessionName: string): Promise<void> {
    const conn = this.connections.get(serverId);
    if (!conn) throw new Error(`No connection for server ${serverId}`);

    return new Promise((resolve, reject) => {
      conn.client.shell({ term: 'xterm-256color', cols: 200, rows: 50 }, (err, channel) => {
        if (err) return reject(err);

        conn.channel = channel;
        conn.tmuxSession = sessionName;

        channel.on('data', (data: Buffer) => {
          this.emit('data', serverId, data.toString());
        });

        channel.on('close', () => {
          conn.channel = null;
          this.emit('status', serverId, 'disconnected');
        });

        // Create or attach to tmux session with claude running inside
        // Use has-session to check, then either attach or create with claude as the command
        channel.write(
          `tmux has-session -t ${sessionName} 2>/dev/null && ` +
          `tmux attach -t ${sessionName} || ` +
          `tmux new-session -s ${sessionName} -d claude \\; attach -t ${sessionName}\n`
        );

        // Give tmux + claude a moment to initialize
        setTimeout(resolve, 1500);
      });
    });
  }

  sendInput(serverId: string, text: string): void {
    const conn = this.connections.get(serverId);
    if (!conn?.channel || !conn.tmuxSession) {
      throw new Error(`No active channel for server ${serverId}`);
    }
    // Send input via tmux send-keys so it goes to the program running inside tmux (claude)
    // Use literal newline by sending Enter key
    conn.channel.write(`tmux send-keys -t ${conn.tmuxSession} ${this.escapeTmuxArg(text)} Enter\n`);
  }

  private escapeTmuxArg(text: string): string {
    // Wrap in quotes and escape inner quotes for shell safety
    return `'${text.replace(/'/g, "'\\''")}'`;
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

  getActiveSession(serverId: string): string | null {
    return this.connections.get(serverId)?.tmuxSession ?? null;
  }
}
