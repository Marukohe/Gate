import { Activity, Archive, CheckCircle2, Circle, Clock3, GitBranch, MoreHorizontal, Pin, PinOff, Plus, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useWorkspaceStore, type WorkspaceStatus, type WorkspaceWithAggregates } from '@/stores/workspace-store';
import { useSessionStore, type AgentStatus, type GitInfo, type Session } from '@/stores/session-store';
import { useServerStore } from '@/stores/server-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { cn } from '@/lib/utils';
import { useMemo } from 'react';

interface CommandCenterProps {
  onAddWorkspace: () => void;
  onSelectWorkspace: (id: string) => void;
  onSelectSession: (serverId: string, sessionId: string) => void;
}

function relativeTime(ts: number | null): string {
  if (!ts) return '—';
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}

const STATUS_META: Record<WorkspaceStatus, { label: string; className: string; icon: typeof Circle }> = {
  backlog: { label: 'Backlog', className: 'border-muted-foreground/30 text-muted-foreground', icon: Circle },
  'in-progress': { label: 'In Progress', className: 'border-blue-500/40 text-blue-600 dark:text-blue-400', icon: Clock3 },
  review: { label: 'Review', className: 'border-amber-500/40 text-amber-600 dark:text-amber-400', icon: GitBranch },
  done: { label: 'Done', className: 'border-emerald-500/40 text-emerald-600 dark:text-emerald-400', icon: CheckCircle2 },
  canceled: { label: 'Canceled', className: 'border-muted-foreground/30 text-muted-foreground', icon: Archive },
};

const STATUS_OPTIONS: WorkspaceStatus[] = ['backlog', 'in-progress', 'review', 'done', 'canceled'];

function isWorking(status?: AgentStatus): boolean {
  return status?.state === 'thinking' || status?.state === 'tool_call';
}

