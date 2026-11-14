import { ArrowLeft, ArrowRight, Moon, Plus, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useUIStore } from '@/stores/ui-store';
import { SessionAttention } from './SessionAttention';
import type { SessionTarget } from '@/lib/attention';

export function AppHeader({ home, onHome, onAddServer, current, onOpen, sessionTitleRef, back, next }: {
  home: boolean; onHome: () => void; onAddServer: () => void;
  current: SessionTarget | null; onOpen: (serverId: string, threadId: string) => void;
  sessionTitleRef: (node: HTMLDivElement | null) => void;
  back?: { label: string; run: () => void }; next?: { count: number; run: () => void };
}) {
  const dark = useUIStore((state) => state.darkMode);
  const toggleDark = useUIStore((state) => state.toggleDarkMode);
  return <header className={`gate-header ${home ? '' : 'gate-chat-header'}`}>
    {home && <button className="gate-brand" onClick={onHome} aria-label="Gate home">
      <span className="gate-mark" aria-hidden="true">g</span><span>Gate</span>
    </button>}
    <div className="flex min-w-0 flex-1 items-center gap-1">
      {!home && <>
        <Button size="icon-sm" variant="ghost" aria-label={back?.label ?? 'All sessions'} title={back?.label ?? 'All sessions'} onClick={back?.run ?? onHome}><ArrowLeft /></Button>
        <div ref={sessionTitleRef} className="min-w-0 flex-1" />
        {next && <Button size="icon-sm" variant="ghost" aria-label={`Next needs you · ${next.count}`} title={`Next needs you · ${next.count}`} onClick={next.run}><ArrowRight /></Button>}
      </>}
      <SessionAttention current={current} onOpen={onOpen} />
    </div>
    {home && <div className="flex shrink-0 items-center gap-1">
      {home && <Button size="sm" variant="ghost" onClick={onAddServer}><Plus />Add server</Button>}
      <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" title="Toggle theme" onClick={toggleDark}>
        {dark ? <Sun /> : <Moon />}
      </Button>
    </div>}
  </header>;
}
