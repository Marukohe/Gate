import { useEffect, useState } from 'react';
import { ServerDialog } from '@/components/server/ServerDialog';
import { AppHeader } from '@/components/layout/AppHeader';
import { SessionMonitor, type MonitorFilter } from '@/components/monitor/SessionMonitor';
import { SessionView } from '@/components/chat/SessionView';
import { useUIStore } from '@/stores/ui-store';
import { useServerStore, type Server } from '@/stores/server-store';
import { api } from '@/lib/api';
import { useMonitorStore } from '@/stores/monitor-store';

function route() {
  const parts = location.hash.slice(1).split('/');
  return parts[0] === 'session' && parts.length === 3 ? { serverId: decodeURIComponent(parts[1]), threadId: decodeURIComponent(parts[2]) } : null;
}
export default function App() {
  const [selected, setSelected] = useState(route);
  const [monitorFilter, setMonitorFilter] = useState<MonitorFilter>(null);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<Server | null>(null);
  const [error, setError] = useState('');
  const dark = useUIStore((s) => s.darkMode);
  const servers = useServerStore((s) => s.servers);
  const setServers = useServerStore((s) => s.setServers);
  useEffect(() => {
    const poll = () => { void useMonitorStore.getState().refresh(); };
    poll(); const timer = setInterval(poll, 3000);
    return () => clearInterval(timer);
  }, []);
  const refresh = () => api<Server[]>('/servers').then(setServers).catch((e) => setError(e.message));
  useEffect(() => { void api<Server[]>('/servers').then(setServers).catch((e) => setError(e.message)); }, [setServers]);
  useEffect(() => {
    const change = () => { setSelected(route()); setError(''); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', dark ? '#171717' : '#ffffff');
  }, [dark]);
  const open = (serverId: string, threadId: string, message = '') => {
    history.pushState(null, '', `#session/${encodeURIComponent(serverId)}/${encodeURIComponent(threadId)}`);
    setSelected({ serverId, threadId }); setError(message);
  };
  const add = () => { setEditing(null); setDialog(true); };
  return <div className="flex h-full min-h-0 flex-col">
    <AppHeader home={!selected} onHome={() => { location.hash = 'sessions'; }} onAddServer={add} />
    <div className="min-h-0 flex-1">
      {selected ? <SessionView key={`${selected.serverId}:${selected.threadId}`} {...selected} initialError={error}
        serverName={servers.find((s) => s.id === selected.serverId)?.name ?? 'Server'} />
        : <SessionMonitor statusFilter={monitorFilter} onStatusFilter={setMonitorFilter} onOpen={open} onAddServer={add} onEditServer={(id) => {
          setEditing(servers.find((s) => s.id === id) ?? null); setDialog(true);
        }} />}
    </div>
    <ServerDialog open={dialog} onOpenChange={setDialog} editServer={editing} onSaved={() => void refresh()} />
  </div>;
}
