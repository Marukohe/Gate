import { useState, useRef } from 'react';
import { Plus, GitBranch, ClipboardList } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
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
import { BranchSwitcher } from './BranchSwitcher';
import { useSessionStore, type Session } from '@/stores/session-store';
import { useServerStore } from '@/stores/server-store';
import { usePlanStore } from '@/stores/plan-store';
import { useUIStore } from '@/stores/ui-store';
import { cn } from '@/lib/utils';

const EMPTY_SESSIONS: Session[] = [];

interface SessionBarProps {
  serverId: string;
  onCreateSession: (name: string, workingDir: string | null) => void;
  onDeleteSession: (sessionId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onListBranches: (serverId: string, sessionId: string) => void;
  onSwitchBranch: (serverId: string, sessionId: string, branch: string) => void;
}

export function SessionBar({ serverId, onCreateSession, onDeleteSession, onSelectSession, onListBranches, onSwitchBranch }: SessionBarProps) {
  const sessions = useSessionStore((s) => s.sessions[serverId]) ?? EMPTY_SESSIONS;
  const activeSessionId = useSessionStore((s) => s.activeSessionId[serverId]);
  const connectionStatus = useSessionStore((s) => s.connectionStatus);
  const gitInfo = useSessionStore((s) => s.gitInfo);
  const server = useServerStore((s) => s.servers.find((sv) => sv.id === serverId));

  const [deleteTarget, setDeleteTarget] = useState<Session | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [createDialogOpen, setCreateDialogOpen] = useState(false);
  const [branchSessionId, setBranchSessionId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState('');
  const renameInputRef = useRef<HTMLInputElement>(null);
  const activePlanId = usePlanStore((s) => s.activePlanId);
  const togglePlanPanel = useUIStore((s) => s.togglePlanPanel);
  const planPanelOpen = useUIStore((s) => s.planPanelOpen);

  const statusDot = (sessionId: string) => {
    const status = connectionStatus[sessionId];
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

  if (sessions.length <= 1 && !sessions.some((s) => s.id !== activeSessionId)) {
    // Only one session and it's active — show minimal bar
  }

  return (
    <>
      <div className="flex items-center gap-1 border-b px-2 py-1 overflow-x-auto scrollbar-none">
        {sessions.map((session) => (
          <ContextMenu key={session.id}>
            <ContextMenuTrigger asChild>
              {renamingId === session.id ? (
                <Input
                  ref={renameInputRef}
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitRename();
                    if (e.key === 'Escape') setRenamingId(null);
                  }}
                  className="h-6 w-24 px-2 text-xs"
                />
              ) : (
                <button
                  className={cn(
                    'flex items-center gap-1.5 rounded-full px-3 py-0.5 text-xs whitespace-nowrap transition-colors',
                    activeSessionId === session.id
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted text-muted-foreground hover:bg-muted/80'
                  )}
                  onClick={() => onSelectSession(session.id)}
                >
                  <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', statusDot(session.id))} />
                  {session.name}
                  {gitInfo[session.id] && (
                    <span
                      role="button"
                      className="flex items-center gap-0.5 opacity-70 hover:opacity-100 transition-opacity"
                      onClick={(e) => {
                        e.stopPropagation();
                        setBranchSessionId(session.id);
                      }}
                    >
                      <GitBranch className="h-3 w-3" />
                      {gitInfo[session.id].branch}
                    </span>
                  )}
                </button>
              )}
            </ContextMenuTrigger>
            <ContextMenuContent>
              <ContextMenuItem onClick={() => startRename(session)}>
                Rename
              </ContextMenuItem>
              {sessions.length > 1 && (
                <ContextMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={() => setDeleteTarget(session)}
                >
                  Delete
                </ContextMenuItem>
              )}
            </ContextMenuContent>
          </ContextMenu>
        ))}
        <Button
          variant="ghost"
          size="icon"
          className="h-6 w-6 shrink-0"
          onClick={() => setCreateDialogOpen(true)}
        >
          <Plus className="h-3.5 w-3.5" />
        </Button>

        {activePlanId && (
          <>
            <div className="flex-1" />
            <Button
              variant="ghost"
              size="icon"
              className={cn('h-6 w-6 shrink-0', planPanelOpen && 'bg-accent')}
              onClick={togglePlanPanel}
              title="Toggle plan panel"
            >
              <ClipboardList className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>

      <CreateSessionDialog
        open={createDialogOpen}
        onOpenChange={setCreateDialogOpen}
        onSubmit={onCreateSession}
        defaultName={`Session ${sessions.length + 1}`}
        defaultWorkingDir={server?.defaultWorkingDir}
        serverId={serverId}
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
