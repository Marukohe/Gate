import { Server, Plus, Circle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from '@/components/ui/tooltip';
import { useServerStore } from '@/stores/server-store';
import { cn } from '@/lib/utils';

interface SidebarProps {
  onAddServer: () => void;
}

export function Sidebar({ onAddServer }: SidebarProps) {
  const servers = useServerStore((s) => s.servers);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const connectionStatus = useServerStore((s) => s.connectionStatus);
  const setActiveServer = useServerStore((s) => s.setActiveServer);

  const statusColor = (id: string) => {
    const status = connectionStatus[id];
    if (status === 'connected') return 'text-green-500';
    if (status === 'connecting') return 'text-yellow-500';
    if (status === 'error') return 'text-red-500';
    return 'text-muted-foreground';
  };

  return (
    <TooltipProvider delayDuration={0}>
      <div className="flex h-full w-16 flex-col items-center gap-2 border-r bg-muted/40 py-4">
        {servers.map((server) => (
          <Tooltip key={server.id}>
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
            <TooltipContent side="right">{server.name}</TooltipContent>
          </Tooltip>
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
    </TooltipProvider>
  );
}
