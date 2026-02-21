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

/**
 * List subdirectories at `dirPath` on a remote server via a temporary SSH connection.
 * Returns the resolved absolute path and sorted directory names.
 */
export async function listRemoteDirectory(config: BrowseConfig, dirPath: string): Promise<BrowseResult> {
  const client = new Client();

  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.end();
        reject(new Error('SSH connection timeout'));
      }, 10_000);

      client.on('ready', () => { clearTimeout(timeout); resolve(); });
      client.on('error', (err) => { clearTimeout(timeout); reject(err); });

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

    // Expand ~ to $HOME since single-quoted cd won't do tilde expansion;
    // $HOME must remain unquoted so the shell resolves it.
    let cdExpr: string;
    if (dirPath === '~' || dirPath === '$HOME') {
      cdExpr = 'cd $HOME';
    } else if (dirPath.startsWith('~/')) {
      cdExpr = `cd $HOME${dirPath.slice(1)}`;
    } else {
      cdExpr = `cd '${dirPath}'`;
    }
    // pwd gives the resolved absolute path; find lists immediate subdirectories
    // Run directly via exec (no bash -lc wrapper) to avoid single-quote nesting issues
    const cmd = `${cdExpr} && pwd && find . -maxdepth 1 -mindepth 1 -type d 2>/dev/null | sed 's|^\\./||' | LC_ALL=C sort`;

    const output = await new Promise<string>((resolve, reject) => {
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

    const lines = output.split('\n').filter(Boolean);
    if (lines.length === 0) throw new Error('Could not resolve directory');
    return { path: lines[0], directories: lines.slice(1) };
  } finally {
    client.end();
  }
}
