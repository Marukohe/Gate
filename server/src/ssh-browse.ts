import { Client, type ConnectConfig } from 'ssh2';
import { readFileSync } from 'fs';

export interface BrowseConfig {
  host: string;
  port: number;
  username: string;
  authType: 'password' | 'privateKey';
  password?: string;
  privateKeyPath?: string;
}

export interface BrowseResult {
  path: string;
  directories: string[];
}

// Reusable SSH connection cache — avoids reconnecting on every browse navigate
const IDLE_TIMEOUT = 60_000;
const pool = new Map<string, { client: Client; timer: ReturnType<typeof setTimeout> }>();

function cacheKey(config: BrowseConfig): string {
  return `${config.username}@${config.host}:${config.port}`;
}

async function getClient(config: BrowseConfig): Promise<Client> {
  const key = cacheKey(config);
  const cached = pool.get(key);
  if (cached) {
    // Reset idle timer on reuse
    clearTimeout(cached.timer);
    cached.timer = setTimeout(() => { cached.client.end(); pool.delete(key); }, IDLE_TIMEOUT);
    return cached.client;
  }

  const client = new Client();
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => { client.end(); reject(new Error('SSH connection timeout')); }, 10_000);
    client.on('ready', () => { clearTimeout(timeout); resolve(); });
    client.on('error', (err) => { clearTimeout(timeout); pool.delete(key); reject(err); });
    client.on('close', () => { pool.delete(key); });

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

  const timer = setTimeout(() => { client.end(); pool.delete(key); }, IDLE_TIMEOUT);
  pool.set(key, { client, timer });
  return client;
}

function execCommand(client: Client, cmd: string): Promise<string> {
  return new Promise((resolve, reject) => {
    client.exec(cmd, (err, channel) => {
      if (err) return reject(err);
      let stdout = '';
      let stderr = '';
      channel.on('data', (data: Buffer) => { stdout += data.toString(); });
      channel.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });
      channel.on('close', (code: number) => {
        if (code !== 0) return reject(new Error(stderr.trim() || `Exit code ${code}`));
        resolve(stdout.trim());
      });
    });
  });
}

function buildCd(dirPath: string): string {
  if (dirPath === '~' || dirPath === '$HOME') return 'cd $HOME';
  if (dirPath.startsWith('~/')) return `cd $HOME${dirPath.slice(1)}`;
  return `cd '${dirPath}'`;
}

/** Create a directory at `parentPath/name` on a remote server. Returns the resolved absolute path. */
export async function createRemoteDirectory(config: BrowseConfig, parentPath: string, name: string): Promise<string> {
  const client = await getClient(config);
  const cdExpr = buildCd(parentPath);
  return execCommand(client, `${cdExpr} && mkdir '${name}' && cd '${name}' && pwd`);
}

/**
 * List subdirectories at `dirPath` on a remote server.
 * Returns the resolved absolute path and sorted directory names.
 */
export async function listRemoteDirectory(config: BrowseConfig, dirPath: string): Promise<BrowseResult> {
  const client = await getClient(config);
  const cdExpr = buildCd(dirPath);
  const cmd = `${cdExpr} && pwd && find . -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sed 's|^\\./||' | LC_ALL=C sort`;
  const output = await execCommand(client, cmd);
  const lines = output.split('\n').filter(Boolean);
  if (lines.length === 0) throw new Error('Could not resolve directory');
  return { path: lines[0], directories: lines.slice(1) };
}
