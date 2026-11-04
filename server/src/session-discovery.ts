import { Client } from 'ssh2';
import { readFileSync } from 'node:fs';
import type { Server } from './db.js';
import type { MonitoredSession } from './monitor-types.js';
import { discoverCodexSessions, type CodexFileCache } from './providers/codex/discovery.js';

export interface DiscoveryResult {
  sessions: MonitoredSession[];
  scanning: boolean;
  checkedAt?: number;
  error?: string;
}
type Scan = (server: Server, cache: CodexFileCache, signal: AbortSignal) => Promise<MonitoredSession[]>;

// A separate connection cannot reconnect or tear down a user's active chat channel.
export const scanCodexServer: Scan = (server, cache, signal) => new Promise((resolve, reject) => {
  const client = new Client();
  let settled = false;
  const finish = (error?: Error, sessions: MonitoredSession[] = []) => {
    if (settled) return;
    settled = true;
    clearTimeout(timer);
    signal.removeEventListener('abort', cancel);
    client.destroy();
    if (error) reject(error); else resolve(sessions);
  };
  const cancel = () => finish(new Error('Session discovery stopped'));
  const timer = setTimeout(() => finish(new Error('Session discovery timed out')), 25_000);
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) { cancel(); return; }
  client.on('error', finish);
  client.on('close', () => { if (!settled) finish(new Error('SSH connection closed during session discovery')); });
  client.on('ready', () => {
    client.exec('printf \'%s\' "${CODEX_HOME:-$HOME/.codex}"', (error, channel) => {
      if (error) { finish(error); return; }
      let home = '';
      channel.on('data', (chunk: Buffer) => { home += chunk.toString(); if (home.length > 8192) finish(new Error('Invalid Codex home path')); });
      channel.stderr.resume();
      channel.on('error', finish);
      channel.on('close', (code: number) => {
        if (settled) return;
        if (code !== 0 || !home.startsWith('/')) { finish(new Error('Could not resolve Codex home over SSH')); return; }
        client.sftp((error, sftp) => {
          if (error) { finish(error); return; }
          sftp.on('error', finish);
          discoverCodexSessions(sftp, home, cache).then((sessions) => finish(undefined, sessions), finish);
        });
      });
      channel.end();
    });
  });
  try {
    client.connect({ host: server.host, port: server.port, username: server.username, readyTimeout: 10_000,
      ...(server.authType === 'password' ? { password: server.password }
        : { privateKey: server.privateKeyPath ? readFileSync(server.privateKeyPath) : undefined }) });
  } catch (error) { finish(error as Error); }
});

export class SessionDiscovery {
  private entries = new Map<string, { config: string; result: DiscoveryResult; files: CodexFileCache;
    nextScan: number; controller: AbortController }>();
  private closed = false;
  private active = 0;
  constructor(private scan: Scan = scanCodexServer, private now = Date.now) {}

  snapshot(servers: Server[]): Map<string, DiscoveryResult> {
    const ids = new Set(servers.map((server) => server.id));
    for (const [id, entry] of this.entries) if (!ids.has(id)) { entry.controller.abort(); this.entries.delete(id); }
    for (const server of servers) {
      const config = JSON.stringify([server.host, server.port, server.username, server.authType, server.password, server.privateKeyPath]);
      let entry = this.entries.get(server.id);
      if (entry?.config !== config) {
        entry?.controller.abort();
        entry = { config, result: { sessions: [], scanning: false }, files: new Map(), nextScan: 0, controller: new AbortController() };
        this.entries.set(server.id, entry);
      }
      if (this.closed || entry.result.scanning || this.now() < entry.nextScan || this.active >= 4) continue;
      entry.result.scanning = true;
      this.active++;
      const current = entry;
      void this.scan(server, current.files, current.controller.signal).then((sessions) => {
        current.result = { sessions: sessions.map((item) => ({ ...item, id: `${server.id}:${item.id}`, serverId: server.id })),
          scanning: false, checkedAt: this.now() };
      }, (error: Error) => {
        current.result = { ...current.result, scanning: false, error: error.message };
      }).finally(() => { this.active--; current.nextScan = this.now() + 15_000; });
    }
    return new Map([...this.entries].map(([id, entry]) => [id, entry.result]));
  }

  close() { this.closed = true; for (const entry of this.entries.values()) entry.controller.abort(); }
}