export function CommandCenter({ onAddWorkspace, onSelectWorkspace, onSelectSession }: CommandCenterProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const sessionsByServer = useSessionStore((s) => s.sessions);
  const agentStatus = useSessionStore((s) => s.agentStatus);
  const gitInfo = useSessionStore((s) => s.gitInfo);
  const servers = useServerStore((s) => s.servers);
  const { setWorkspaceStatus, pinWorkspace, archiveWorkspace, restoreWorkspace } = useWebSocket();

  const workspaceList = useMemo(() => Object.values(workspaces).sort((a, b) =>
    (b.pinnedAt ?? 0) - (a.pinnedAt ?? 0) ||
    (b.lastActivityAt ?? b.updatedAt) - (a.lastActivityAt ?? a.updatedAt),
  ), [workspaces]);

  const groupedWorkspaces = useMemo(() => {
    const groups: { id: string; label: string; workspaces: WorkspaceWithAggregates[] }[] = [
      { id: 'pinned', label: 'Pinned', workspaces: [] },
      { id: 'in-progress', label: 'In Progress', workspaces: [] },
      { id: 'review', label: 'Review', workspaces: [] },
      { id: 'backlog', label: 'Backlog', workspaces: [] },
      { id: 'done', label: 'Done', workspaces: [] },
      { id: 'archived', label: 'Archived / Canceled', workspaces: [] },
    ];
    const byId = new Map(groups.map((group) => [group.id, group]));

    for (const workspace of workspaceList) {
      if (workspace.archivedAt || workspace.status === 'canceled') {
        byId.get('archived')!.workspaces.push(workspace);
      } else if (workspace.pinnedAt) {
        byId.get('pinned')!.workspaces.push(workspace);
      } else {
        byId.get(workspace.status)?.workspaces.push(workspace);
      }
    }

    return groups.filter((group) => group.workspaces.length > 0);
  }, [workspaceList]);

  // Active runs: every session whose agentStatus is thinking/tool_call
  const activeRuns = useMemo(() => {
    const out: { sessionId: string; serverId: string; sessionName: string; workspaceName: string | null; state: string }[] = [];
    for (const [serverId, list] of Object.entries(sessionsByServer)) {
      for (const s of list) {
        const status = agentStatus[s.id];
        if (status?.state === 'thinking' || status?.state === 'tool_call') {
          out.push({
            sessionId: s.id,
            serverId,
            sessionName: s.name,
            workspaceName: s.workspaceId ? (workspaces[s.workspaceId]?.name ?? null) : null,
            state: status.state,
          });
        }
      }
    }
    return out;
  }, [sessionsByServer, agentStatus, workspaces]);

  const serverName = (id: string) => servers.find((s) => s.id === id)?.name ?? id;
  const visibleSessionsForWorkspace = (workspace: WorkspaceWithAggregates) =>
    (sessionsByServer[workspace.serverId] ?? []).filter((s) => s.workspaceId === workspace.id && !s.isHidden);

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Active runs strip */}
      <div className="border-b bg-muted/30">
        <div className="flex items-center gap-2 px-4 py-2 text-xs font-medium text-muted-foreground">
          <Activity className="h-3.5 w-3.5" /> Active runs
          <span className="ml-1 rounded bg-background px-1.5 py-0.5 text-[10px]">{activeRuns.length}</span>
        </div>
        {activeRuns.length === 0 ? (
          <div className="px-4 pb-3 text-xs text-muted-foreground/70">Nothing is running right now.</div>
        ) : (
          <div className="flex gap-2 overflow-x-auto px-4 pb-3">
            {activeRuns.map((r) => (
              <button
                key={r.sessionId}
                className="flex shrink-0 items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs hover:bg-accent"
                onClick={() => onSelectSession(r.serverId, r.sessionId)}
              >
                <span className={cn('h-1.5 w-1.5 rounded-full', r.state === 'thinking' ? 'bg-blue-500' : 'bg-purple-500')} />
                <span className="truncate max-w-[140px]">{r.sessionName}</span>
                {r.workspaceName && <span className="text-muted-foreground">· {r.workspaceName}</span>}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Workspace work queue */}
      <div className="flex-1 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Work Queue</h1>
          <Button size="sm" onClick={onAddWorkspace}><Plus className="h-4 w-4" /> Add workspace</Button>
        </div>
        {workspaceList.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
            <p className="text-sm text-muted-foreground">No workspaces yet.</p>
            <Button className="mt-4" onClick={onAddWorkspace}><Plus className="h-4 w-4" /> Add your first workspace</Button>
          </div>
        ) : (
          <div className="space-y-5">
            {groupedWorkspaces.map((group) => (
              <section key={group.id}>
                <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  <span>{group.label}</span>
                  <span className="rounded bg-muted px-1.5 py-0.5 text-[10px]">{group.workspaces.length}</span>
                </div>
                <div className="overflow-hidden rounded-md border bg-background">
                  {group.workspaces.map((w) => (
                    <WorkspaceRow
                      key={w.id}
                      workspace={w}
                      serverName={serverName(w.serverId)}
                      sessions={visibleSessionsForWorkspace(w)}
                      agentStatus={agentStatus}
                      gitInfo={gitInfo}
                      onClick={() => onSelectWorkspace(w.id)}
                      onSelectSession={onSelectSession}
                      onSetStatus={(status) => setWorkspaceStatus(w.id, status)}
                      onPin={(pinned) => pinWorkspace(w.id, pinned)}
                      onArchive={() => archiveWorkspace(w.id)}
                      onRestore={() => restoreWorkspace(w.id)}
                    />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkspaceRow({
  workspace, serverName, sessions, agentStatus, gitInfo, onClick, onSelectSession,
  onSetStatus, onPin, onArchive, onRestore,
}: {
  workspace: WorkspaceWithAggregates;
  serverName: string;
  sessions: Session[];
  agentStatus: Record<string, AgentStatus>;
  gitInfo: Record<string, GitInfo>;
  onClick: () => void;
  onSelectSession: (serverId: string, sessionId: string) => void;
  onSetStatus: (status: WorkspaceStatus) => void;
  onPin: (pinned: boolean) => void;
  onArchive: () => void;
  onRestore: () => void;
}) {
  const status = STATUS_META[workspace.status];
  const StatusIcon = status.icon;
  const primarySession = sessions.find((s) => s.id === workspace.primarySessionId) ?? sessions[0];
  const runningSessions = sessions.filter((session) => isWorking(agentStatus[session.id]));
  const isArchived = !!workspace.archivedAt;
  const currentBranch = primarySession ? gitInfo[primarySession.id]?.branch : undefined;
  const branchLabel = currentBranch ?? (workspace.defaultBranch ? `default ${workspace.defaultBranch}` : null);

  return (
    <div className="flex items-stretch border-b last:border-b-0 hover:bg-accent/25">
      <button
        onClick={onClick}
        className="grid min-w-0 flex-1 grid-cols-1 gap-2 px-3 py-2.5 text-left md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)_auto]"
      >
        <div className="min-w-0">
          <div className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-medium">{workspace.name}</span>
            {workspace.pinnedAt && <Pin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
            {isArchived && <Archive className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
            <span className="truncate">{serverName}</span>
            {branchLabel && (
              <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" />{branchLabel}</span>
            )}
            <span>{relativeTime(workspace.lastActivityAt)}</span>
          </div>
        </div>

        <div className="min-w-0 text-[11px] text-muted-foreground">
          <div className="truncate text-xs text-foreground">
            {workspace.goal || primarySession?.name || 'Ready for a new task'}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
            <span>{workspace.totalSessionCount} session{workspace.totalSessionCount === 1 ? '' : 's'}</span>
            {workspace.dirtyFileCount !== null && workspace.dirtyFileCount > 0 && (
              <span className="text-orange-500">{workspace.dirtyFileCount} dirty</span>
            )}
            {workspace.prUrl && (
              <span className="text-emerald-600 dark:text-emerald-400">PR {workspace.prState}</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 md:justify-end">
          <Badge variant="outline" className={cn('gap-1.5', status.className)}>
            <StatusIcon className="h-3 w-3" />
            {status.label}
          </Badge>
          {(runningSessions.length > 0 || workspace.activeSessionCount > 0) && (
            <span className="flex items-center gap-1 text-[11px] text-blue-500">
              <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
              {runningSessions.length || workspace.activeSessionCount} active
            </span>
          )}
        </div>
      </button>

      <div className="flex w-10 shrink-0 items-center justify-center border-l">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="h-8 w-8">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            {STATUS_OPTIONS.map((option) => {
              const meta = STATUS_META[option];
              const Icon = meta.icon;
              return (
                <DropdownMenuItem key={option} onClick={() => onSetStatus(option)}>
                  <Icon className="h-4 w-4" />
                  {meta.label}
                </DropdownMenuItem>
              );
            })}
            <DropdownMenuSeparator />
            {primarySession && (
              <DropdownMenuItem onClick={() => onSelectSession(primarySession.serverId, primarySession.id)}>
                Continue session
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => onPin(!workspace.pinnedAt)}>
              {workspace.pinnedAt ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
              {workspace.pinnedAt ? 'Unpin' : 'Pin'}
            </DropdownMenuItem>
            {isArchived ? (
              <DropdownMenuItem onClick={onRestore}>
                <RotateCcw className="h-4 w-4" />
                Restore
              </DropdownMenuItem>
            ) : (
              <DropdownMenuItem onClick={onArchive}>
                <Archive className="h-4 w-4" />
                Archive
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
