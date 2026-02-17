import { useState } from 'react';
import { Server, Plus, Circle, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
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
import { useServerStore, type Server as ServerType } from '@/stores/server-store';
import { cn } from '@/lib/utils';

interface SidebarProps {
  onAddServer: () => void;
}

export function Sidebar({ onAddServer }: SidebarProps) {
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const connectionStatus = useServerStore((s) => s.connectionStatus);
  const connectionError = useServerStore((s) => s.connectionError);
  const setActiveServer = useServerStore((s) => s.setActiveServer);
  const removeServer = useServerStore((s) => s.removeServer);

  const [deleteTarget, setDeleteTarget] = useState<ServerType | null>(null);

  const statusColor = (id: string) => {
    const status = connectionStatus[id];
    if (status === 'connected') return 'text-green-500';
    if (status === 'connecting') return 'text-yellow-500';
    if (status === 'error') return 'text-red-500';
    return 'text-muted-foreground';
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    const res = await fetch(`/api/servers/${deleteTarget.id}`, { method: 'DELETE' });
    if (res.ok) {
      removeServer(deleteTarget.id);
    }
    setDeleteTarget(null);
  };

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-full w-16 flex-col items-center gap-2 border-r bg-muted/40 py-4">
        {servers.map((server) => (
          <ContextMenu key={server.id}>
            <Tooltip>
              <ContextMenuTrigger asChild>
                <TooltipTrigger asChild>
                  <Button
                    variant={activeServerId === server.id ? 'secondary' : 'ghost'}
                    size="icon"
                    className={cn('relative h-10 w-10')}
                    onClick={() => setActiveServer(server.id)}
                  >
                    <Server className="h-5 w-5" />
                    <Circle className={cn('absolute -right-0.5 -top-0.5 h-2.5 w-2.5 fill-current', statusColor(server.id))} />
                  </Button>
                </TooltipTrigger>
              </ContextMenuTrigger>
              <TooltipContent side="right">
                <p>{server.name}</p>
                {connectionStatus[server.id] === 'error' && connectionError[server.id] && (
                  <p className="text-xs text-destructive">{connectionError[server.id]}</p>
                )}
              </TooltipContent>
            </Tooltip>
            <ContextMenuContent>
              <ContextMenuItem
                className="text-destructive focus:text-destructive"
                onClick={() => setDeleteTarget(server)}
              >
                <Trash2 className="mr-2 h-4 w-4" />
                Delete
              </ContextMenuItem>
            </ContextMenuContent>
          </ContextMenu>
        ))}
        <Tooltip>
          <TooltipTrigger asChild>
            <Button variant="ghost" size="icon" className="h-10 w-10" onClick={onAddServer}>
              <Plus className="h-5 w-5" />
            </Button>
          </TooltipTrigger>
          <TooltipContent side="right">Add server</TooltipContent>
        </Tooltip>
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
    </TooltipProvider>
  );
}
