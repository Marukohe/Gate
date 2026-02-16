import { Menu, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/ui-store';
import { useServerStore } from '@/stores/server-store';

export function TopBar() {
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);
  const togglePlanPanel = useUIStore((s) => s.togglePlanPanel);
  const activeServerId = useServerStore((s) => s.activeServerId);
  const servers = useServerStore((s) => s.servers);
  const activeServer = servers.find((s) => s.id === activeServerId);

  return (
    <div className="flex h-12 items-center justify-between border-b px-4 lg:hidden">
      <Button variant="ghost" size="icon" onClick={toggleSidebar}>
        <Menu className="h-5 w-5" />
      </Button>
      <span className="text-sm font-medium">{activeServer?.name ?? 'CodingEverywhere'}</span>
      <Button variant="ghost" size="icon" onClick={togglePlanPanel}>
        <FileText className="h-5 w-5" />
      </Button>
    </div>
  );
}
