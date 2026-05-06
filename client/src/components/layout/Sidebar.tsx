import { useState, useMemo } from 'react';
import { Plus, Moon, Sun, Bell, FolderOpen, GitBranch as GitBranchIcon, ChevronDown, ChevronRight, Server } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuCheckboxItem,
  DropdownMenuTrigger,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { useServerStore, type Server as ServerType } from '@/stores/server-store';
import { useSessionStore, type AgentStatus } from '@/stores/session-store';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useUIStore } from '@/stores/ui-store';
import { requestNotificationPermission, ensureAudioContext } from '@/lib/notification';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface SidebarProps {
  onAddServer: () => void;
  onEditServer: (server: ServerType) => void;
  onSelectSession?: (serverId: string, sessionId: string) => void;
  onSelectWorkspace?: (workspaceId: string) => void;
  onAddWorkspace?: () => void;
  onClose?: () => void;
}

function isAgentWorking(status?: AgentStatus): boolean {
  return !!status && (status.state === 'thinking' || status.state === 'tool_call');
}

function agentDot(status?: AgentStatus): string {
  if (!status || status.state === 'disconnected') return 'bg-muted-foreground/40';
  if (status.state === 'connecting') return 'bg-yellow-500';
  if (status.state === 'thinking') return 'bg-blue-500';
  if (status.state === 'tool_call') return 'bg-purple-500';
  return 'bg-green-500'; // idle
}

function agentDotsColor(status?: AgentStatus): string {
  if (!status) return 'text-muted-foreground/40';
  if (status.state === 'thinking') return 'text-blue-500';
  if (status.state === 'tool_call') return 'text-purple-500';
  return 'text-muted-foreground/40';
}

function agentLabel(status?: AgentStatus): string {
  if (!status || status.state === 'idle') return '';
  if (status.state === 'thinking') return 'thinking...';
  if (status.state === 'tool_call') return status.toolName;
  if (status.state === 'connecting') return 'connecting...';
  return '';
}

