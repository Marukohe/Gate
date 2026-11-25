import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { MessageSquare, Moon, PanelLeftClose, Plus, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ServerDialog } from '@/components/server/ServerDialog';
import { AppHeader } from '@/components/layout/AppHeader';
import { SessionMonitor, type MonitorFilter } from '@/components/monitor/SessionMonitor';
import { FileBrowser } from '@/components/files/FileBrowser';
import { SessionView } from '@/components/chat/SessionView';
import { useUIStore } from '@/stores/ui-store';
import { useServerStore, type Server } from '@/stores/server-store';
import { api } from '@/lib/api';
import { useMonitorStore } from '@/stores/monitor-store';
import { needsAttention, otherSessions, type SessionTarget } from '@/lib/attention';
import { groupServers } from '@/lib/server-groups';

const mobileQuery = matchMedia('(max-width: 767px)');
const compactQuery = matchMedia('(max-width: 1199px)');
const subscribeCompact = (callback: () => void) => {
  compactQuery.addEventListener('change', callback);
  return () => compactQuery.removeEventListener('change', callback);
};
const subscribeMobile = (callback: () => void) => {
  mobileQuery.addEventListener('change', callback);
  return () => mobileQuery.removeEventListener('change', callback);
};

function route() {
  const parts = location.hash.slice(1).split('/');
  return parts[0] === 'session' && parts.length === 3 ? { serverId: decodeURIComponent(parts[1]), threadId: decodeURIComponent(parts[2]) } : null;
}
export default function App() {
  const [selected, setSelected] = useState(route);
  const mobile = useSyncExternalStore(subscribeMobile, () => mobileQuery.matches);
  const compact = useSyncExternalStore(subscribeCompact, () => compactQuery.matches);
  const [filesOpen, setFilesOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(() => !route());
  const sidebarRef = useRef<HTMLElement>(null);
  const desktopOpen = useUIStore((s) => s.sidebarOpen);
  const setDesktopOpen = useUIStore((s) => s.setSidebarOpen);
  const toggleDark = useUIStore((s) => s.toggleDarkMode);
  const sidebarOpen = mobile ? mobileOpen : desktopOpen && !(selected && filesOpen && compact);
  const setSidebarOpen = (open: boolean) => {
    if (mobile) setMobileOpen(open); else setDesktopOpen(open);
  };
  const [monitorFilter, setMonitorFilter] = useState<MonitorFilter>(null);
  const [returnTo, setReturnTo] = useState<SessionTarget | null>(null);
  const [sessionTitleTarget, setSessionTitleTarget] = useState<HTMLDivElement | null>(null);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<Server | null>(null);
  const [error, setError] = useState('');
  const dark = useUIStore((s) => s.darkMode);
  const servers = useServerStore((s) => s.servers);
  const setServers = useServerStore((s) => s.setServers);
  const snapshot = useMonitorStore((state) => state.servers);
  const monitorError = useMonitorStore((state) => state.error);
  const groups = groupServers(snapshot ?? []);
  const selectedGroup = groups.find((group) => group.connections.some((connection) => connection.id === selected?.serverId));
  const editingGroup = groups.find((group) => group.connections.some((connection) => connection.id === editing?.id));
  const pending = monitorError ? [] : otherSessions(snapshot, selected).filter(({ session }) => needsAttention(session));
  const returnName = snapshot?.find((server) => server.id === returnTo?.serverId)?.sessions.find((session) => session.id === returnTo?.threadId)?.name ?? 'original session';
  useEffect(() => {
    const poll = () => { void useMonitorStore.getState().refresh(); };
    poll(); const timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, []);
  const refresh = () => api<Server[]>('/servers').then(setServers).catch((e) => setError(e.message));
  useEffect(() => { void api<Server[]>('/servers').then(setServers).catch((e) => setError(e.message)); }, [setServers]);
  useEffect(() => {
    const change = () => { const next = route(); setSelected(next); setMobileOpen(!next); if (mobileQuery.matches || !next) setFilesOpen(false); if (!next) setReturnTo(null); setError(''); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#171717' : '#ffffff');
  }, [dark]);
  const open = (serverId: string, threadId: string, message = '') => {
    history.pushState(null, '', `#session/${encodeURIComponent(serverId)}/${encodeURIComponent(threadId)}`);
    if (mobileQuery.matches) setFilesOpen(false);
    setSelected({ serverId, threadId }); setMobileOpen(false); setError(message);
    if (mobileQuery.matches) requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('button[aria-label="Open sidebar"]')?.focus());
  };
  const add = () => { setEditing(null); setDialog(true); };
  const attentionOpen = (serverId: string, threadId: string) => {
    if (selected && !returnTo) setReturnTo(selected);
    open(serverId, threadId);
  };
  const canReturn = selected && returnTo && (selected.serverId !== returnTo.serverId || selected.threadId !== returnTo.threadId);
  const showSidebar = () => {
    if (compact) setFilesOpen(false);
    setSidebarOpen(true);
    requestAnimationFrame(() => sidebarRef.current?.querySelector<HTMLButtonElement>('button')?.focus());
  };
  const closeSidebar = () => {
    setSidebarOpen(false);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('button[aria-label="Open sidebar"]')?.focus());
  };
  const closeFiles = () => {
    setFilesOpen(false);
    requestAnimationFrame(() => document.querySelector<HTMLButtonElement>('button[aria-label="Open files"]')?.focus());
  };
  return <div className="gate-shell" data-sidebar-open={sidebarOpen} data-files-open={!!selected && filesOpen}>
    {/* Keep the monitor and chat mounted when hiding a pane: drafts, scroll and tree state belong to the session. */}
    <aside id="session-sidebar" ref={sidebarRef} aria-label="Sessions" className="gate-sidebar" hidden={!sidebarOpen}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && !event.defaultPrevented && !(event.target as HTMLElement).closest('[role="dialog"]')) {
          event.preventDefault(); closeSidebar();
        }
      }}>
      <div className="sidebar-header">
        <div className="gate-brand"><span className="gate-mark" aria-hidden="true">g</span><span>Gate</span></div>
        <Button variant="ghost" size="icon-sm" aria-label="Close sidebar" title="Close sidebar" aria-controls="session-sidebar"
          aria-expanded={true} onClick={closeSidebar}><PanelLeftClose /></Button>
      </div>
      <SessionMonitor current={selected} statusFilter={monitorFilter} onStatusFilter={setMonitorFilter} onOpen={(...args) => { setReturnTo(null); open(...args); }}
        onEditServer={(id) => { setEditing(servers.find((s) => s.id === id) ?? null); setDialog(true); }} />
      <div className="sidebar-footer">
        <Button size="sm" variant="ghost" className="flex-1 justify-start" onClick={add}><Plus />Add server</Button>
        <Button variant="ghost" size="icon-sm" aria-label="Toggle theme" title="Toggle theme" onClick={toggleDark}>{dark ? <Sun /> : <Moon />}</Button>
      </div>
    </aside>
    <div className="gate-workspace">
      <AppHeader current={selected} onOpen={attentionOpen} onShowSidebar={showSidebar} sidebarOpen={!!sidebarOpen}
        filesOpen={filesOpen} onFiles={() => { if (filesOpen) closeFiles(); else { setMobileOpen(false); setFilesOpen(true); } }}
        sessionTitleRef={setSessionTitleTarget}
        back={canReturn && returnTo ? { label: `Return to ${returnName}`, run: () => { open(returnTo.serverId, returnTo.threadId); setReturnTo(null); } } : undefined}
        next={canReturn && pending[0] ? { count: pending.length, run: () => open(pending[0].serverId, pending[0].threadId) } : undefined} />
      <div className="min-h-0 flex-1">
        {selected ? <SessionView key={`${selected.serverId}:${selected.threadId}`} {...selected} initialError={error} visible={!mobile || (!sidebarOpen && !filesOpen)}
          serverName={selectedGroup?.name ?? servers.find((s) => s.id === selected.serverId)?.name ?? 'Server'} headerTarget={sessionTitleTarget} onHome={showSidebar} />
          : <main className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <MessageSquare className="mb-1 size-7 text-muted-foreground/50" />
            <h1 className="text-lg font-medium tracking-tight">Choose a session</h1>
            <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">Open a conversation from the sidebar, or start one on a server.</p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          </main>}
      </div>
    </div>
    {selected && <FileBrowser key={`${selected.serverId}:${selected.threadId}`} {...selected} open={filesOpen && (!mobile || !sidebarOpen)} onClose={closeFiles} />}
    <ServerDialog open={dialog} onOpenChange={setDialog} editServer={editing} connections={editingGroup?.connections}
      onSelectConnection={(id) => setEditing(servers.find((server) => server.id === id) ?? editing)} onSaved={() => void refresh()} />
  </div>;
}
