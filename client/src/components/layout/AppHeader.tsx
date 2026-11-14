import { ArrowLeft, Moon, Plus, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/ui-store';
import { SessionAttention } from './SessionAttention';
import type { SessionTarget } from '@/lib/attention';

export function AppHeader({ home, onHome, onAddServer, current, onOpen }: {
  home: boolean; onHome: () => void; onAddServer: () => void;
  current: SessionTarget | null; onOpen: (serverId: string, threadId: string) => void;
}) {
  const dark = useUIStore((state) => state.darkMode);
  const toggleDark = useUIStore((state) => state.toggleDarkMode);
  return <header className="gate-header">
    <button className="gate-brand" onClick={onHome} aria-label="Gate home">
      <span className="gate-mark" aria-hidden="true">g</span><span className={!home ? 'hidden sm:inline' : ''}>Gate</span>
    </button>
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {!home && <Button size="sm" variant="ghost" aria-label="All sessions" title="All sessions" className="px-2" onClick={onHome}><ArrowLeft /><span className="hidden sm:inline">All sessions</span></Button>}
      <SessionAttention current={current} onOpen={onOpen} />
    </div>
    <div className="flex shrink-0 items-center gap-1">
      {home && <Button size="sm" variant="ghost" onClick={onAddServer}><Plus />Add server</Button>}
      <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" title="Toggle theme" onClick={toggleDark}>
        {dark ? <Sun /> : <Moon />}
      </Button>
    </div>
  </header>;
}