export function Sidebar({ onAddServer, onEditServer: _onEditServer, onSelectSession, onSelectWorkspace, onAddWorkspace, onClose }: SidebarProps) {
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const allSessions = useSessionStore((s) => s.sessions);
  const agentStatus = useSessionStore((s) => s.agentStatus);
  const gitInfo = useSessionStore((s) => s.gitInfo);
  const currentActiveSessionId = useSessionStore((s) => activeServerId ? s.activeSessionId[activeServerId] : undefined);

  const workspaceMap = useWorkspaceStore((s) => s.workspaces);
  const workspaceList = useMemo(
    () => Object.values(workspaceMap).sort((a, b) => (b.lastActivityAt ?? b.updatedAt) - (a.lastActivityAt ?? a.updatedAt)),
    [workspaceMap],
  );

  const darkMode = useUIStore((s) => s.darkMode);
  const toggleDarkMode = useUIStore((s) => s.toggleDarkMode);
  const notifyBrowser = useUIStore((s) => s.notifyBrowser);
  const notifyToast = useUIStore((s) => s.notifyToast);
  const notifySound = useUIStore((s) => s.notifySound);
  const setNotifyBrowser = useUIStore((s) => s.setNotifyBrowser);
  const setNotifyToast = useUIStore((s) => s.setNotifyToast);
  const setNotifySound = useUIStore((s) => s.setNotifySound);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const toggleCollapse = (key: string) => setCollapsed((s) => ({ ...s, [key]: !s[key] }));

  // When onClose is set we're inside the mobile bottom sheet — skip fixed sizing
  const isMobile = !!onClose;

  return (
    <>
      <div className={cn(
        'flex flex-col bg-muted/40',
        isMobile ? 'w-full' : 'h-full w-64 border-r',
      )}>
        {!isMobile && (
          <div className="px-3 py-3 pt-[max(0.75rem,env(safe-area-inset-top))] text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Workspaces
          </div>
        )}
        <div className={cn('overflow-y-auto px-2 space-y-1', !isMobile && 'flex-1')}>
          {/* Header row with Add workspace */}
          <div className="flex items-center justify-between px-1 pt-1 pb-1">
            <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Workspaces</span>
            {onAddWorkspace && (
              <button
                className="rounded p-0.5 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                onClick={() => { onAddWorkspace(); onClose?.(); }}
                title="Add workspace"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          {/* Workspace list */}
          {workspaceList.map((ws) => {
            const workspaceSessions = (allSessions[ws.serverId] ?? []).filter((s) => s.workspaceId === ws.id);
            const expanded = !collapsed[`ws:${ws.id}`];
            const anyActive = workspaceSessions.some((s) => isAgentWorking(agentStatus[s.id]));
            const server = servers.find((sv) => sv.id === ws.serverId);
            return (
              <div key={ws.id}>
                <button
                  className={cn(
                    'group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                    'text-foreground/70 hover:bg-accent/50 hover:text-accent-foreground',
                  )}
                  onClick={() => { onSelectWorkspace?.(ws.id); onClose?.(); }}
                >
                  <span
                    role="button"
                    className="shrink-0 text-muted-foreground/60 p-0.5 -m-0.5 rounded hover:bg-accent"
                    onClick={(e) => { e.stopPropagation(); toggleCollapse(`ws:${ws.id}`); }}
                  >
                    {workspaceSessions.length === 0 || !expanded
                      ? <ChevronRight className="h-3.5 w-3.5" />
                      : <ChevronDown className="h-3.5 w-3.5" />}
                  </span>
                  <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/70" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate font-medium text-xs">{ws.name}</span>
                      {anyActive && <span className="h-1.5 w-1.5 rounded-full bg-blue-500 shrink-0" />}
                    </div>
                    <div className="text-[10px] text-muted-foreground truncate">
                      {server?.name ?? '?'}
                      {ws.defaultBranch && (<><span className="mx-1">·</span><GitBranchIcon className="inline h-2.5 w-2.5 mr-0.5" />{ws.defaultBranch}</>)}
                    </div>
                  </div>
                </button>
                {expanded && workspaceSessions.length > 0 && (
                  <div className="ml-5 mt-1 border-l border-border/50 pl-0 space-y-px">
                    {workspaceSessions.map((session) => {
                      const isActiveSession = currentActiveSessionId === session.id;
                      const agent = agentStatus[session.id];
                      const git = gitInfo[session.id];
                      const dirName = session.name;
                      const label = agentLabel(agent);
                      const isWorktree = git?.worktree && git.worktree !== ws.repoPath;

                      return (
                        <button
                          key={session.id}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-r-md pl-3 pr-2 py-1.5 text-xs transition-colors',
                            isActiveSession
                              ? 'bg-primary/10 text-primary border-l-2 border-primary -ml-px'
                              : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                          )}
                          onClick={() => { onSelectSession?.(session.serverId, session.id); onClose?.(); }}
                        >
                          {isWorktree
                            ? <GitBranchIcon className={cn('h-3.5 w-3.5 shrink-0', isActiveSession ? 'text-primary' : 'text-muted-foreground/60')} />
                            : <FolderOpen className={cn('h-3.5 w-3.5 shrink-0', isActiveSession ? 'text-primary' : 'text-muted-foreground/60')} />}
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-1.5">
                              <span className="truncate font-medium">{dirName}</span>
                              {isAgentWorking(agent) ? (
                                <span className={cn('agent-dots shrink-0', agentDotsColor(agent))}>
                                  <span /><span /><span />
                                </span>
                              ) : (
                                <span className={cn('h-1.5 w-1.5 rounded-full shrink-0', agentDot(agent))} />
                              )}
                            </div>
                            {(git || label) && (
                              <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5">
                                {git && (
                                  <span className="flex items-center gap-0.5 truncate">
                                    <GitBranchIcon className="h-2.5 w-2.5 shrink-0" />
                                    {git.branch}
                                  </span>
                                )}
                                {label && (
                                  <span className={cn(
                                    'truncate',
                                    agent?.state === 'thinking' && 'text-blue-500',
                                    agent?.state === 'tool_call' && 'text-purple-500',
                                  )}>
                                    {label}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}

          {/* Loose sessions footer (per server) */}
          {servers.map((server) => {
            const loose = (allSessions[server.id] ?? []).filter((s) => s.workspaceId === null);
            if (loose.length === 0) return null;
            const expanded = !collapsed[`loose:${server.id}`];
            return (
              <div key={`loose-${server.id}`} className="mt-3">
                <button
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground"
                  onClick={() => toggleCollapse(`loose:${server.id}`)}
                >
                  {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                  <Server className="h-3.5 w-3.5" />
                  <span className="truncate">Loose · {server.name}</span>
                  <span className="ml-auto text-[10px]">{loose.length}</span>
                </button>
                {expanded && (
                  <div className="ml-5 mt-1 border-l border-border/50 pl-0 space-y-px">
                    {loose.map((session) => {
                      const isActiveSession = currentActiveSessionId === session.id;
                      return (
                        <button
                          key={session.id}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-r-md pl-3 pr-2 py-1.5 text-xs transition-colors',
                            isActiveSession
                              ? 'bg-primary/10 text-primary border-l-2 border-primary -ml-px'
                              : 'text-muted-foreground hover:bg-accent/50 hover:text-accent-foreground',
                          )}
                          onClick={() => { onSelectSession?.(server.id, session.id); onClose?.(); }}
                        >
                          <FolderOpen className="h-3.5 w-3.5 shrink-0 text-muted-foreground/60" />
                          <span className="truncate flex-1">{session.name}</span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className={cn('flex items-center justify-end gap-1 px-2 py-3 sm:px-3 sm:py-4', !isMobile && 'border-t')}>
          <Button variant="outline" className="h-10 gap-1 px-3" onClick={() => { onAddServer(); onClose?.(); }}>
            <Plus className="h-4 w-4" />
            Server
          </Button>
          <div className="flex-1" />
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className={cn('h-10 w-10', (notifyBrowser || notifyToast || notifySound) && 'text-primary')}>
                <Bell className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuLabel>Notifications</DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuCheckboxItem
                checked={notifyToast}
                onCheckedChange={(checked) => setNotifyToast(!!checked)}
              >
                In-app toast
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={notifyBrowser}
                onCheckedChange={async (checked) => {
                  if (checked) {
                    if (!('Notification' in window)) {
                      toast.error('Browser notifications are not supported');
                      return;
                    }
                    const granted = await requestNotificationPermission();
                    if (!granted) {
                      toast.error('Notification permission denied. Check browser settings.');
                      return;
                    }
                  }
                  setNotifyBrowser(!!checked);
                }}
              >
                Browser notification
              </DropdownMenuCheckboxItem>
              <DropdownMenuCheckboxItem
                checked={notifySound}
                onCheckedChange={(checked) => {
                  setNotifySound(!!checked);
                  if (checked) ensureAudioContext();
                }}
              >
                Sound
              </DropdownMenuCheckboxItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button variant="ghost" size="icon" className="h-10 w-10" onClick={toggleDarkMode}>
            {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
          </Button>
        </div>
      </div>
    </>
  );
}
