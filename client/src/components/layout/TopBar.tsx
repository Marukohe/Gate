import { Menu, Moon, Sun } from 'lucide-react';
import { useUIStore } from '@/stores/ui-store';

export function TopBar() {
  const darkMode = useUIStore((s) => s.darkMode);
  const toggleDarkMode = useUIStore((s) => s.toggleDarkMode);
  const toggleSidebar = useUIStore((s) => s.toggleSidebar);

  return (
    <div className="flex items-center border-b px-4 py-2 pt-[max(0.5rem,env(safe-area-inset-top))] lg:hidden">
      <button
        onClick={toggleSidebar}
        className="-ml-1 rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
        title="Open navigation"
      >
        <Menu className="h-4 w-4" />
      </button>
      <span className="ml-2 text-sm font-medium">Gate</span>
      <div className="flex-1" />
      <button onClick={toggleDarkMode} className="rounded-md p-1.5 text-muted-foreground hover:text-foreground transition-colors">
        {darkMode ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
      </button>
    </div>
  );
}
