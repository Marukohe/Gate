import { useState, useRef, useCallback } from 'react';
import { ChevronRight, FolderGit2, GitBranch, LayoutDashboard, MoreHorizontal, PanelRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { CreateSessionDialog } from './CreateSessionDialog';
import { ResumeChatDialog } from './ResumeChatDialog';
import { BranchSwitcher } from './BranchSwitcher';
import { ProviderSwitcher } from './ProviderSwitcher';
import { useSessionStore, type Session } from '@/stores/session-store';
import { useServerStore } from '@/stores/server-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { useUIStore } from '@/stores/ui-store';
import { useGitStore } from '@/stores/git-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { cn } from '@/lib/utils';

const EMPTY_SESSIONS: Session[] = [];

interface SessionBarProps {
  serverId: string;
  onCreateSession: (name: string, workingDir: string | null, claudeSessionId?: string | null, provider?: string) => void;
  onDeleteSession: (sessionId: string) => void;
  onListBranches: (serverId: string, sessionId: string) => void;
  onSwitchBranch: (serverId: string, sessionId: string, branch: string) => void;
  onSyncTranscript: (sessionId: string) => void;
  onListClaudeSessions?: (serverId: string, workingDir: string) => Promise<string[]>;
  onListCliSessions?: (serverId: string, workingDir: string, provider: string) => Promise<string[]>;
  onOpenWorkspace?: (workspaceId: string) => void;
}

export function SessionBar({ serverId, onCreateSession, onDeleteSession, onListBranches, onSwitchBranch, onSyncTranscript, onListClaudeSessions, onListCliSessions, onOpenWorkspace }: SessionBarProps) {
  const sessions = useSessionStore((s) => s.sessions[serverId]) ?? EMPTY_SESSIONS;
  const activeSessionId = useSessionStore((s) => s.activeSessionId[serverId]);
  const connectionStatus = useSessionStore((s) => s.connectionStatus);
  const gitInfo = useSessionStore((s) => s.gitInfo);
  const server = useServerStore((s) => s.servers.find((sv) => sv.id === serverId));
  const activeSession = sessions.find((session) => session.id === activeSessionId);
  const workspace = useWorkspaceStore((s) => activeSession?.workspaceId ? s.workspaces[activeSession.workspaceId] : undefined);

  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [branchSessionId, setBranchSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const rightPanelOpen = useUIStore((s) => s.rightPanelOpen);
  const toggleRightPanel = useUIStore((s) => s.toggleRightPanel);
  const syncStatus = useUIStore((s) => s.syncStatus);
  const activeTab = useUIStore((s) => s.activeTab);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const prInfo = useGitStore((s) => activeSessionId ? s.prInfo[activeSessionId] : null);
  const { resetConversation, resumeCliSession, listCliSessions } = useWebSocket();
  const [resumeDialogSession, setResumeDialogSession] = useState<Session | null>(null);

  const listSessionsForResume = useCallback(
    () => {
      if (!resumeDialogSession) return Promise.resolve([]);
      return listCliSessions(serverId, resumeDialogSession.workingDir ?? '', resumeDialogSession.provider ?? 'claude');
    },
    [serverId, resumeDialogSession, listCliSessions],
  );

  const statusDot = () => {
    const status = activeSessionId ? connectionStatus[activeSessionId] : undefined;
    if (status === 'connected') return 'bg-green-500';
    if (status === 'connecting') return 'bg-yellow-500';
    if (status === 'error') return 'bg-red-500';
    return 'bg-muted-foreground/40';
  };

  const startRename = (session: Session) => {
    setRenamingId(session.id);
    setRenameValue(session.name);
    setTimeout(() => renameInputRef.current?.focus(), 0);
  };

  const commitRename = async () => {
    if (!renamingId || !renameValue.trim()) {
      setRenamingId(null);
      return;
    }
    await fetch(`/api/servers/${serverId}/sessions/${renamingId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: renameValue.trim() }),
    });
    // Refresh sessions list
    const res = await fetch(`/api/servers/${serverId}/sessions`);
    if (res.ok) {
      const updated = await res.json();
      useSessionStore.getState().setSessions(serverId, updated);
    }
    setRenamingId(null);
  };

  const handleDelete = () => {
    if (!deleteTarget) return;
    onDeleteSession(deleteTarget.id);
    setDeleteTarget(null);
  };

  return (
    <>
      <div className="flex min-h-9 items-center gap-2 border-b px-2 py-1">
        <div className="flex min-w-0 flex-1 items-center gap-1.5">
          {workspace ? (
            <button
              className="flex min-w-0 items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              onClick={() => onOpenWorkspace?.(workspace.id)}
              title="Open workspace board"
            >
              <LayoutDashboard className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate max-w-[9rem] sm:max-w-[14rem]">{workspace.name}</span>
            </button>
          ) : (
            <div className="flex min-w-0 items-center gap-1.5 px-2 py-1 text-xs text-muted-foreground">
              <FolderGit2 className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate max-w-[9rem] sm:max-w-[14rem]">{server?.name ?? 'Server'}</span>
            </div>
          )}
          <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/50" />
          {renamingId === activeSession?.id ? (
            <Input
              ref={renameInputRef}
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename();
                if (e.key === 'Escape') setRenamingId(null);
              }}
              className="h-7 min-w-24 max-w-48 px-2 text-xs"
            />
          ) : (
            <div className="flex min-w-0 items-center gap-1.5 px-1 text-xs">
              <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', statusDot())} />
              <span className="truncate font-medium max-w-[9rem] sm:max-w-[16rem]">{activeSession?.name ?? 'No session'}</span>
            </div>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-1">
          <button
            className={cn(
              'rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
              activeTab === 'chat' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
            )}
            onClick={() => setActiveTab('chat')}
          >
            Chat
          </button>
          <button
            className={cn(
              'rounded-md px-2 py-0.5 text-xs font-medium transition-colors',
              activeTab === 'diff' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
            )}
            onClick={() => setActiveTab('diff')}
          >
            Diff
          </button>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={() => setCreateDialogOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>

        <ProviderSwitcher />

        {activeSessionId && gitInfo[activeSessionId] && (
          <Button
            variant="ghost"
            className="h-6 max-w-[8rem] shrink-0 gap-1 px-2 text-xs"
            onClick={() => setBranchSessionId(activeSessionId)}
            title="Switch branch"
          >
            <GitBranch className="h-3.5 w-3.5" />
            <span className="truncate">{gitInfo[activeSessionId].branch}</span>
          </Button>
        )}

        {prInfo && (
          <a
            href={prInfo.url}
            target="_blank"
            rel="noopener noreferrer"
            className="ml-1 inline-flex items-center gap-1 rounded-md bg-green-500/10 px-2 py-0.5 text-xs text-green-600 dark:text-green-400 hover:bg-green-500/20"
          >
            PR #{prInfo.number}
          </a>
        )}

        {activeSession && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6 shrink-0" title="Session actions">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => setResumeDialogSession(activeSession)}>
                Switch CLI session
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => startRename(activeSession)}>
                Rename
              </DropdownMenuItem>
              <DropdownMenuItem
                disabled={syncStatus[activeSession.id]?.state === 'syncing'}
                onClick={() => onSyncTranscript(activeSession.id)}
              >
                {syncStatus[activeSession.id]?.state === 'syncing' ? 'Syncing...' : 'Sync transcript'}
              </DropdownMenuItem>
              {sessions.length > 1 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteTarget(activeSession)}
                  >
                    Delete session
                  </DropdownMenuItem>
                </>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}

        <Button
          variant="ghost"
          size="icon"
          className={cn('h-6 w-6 shrink-0', rightPanelOpen && 'bg-accent')}
          onClick={toggleRightPanel}
          title="Toggle details"
        >
          <PanelRight className="h-3.5 w-3.5" />
        </Button>
      </div>

      <CreateSessionDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={onCreateSession}
        defaultName={`Session ${sessions.length + 1}`}
        defaultWorkingDir={server?.defaultWorkingDir}
        serverId={serverId}
        onListClaudeSessions={onListClaudeSessions}
        onListCliSessions={onListCliSessions}
      />

      <ResumeChatDialog
        open={!!resumeDialogSession}
        onOpenChange={(open) => { if (!open) setResumeDialogSession(null); }}
        onResume={(cliSessionId) => resumeDialogSession && resumeCliSession(serverId, resumeDialogSession.id, cliSessionId)}
        onNewChat={() => resumeDialogSession && resetConversation(serverId, resumeDialogSession.id)}
        listSessions={listSessionsForResume}
        currentCliSessionId={resumeDialogSession?.cliSessionId}
      />

      {branchSessionId && (
        <BranchSwitcher
          open={!!branchSessionId}
          onOpenChange={(open) => { if (!open) setBranchSessionId(null); }}
          sessionId={branchSessionId}
          serverId={serverId}
          onListBranches={onListBranches}
          onSwitchBranch={onSwitchBranch}
        />
      )}

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete session</AlertDialogTitle>
            <AlertDialogDescription>
              Delete "{deleteTarget?.name}"? All messages in this session will be lost.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
