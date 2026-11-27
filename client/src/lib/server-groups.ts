import type { MonitorServer, Session } from '../../../server/src/types';

export const serverKey = (server: { host: string; port?: number }) => JSON.stringify([server.host.trim().toLowerCase(), server.port ?? 22]);
export const toolName = (connection: Pick<MonitorServer, 'tool' | 'toolName'>) => connection.toolName || connection.tool || 'Codex';
export function connectionLabel(connection: MonitorServer, connections: MonitorServer[]) {
  const peers = connections.filter((other) => toolName(other) === toolName(connection));
  return toolName(connection) + (peers.length > 1 ? ` · ${peers.some((other) => other.username !== connection.username) ? connection.username : connection.name}` : '');
}
export interface ServerSession extends Session { connectionId: string; toolName: string; toolNote?: string; username: string }
export interface ServerGroup {
  key: string; name: string; host: string; port: number;
  accounts: MonitorServer[]; connections: MonitorServer[]; sessions: ServerSession[];
}
// Group presentation by SSH endpoint. Every action still retains its owning connection and native session ID.
export function groupServers(connections: MonitorServer[]): ServerGroup[] {
  const groups = new Map<string, ServerGroup>();
  for (const connection of [...connections].sort((a, b) => (a.createdAt ?? 0) - (b.createdAt ?? 0))) {
    const key = serverKey(connection);
    if (!groups.has(key)) groups.set(key, { key, name: connection.name, host: connection.host, port: connection.port ?? 22,
      accounts: [], connections: [], sessions: [] });
    const group = groups.get(key)!;
    if (connection.tool === 'ssh') { group.accounts.push(connection); continue; }
    group.connections.push(connection);
    group.sessions.push(...connection.sessions.map((session) => ({ ...session, connectionId: connection.id,
      toolName: toolName(connection), toolNote: connection.statusNote, username: connection.username,
      state: connection.state === 'connected' ? session.state : 'unknown' as const })));
  }
  return [...groups.values()];
}
