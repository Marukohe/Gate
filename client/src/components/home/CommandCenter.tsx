import { GitBranch, Plus, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useWorkspaceStore, type WorkspaceWithAggregates } from '@/stores/workspace-store';
import { useSessionStore } from '@/stores/session-store';
import { useServerStore } from '@/stores/server-store';
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

export function CommandCenter({ onAddWorkspace, onSelectWorkspace, onSelectSession }: CommandCenterProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const sessionsByServer = useSessionStore((s) => s.sessions);
  const agentStatus = useSessionStore((s) => s.agentStatus);
  const servers = useServerStore((s) => s.servers);

  const workspaceList = useMemo(() => Object.values(workspaces).sort((a, b) =>
    (b.lastActivityAt ?? b.updatedAt) - (a.lastActivityAt ?? a.updatedAt),
  ), [workspaces]);

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

      {/* Workspace grid */}
      <div className="flex-1 p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Workspaces</h1>
          <Button size="sm" onClick={onAddWorkspace}><Plus className="h-4 w-4" /> Add workspace</Button>
        </div>
        {workspaceList.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-lg border border-dashed py-16 text-center">
            <p className="text-sm text-muted-foreground">No workspaces yet.</p>
            <Button className="mt-4" onClick={onAddWorkspace}><Plus className="h-4 w-4" /> Add your first workspace</Button>
          </div>
        ) : (
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(220px,1fr))]">
            {workspaceList.map((w) => (
              <WorkspaceCard
                key={w.id}
                workspace={w}
                serverName={serverName(w.serverId)}
                onClick={() => onSelectWorkspace(w.id)}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function WorkspaceCard({ workspace, serverName, onClick }: { workspace: WorkspaceWithAggregates; serverName: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex flex-col rounded-lg border bg-background p-3 text-left transition-colors hover:border-primary hover:bg-accent/30"
    >
      <div className="flex items-center justify-between">
        <span className="truncate font-medium text-sm">{workspace.name}</span>
        {workspace.activeSessionCount > 0 && (
          <span className="flex items-center gap-1 text-[10px] text-blue-500">
            <span className="h-1.5 w-1.5 rounded-full bg-blue-500" />
            {workspace.activeSessionCount} active
          </span>
        )}
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground truncate">{serverName}</div>
      <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
        {workspace.defaultBranch && (
          <span className="flex items-center gap-1"><GitBranch className="h-3 w-3" />{workspace.defaultBranch}</span>
        )}
        <span>{workspace.totalSessionCount} session{workspace.totalSessionCount === 1 ? '' : 's'}</span>
        {workspace.dirtyFileCount !== null && workspace.dirtyFileCount > 0 && (
          <span className="text-orange-500">{workspace.dirtyFileCount} dirty</span>
        )}
        <span>{relativeTime(workspace.lastActivityAt)}</span>
      </div>
    </button>
  );
}
