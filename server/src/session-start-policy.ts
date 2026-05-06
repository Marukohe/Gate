import type { Database, Session } from './db.js';

type MessageCountDb = Pick<Database, 'getMessageCount' | 'getMessageCountAfter'>;
type SessionBoundary = Pick<Session, 'id' | 'chatStartedAt'>;

export function getVisibleMessageCount(db: MessageCountDb, session: SessionBoundary): number {
  if (session.chatStartedAt) {
    return db.getMessageCountAfter(session.id, session.chatStartedAt);
  }
  return db.getMessageCount(session.id);
}

export function shouldAutoStartInteractiveSession(db: MessageCountDb, session: SessionBoundary): boolean {
  return getVisibleMessageCount(db, session) === 0;
}
