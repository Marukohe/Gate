import type { MonitorServer, Session } from '../../../server/src/types';
import { groupServers, toolName } from './server-groups';
export interface SessionTarget { serverId: string; threadId: string }
export interface AttentionSession extends SessionTarget { serverName: string; toolName: string; session: Session }
export const needsAttention = (session: Session) => session.state === 'waiting' || session.state === 'error';
export function otherSessions(servers: MonitorServer[] | null, current: SessionTarget | null): AttentionSession[] {
  return groupServers(servers ?? []).flatMap((group) => group.connections.filter((server) => server.state === 'connected').flatMap((server) => server.sessions
    .filter((session) => server.id !== current?.serverId || session.id !== current.threadId)
    .map((session) => ({ serverId: server.id, threadId: session.id, serverName: group.name, toolName: toolName(server), session }))));
}
