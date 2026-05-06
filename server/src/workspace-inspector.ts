import type { Database, Session, Workspace } from './db.js';

export interface WorkspaceInspector {
  workspaceId: string;
  serverId: string;
  workspace: Workspace;
  primarySession: Session | null;
  visibleSessions: Session[];
  actionSessions: Session[];
  changes: null;
  pr: {
    url: string | null;
    state: Workspace['prState'];
  };
  scripts: Record<string, string>;
  actionStatus: null;
}

export function buildWorkspaceInspector(db: Database, workspaceId: string): WorkspaceInspector | null {
  const workspace = db.getWorkspace(workspaceId);
  if (!workspace) return null;

  const sessions = db
    .listSessions(workspace.serverId, { includeHidden: true })
    .filter((session) => session.workspaceId === workspace.id);
  const visibleSessions = sessions.filter((session) => !session.isHidden);
  const actionSessions = sessions.filter((session) => session.isHidden);
  const primarySession = visibleSessions.find((session) => session.id === workspace.primarySessionId)
    ?? [...visibleSessions].sort((a, b) => b.lastActiveAt - a.lastActiveAt)[0]
    ?? null;

  return {
    workspaceId: workspace.id,
    serverId: workspace.serverId,
    workspace,
    primarySession,
    visibleSessions,
    actionSessions,
    changes: null,
    pr: {
      url: workspace.prUrl,
      state: workspace.prState,
    },
    scripts: {},
    actionStatus: null,
  };
}
