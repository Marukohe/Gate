import { ArrowLeft, ArrowRight, PanelLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { SessionAttention } from './SessionAttention';
import type { SessionTarget } from '@/lib/attention';

export function AppHeader({ current, onOpen, onShowSidebar, sidebarOpen, sessionTitleRef, back, next }: {
  current: SessionTarget | null; onOpen: (serverId: string, threadId: string) => void;
  onShowSidebar: () => void; sidebarOpen: boolean;
  sessionTitleRef: (node: HTMLDivElement | null) => void;
  back?: { label: string; run: () => void }; next?: { count: number; run: () => void };
}) {
  return <header className="gate-header">
    {!sidebarOpen && <Button size="icon-sm" variant="ghost" aria-label="Open sidebar" title="Open sidebar"
      aria-controls="session-sidebar" aria-expanded={false} onClick={onShowSidebar}><PanelLeft /></Button>}
    {back && <Button size="icon-sm" variant="ghost" aria-label={back.label} title={back.label} onClick={back.run}><ArrowLeft /></Button>}
    <div ref={sessionTitleRef} className="min-w-0 flex-1">{!current && <span className="px-2 text-sm font-medium text-muted-foreground">Gate</span>}</div>
    {next && <Button size="icon-sm" variant="ghost" aria-label={`Next needs you · ${next.count}`} title={`Next needs you · ${next.count}`} onClick={next.run}><ArrowRight /></Button>}
    <SessionAttention current={current} onOpen={onOpen} />
  </header>;
}
