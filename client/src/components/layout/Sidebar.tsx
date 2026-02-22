import { useState } from 'react';
import { Plus, Pencil, Trash2, MoreVertical } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
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
import { useServerStore, type Server as ServerType } from '@/stores/server-store';
import { useSessionStore } from '@/stores/session-store';
import { cn } from '@/lib/utils';
import { getInitials, getAvatarColor } from '@/lib/server-utils';

interface SidebarProps {
  onAddServer: () => void;
  onEditServer: (server: ServerType) => void;
  onClose?: () => void;
}

export function Sidebar({ onAddServer, onEditServer, onClose }: SidebarProps) {
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const removeServer = useServerStore((s) => s.removeServer);
  const activeSessionIds = useSessionStore((s) => s.activeSessionId);
  const connectionStatus = useSessionStore((s) => s.connectionStatus);

  const [deleteTarget, setDeleteTarget] = useState<ServerType | null>(null);

  const statusInfo = (serverId: string) => {
    const sessionId = activeSessionIds[serverId];
    if (!sessionId) return { color: 'bg-muted-foreground/40', label: '' };
    const status = connectionStatus[sessionId];
    if (status === 'connected') return { color: 'bg-green-500', label: 'Connected' };
    if (status === 'connecting') return { color: 'bg-yellow-500', label: 'Connecting...' };
    if (status === 'error') return { color: 'bg-red-500', label: 'Error' };
    return { color: 'bg-muted-foreground/40', label: '' };
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const res = await fetch(`/api/servers/${deleteTarget.id}`, { method: 'DELETE' });
    if (res.ok) {
      removeServer(deleteTarget.id);
    }
    setDeleteTarget(null);
  };

  // When onClose is set we're inside the mobile bottom sheet — skip fixed sizing
  const isMobile = !!onClose;

  return (
    <>
      <div className={cn(
        'flex flex-col bg-muted/40',
        isMobile ? 'w-full' : 'h-full w-52 border-r',
      )}>
        {!isMobile && (
          <div className="px-3 py-3 text-xs font-medium text-muted-foreground uppercase tracking-wider">
            Servers
          </div>
        )}
        <div className={cn('overflow-y-auto px-2 space-y-1', !isMobile && 'flex-1')}>
          {servers.map((server) => {
            const isActive = activeServerId === server.id;
            const status = statusInfo(server.id);
            return (
              <ContextMenu key={server.id}>
                <ContextMenuTrigger asChild>
                  <button
                    className={cn(
                      'group flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm transition-colors',
                      isActive
                        ? 'bg-accent text-accent-foreground'
                        : 'text-foreground/70 hover:bg-accent/50 hover:text-accent-foreground'
                    )}
                    onClick={() => { setActiveServer(server.id); onClose?.(); }}
                  >
                    <div className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-xs font-semibold text-white', getAvatarColor(server.name))}>
                      {getInitials(server.name)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{server.name}</div>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className={cn('inline-block h-1.5 w-1.5 rounded-full', status.color)} />
                        <span className="truncate">{status.label || server.host}</span>
                      </div>
                    </div>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                        <span
                          role="button"
                          className="shrink-0 rounded p-0.5 opacity-60 hover:bg-accent sm:opacity-0 sm:group-hover:opacity-100"
                        >
                          <MoreVertical className="h-4 w-4" />
                        </span>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onClick={() => onEditServer(server)}>
                          <Pencil className="mr-2 h-4 w-4" />
                          Edit
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          className="text-destructive focus:text-destructive"
                          onClick={() => setDeleteTarget(server)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Delete
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </button>
                </ContextMenuTrigger>
                <ContextMenuContent>
                  <ContextMenuItem onClick={() => onEditServer(server)}>
                    <Pencil className="mr-2 h-4 w-4" />
                    Edit
                  </ContextMenuItem>
                  <ContextMenuItem
                    className="text-destructive focus:text-destructive"
                    onClick={() => setDeleteTarget(server)}
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete
                  </ContextMenuItem>
                </ContextMenuContent>
              </ContextMenu>
            );
          })}
        </div>
        <div className={cn('p-4', !isMobile && 'border-t')}>
          <Button variant="outline" className="h-10 w-full justify-start gap-2" onClick={() => { onAddServer(); onClose?.(); }}>
            <Plus className="h-4 w-4" />
            Add Server
          </Button>
        </div>
      </div>

      <AlertDialog open={!!deleteTarget} onOpenChange={(open) => !open && setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete server</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{deleteTarget?.name}"? This will also remove all sessions and messages for this server.
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
