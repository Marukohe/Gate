import { Moon, Sun } from 'lucide-react';
import { useServerStore } from '@/stores/server-store';
import { useUIStore } from '@/stores/ui-store';

export function TopBar() {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const servers = useServerStore((s) => s.servers);
  const activeServer = servers.find((s) => s.id === activeServerId);
  const darkMode = useUIStore((s) => s.darkMode);
  const toggleDarkMode = useUIStore((s) => s.toggleDarkMode);

  return (
    <div className="flex h-10 items-center border-b px-4 lg:hidden">
      <span className="text-sm font-medium">{activeServer?.name ?? 'Gate'}</span>
      <div className="flex-1" />
      <button onClick={toggleDarkMode} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors">
        {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </div>
  );
}
