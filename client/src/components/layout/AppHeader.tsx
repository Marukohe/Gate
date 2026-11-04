import { ArrowLeft, Moon, Plus, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/ui-store';

export function AppHeader({ home, onHome, onAddServer }: {
  home: boolean; onHome: () => void; onAddServer: () => void;
}) {
  const dark = useUIStore((state) => state.darkMode);
  const toggleDark = useUIStore((state) => state.toggleDarkMode);
  return <header className="gate-header">
    <button className="gate-brand" onClick={onHome} aria-label="Gate home">
      <span className="gate-mark" aria-hidden="true">g</span><span>Gate</span>
    </button>
    <div className="flex min-w-0 flex-1 items-center">
      {!home && <Button size="sm" variant="ghost" onClick={onHome}><ArrowLeft />All sessions</Button>}
    </div>
    <div className="flex shrink-0 items-center gap-1">
      {home && <Button size="sm" variant="ghost" onClick={onAddServer}><Plus />Add server</Button>}
      <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" title="Toggle theme" onClick={toggleDark}>
        {dark ? <Sun /> : <Moon />}
      </Button>
    </div>
  </header>;
}
