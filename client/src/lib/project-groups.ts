import type { Session, SessionState } from '../../../server/src/types';

const rank: Record<SessionState, number> = { waiting: 0, error: 0, running: 1, unknown: 2, idle: 3, saved: 3 };
export const isPastSession = (session: Session) => session.state === 'idle' || session.state === 'saved';
export interface ProjectGroup { path: string; name: string; context?: string; sessions: Session[] }
export function groupProjects(sessions: Session[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>();
  for (const session of sessions) {
    const path = (session.projectPath || session.cwd).replace(/\/+$/, '') || (session.cwd ? '/' : '');
    if (!groups.has(path)) groups.set(path, { path, name: path.split('/').at(-1) || path || 'No working directory', sessions: [] });
    groups.get(path)!.sessions.push(session);
  }
  for (const group of groups.values()) {
    const peers = [...groups.values()].filter((other) => other !== group && other.name === group.name);
    if (!peers.length) continue;
    const parents = group.path.split('/').filter(Boolean).slice(0, -1);
    let depth = 1;
    while (depth < parents.length && peers.some((other) =>
      other.path.split('/').filter(Boolean).slice(0, -1).slice(-depth).join('/') === parents.slice(-depth).join('/'))) depth++;
    group.context = parents.slice(-depth).join('/') || '/';
  }
  const priority = (group: ProjectGroup) => Math.min(...group.sessions.map((session) => rank[session.state]));
  const updated = (group: ProjectGroup) => Math.max(...group.sessions.map((session) => session.updatedAt));
  for (const group of groups.values()) group.sessions.sort((a, b) => rank[a.state] - rank[b.state] || b.updatedAt - a.updatedAt);
  return [...groups.values()].sort((a, b) => priority(a) - priority(b) || updated(b) - updated(a) || a.path.localeCompare(b.path));
}
