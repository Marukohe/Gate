import type { MonitorServer, Session } from '../../../server/src/types';
export interface SessionTarget { serverId: string; threadId: string }
export interface AttentionSession extends SessionTarget { serverName: string; session: Session }
export const needsAttention = (session: Session) => session.state === 'waiting' || session.state === 'error';
export function otherSessions(servers: MonitorServer[] | null, current: SessionTarget | null): AttentionSession[] {
  return (servers ?? []).filter((server) => server.state === 'connected').flatMap((server) => server.sessions
    .filter((session) => server.id !== current?.serverId || session.id !== current.threadId)
    .map((session) => ({ serverId: server.id, threadId: session.id, serverName: server.name, session })));
}
