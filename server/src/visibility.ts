import { posix } from 'node:path';
import type { Session, VisibilitySettings } from './types.js';

export function excludedDirectories(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 100) throw new Error('Provide at most 100 excluded directories');
  return [...new Set(value.map((directory) => {
    if (typeof directory !== 'string' || !directory.startsWith('/') || directory.length > 4096 || /[\0\r\n]/.test(directory)) {
      throw new Error('Excluded directories must be absolute paths, one per line');
    }
    return posix.normalize(directory).replace(/\/+$/, '') || '/';
  }))];
}

export function visibleSessions(sessions: Session[], settings: VisibilitySettings): Session[] {
  const archived = new Set(settings.archivedSessions.map((session) => session.id));
  return sessions.filter((session) => {
    if (archived.has(session.id)) return false;
    const cwd = posix.normalize(session.cwd);
    return !settings.excludedDirectories.some((directory) => cwd === directory || cwd.startsWith(directory === '/' ? '/' : `${directory}/`));
  });
}
