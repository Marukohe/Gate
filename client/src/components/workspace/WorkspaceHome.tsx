import { Check, GitBranch, Pencil, Plus, Settings2, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useSessionStore, type Session } from '@/stores/session-store';
import { useServerStore } from '@/stores/server-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { WorkspaceStart } from './WorkspaceStart';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useEffect, useState, useMemo } from 'react';
import type { WorkspaceStartOptions } from './WorkspaceStart';

interface WorkspaceHomeProps {
  workspaceId: string;
  onNewSession: () => void;
  onStartTask: (workspaceId: string, goal: string, options: WorkspaceStartOptions) => void;
  onSelectSession: (serverId: string, sessionId: string) => void;
}

export function WorkspaceHome({ workspaceId, onNewSession, onStartTask, onSelectSession }: WorkspaceHomeProps) {
  const ws = useWorkspaceStore((s) => s.workspaces[workspaceId]);
  // Subscribe to the sessions Record itself (stable shape) and filter in-render
  // with useMemo. A selector that calls sessionsByWorkspace() would construct a
  // new array every time, causing re-renders on every unrelated store mutation.
  const sessionsByServer = useSessionStore((s) => s.sessions);
  const sessions = useMemo(() => {
    const out: Session[] = [];
    for (const list of Object.values(sessionsByServer)) {
      for (const s of list) if (s.workspaceId === workspaceId && !s.isHidden) out.push(s);
    }
    return out;
  }, [sessionsByServer, workspaceId]);
  const gitInfo = useSessionStore((s) => s.gitInfo);
  const agentStatus = useSessionStore((s) => s.agentStatus);
  const serverName = useServerStore((s) => s.servers.find((sv) => sv.id === ws?.serverId)?.name ?? '');
  const workspaceBranches = useWorkspaceStore((s) => s.branches[workspaceId]);
  const { updateWorkspace, deleteWorkspace, listWorkspaceBranches } = useWebSocket();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [nameDraft, setNameDraft] = useState('');

  useEffect(() => {
    if (ws) listWorkspaceBranches(ws.id);
  }, [ws, listWorkspaceBranches]);

  function relativeTime(ts: number | null | undefined): string {
    if (!ts) return '—';
    const diff = Date.now() - ts;
    const m = Math.floor(diff / 60000);
    if (m < 1) return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }
  function isWorking(s?: { state: string }): boolean {
    return !!s && (s.state === 'thinking' || s.state === 'tool_call');
  }

  if (!ws) {
    return <div className="p-8 text-sm text-muted-foreground">Workspace not found.</div>;
  }

  const primarySession = sessions.find((s) => s.id === ws.primarySessionId) ?? sessions[0];
  const primaryGit = primarySession ? gitInfo[primarySession.id] : undefined;
  const displayBranch = primaryGit?.branch ?? workspaceBranches?.current ?? ws.defaultBranch;
  const baseCheckoutPath = primaryGit?.worktree ?? primarySession?.workingDir ?? ws.repoPath;
  const displayPath = baseCheckoutPath;

  const startRename = () => {
    setNameDraft(ws.name);
    setRenaming(true);
  };

  const saveRename = () => {
    const nextName = nameDraft.trim();
    if (nextName && nextName !== ws.name) updateWorkspace(ws.id, { name: nextName });
    setRenaming(false);
  };

  // Map each non-main-checkout worktree path to the sessions bound to it
  const worktreeBindings = (() => {
    const map = new Map<string, string[]>();
    for (const s of sessions) {
      const wt = gitInfo[s.id]?.worktree;
      if (wt && wt !== baseCheckoutPath) {
        const existing = map.get(wt) ?? [];
        existing.push(s.name);
        map.set(wt, existing);
      }
    }
    return Array.from(map.entries()).map(([path, names]) => ({ path, sessions: names }));
  })();

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      <div className="border-b px-6 py-4">
        <div className="flex items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              {renaming ? (
                <div className="flex min-w-0 items-center gap-1">
                  <Input
                    value={nameDraft}
                    onChange={(event) => setNameDraft(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') saveRename();
                      if (event.key === 'Escape') setRenaming(false);
                    }}
                    className="h-8 max-w-sm text-xl font-semibold"
                    autoFocus
                  />
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={saveRename} title="Save name">
                    <Check className="h-4 w-4" />
                  </Button>
                  <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setRenaming(false)} title="Cancel rename">
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              ) : (
                <>
                  <h1 className="truncate text-xl font-semibold">{ws.name}</h1>
                  <Button variant="ghost" size="icon" className="h-7 w-7 text-muted-foreground" onClick={startRename} title="Rename workspace">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                </>
              )}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>{serverName || 'server'}</span>
              {displayBranch && (<><span>·</span><span className="flex items-center gap-1"><GitBranch className="h-3 w-3" />{displayBranch}</span></>)}
              {ws.remoteUrl && (<><span>·</span><a href={ws.remoteUrl} target="_blank" rel="noreferrer" className="underline">{ws.remoteUrl}</a></>)}
            </div>
            <div className="mt-1 font-mono text-[11px] text-muted-foreground">{displayPath}</div>
          </div>
          <Button size="sm" onClick={onNewSession}>
            <Plus className="h-4 w-4" /> New session
          </Button>
        </div>
      </div>

      <WorkspaceStart
        workspaceName={ws.name}
        defaultBranch={ws.defaultBranch}
        branches={workspaceBranches}
        existingWorktrees={worktreeBindings.map((binding) => binding.path)}
        onStart={(goal, options) => onStartTask(ws.id, goal, options)}
      />

      <section className="px-6 py-4">
        <h2 className="text-sm font-semibold mb-2">Sessions ({sessions.length})</h2>
        {sessions.length === 0 ? (
          <div className="text-xs text-muted-foreground">No sessions yet.</div>
        ) : (
          <ul className="divide-y rounded border">
            {sessions.map((s) => {
              const git = gitInfo[s.id];
              const status = agentStatus[s.id];
              const working = isWorking(status);
              const isWorktree = git?.worktree && git.worktree !== baseCheckoutPath;
              return (
                <li key={s.id}>
                  <button
                    className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-accent/50"
                    onClick={() => onSelectSession(s.serverId, s.id)}
                  >
                    <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${working ? (status?.state === 'tool_call' ? 'bg-purple-500' : 'bg-blue-500') : 'bg-muted-foreground/40'}`} />
                    <span className="truncate flex-1">{s.name}</span>
                    {isWorktree && git && (
                      <span className="text-[11px] text-muted-foreground font-mono truncate max-w-[180px]" title={git.worktree}>{git.worktree}</span>
                    )}
                    {git && (
                      <span className="text-[11px] text-muted-foreground flex items-center gap-1"><GitBranch className="h-3 w-3" />{git.branch}</span>
                    )}
                    <span className="text-[11px] text-muted-foreground shrink-0">{relativeTime(s.lastActiveAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {worktreeBindings.length > 0 && (
        <section className="px-6 py-4">
          <h2 className="text-sm font-semibold mb-2">Worktrees ({worktreeBindings.length})</h2>
          <ul className="divide-y rounded border">
            {worktreeBindings.map((b) => (
              <li key={b.path} className="px-3 py-2 text-xs">
                <div className="font-mono text-muted-foreground truncate">{b.path}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">
                  {b.sessions.length} session{b.sessions.length === 1 ? '' : 's'}: {b.sessions.join(', ')}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="px-6 py-4 border-t mt-auto">
        <button
          className="flex items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          onClick={() => setSettingsOpen((open) => !open)}
        >
          <Settings2 className="h-3.5 w-3.5" />
          Workspace settings
        </button>
        {settingsOpen && (
          <div className="mt-3">
            <Button variant="ghost" size="sm" className="h-8 text-destructive hover:text-destructive" onClick={() => setConfirmDelete(true)}>
              <Trash2 className="h-4 w-4" /> Delete workspace
            </Button>
          </div>
        )}
      </section>

      <AlertDialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete workspace</AlertDialogTitle>
            <AlertDialogDescription>
              "{ws.name}" and its {sessions.length} session(s) ({sessions.map((s) => s.name).join(', ') || 'none'}) will be permanently deleted. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deleteWorkspace(ws.id)} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
