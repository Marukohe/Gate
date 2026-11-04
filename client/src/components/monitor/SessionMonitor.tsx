import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUpRight, Plus, Search, Server as ServerIcon, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useServerStore } from '@/stores/server-store';
import { api, post } from '@/lib/api';
import type { MonitorServer, Session, SessionState } from '../../../../server/src/types';

import { labels } from '@/lib/session';
const rank: Record<SessionState, number> = { waiting: 0, error: 1, running: 2, idle: 3, unknown: 4, saved: 5 };
function age(time: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  return seconds < 60 ? 'Just now' : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago`
    : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`;
}
export function SessionMonitor({ onOpen, onAddServer, onEditServer }: {
  onOpen: (serverId: string, sessionId: string, error?: string) => void; onAddServer: () => void; onEditServer: (id: string) => void;
}) {
  const [servers, setServers] = useState<MonitorServer[] | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const result = await api<{ servers: MonitorServer[] }>('/monitor', { signal: controller.signal });
        if (!controller.signal.aborted) { setServers(result.servers); setError(''); }
      } catch (e) { if (!controller.signal.aborted) setError((e as Error).message); }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 3000); }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  const sessions = servers?.flatMap((s) => s.sessions) ?? [];
  const filtered = servers?.map((server) => ({ ...server, sessions: server.sessions.filter((session) =>
    `${server.name} ${server.host} ${session.name} ${session.cwd} ${session.preview}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => rank[a.state] - rank[b.state] || b.updatedAt - a.updatedAt) }))
    .filter((s) => !query || s.sessions.length || `${s.name} ${s.host}`.toLowerCase().includes(query.toLowerCase()));
  return <main className="h-full overflow-y-auto bg-muted/20"><div className="mx-auto max-w-6xl space-y-7 px-4 py-6 sm:px-8 sm:py-9">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="page-title">Sessions</h1><p className="mt-2 text-sm text-muted-foreground" role="status">
        {error ? 'Updates paused' : `${sessions.filter((s) => s.state === 'running').length} running · ${sessions.filter((s) => s.state === 'waiting').length} need you · ${servers?.length ?? 0} servers`}
      </p></div>
      <div className="relative w-full sm:w-64"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input className="pl-9" aria-label="Search sessions" placeholder="Find a server or session…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
    </div>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error} Retrying automatically.</p>}
    {!servers && !error && <p className="py-12 text-center text-sm text-muted-foreground">Connecting to your servers…</p>}
    {servers?.length === 0 && <div className="monitor-empty"><ServerIcon className="mx-auto mb-4 size-7 text-muted-foreground" />
      <h2 className="font-medium">Your servers. Your sessions.</h2><p className="mt-2 text-sm text-muted-foreground">Add a server to see your Codex sessions.</p>
      <Button className="mt-5" onClick={onAddServer}><Plus />Add server</Button></div>}
    {filtered?.map((server) => <section key={server.id} aria-label={`${server.name} sessions`} className="server-group">
      <div className="server-group-header"><ServerIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{server.name}<span className="ml-2 font-normal text-muted-foreground">{server.sessions.length}</span></h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{server.username}@{server.host}</p></div>
        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${server.name}`} onClick={() => onEditServer(server.id)}><Settings2 /></Button>
        <Button variant="outline" size="sm" aria-label={`New session on ${server.name}`} onClick={() => setCreating(server.id)}><Plus /><span className="hidden min-[380px]:inline">Session</span></Button>
      </div>
      {server.error && <p role="alert" className="break-words border-b px-5 py-3 text-xs text-destructive">{server.error}</p>}
      {server.state === 'connecting' && <p className="px-5 py-4 text-sm text-muted-foreground">Connecting to Codex…</p>}
      {server.sessions.map((session) => <button key={session.id} className="monitor-session" onClick={() => onOpen(server.id, session.id)}>
        <span className={`monitor-dot monitor-${error ? 'unknown' : session.state}`} aria-hidden="true" />
        <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{session.name}</p>
          <p className="mt-1 truncate text-xs text-muted-foreground" title={session.preview}>{session.preview || session.cwd}</p></div>
        <div className="shrink-0 text-right"><span className={`monitor-state monitor-${error ? 'unknown' : session.state}`}>{error ? 'Unknown' : labels[session.state]}</span>
          <p className="mt-1 text-[11px] text-muted-foreground"><time dateTime={new Date(session.updatedAt).toISOString()}>{age(session.updatedAt)}</time></p></div>
        <ArrowUpRight className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" />
      </button>)}
      {!server.sessions.length && server.state === 'connected' && <p className="px-5 py-8 text-sm text-muted-foreground">{query ? 'No matching sessions.' : 'No sessions yet. Start one here or in your terminal.'}</p>}
      {server.hasMore && <p className="px-5 py-3 text-xs text-muted-foreground">Showing the most recent sessions.</p>}
    </section>)}
    {servers && query && !filtered?.length && <p className="py-12 text-center text-sm text-muted-foreground">No matching sessions.</p>}
  </div>
  <Dialog open={creating !== null} onOpenChange={(open) => { if (!open) setCreating(null); }}><DialogContent className="rounded-2xl">
    <DialogHeader><DialogTitle>New session</DialogTitle><DialogDescription>{servers?.find((s) => s.id === creating)?.name}</DialogDescription></DialogHeader>
    {creating && <NewSession serverId={creating} onCreated={(session, error) => { setCreating(null); onOpen(creating, session.id, error); }} />}
  </DialogContent></Dialog></main>;
}
function NewSession({ serverId, onCreated }: { serverId: string; onCreated: (session: Session, error?: string) => void }) {
  const server = useServerStore((s) => s.servers.find((v) => v.id === serverId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try { const result = await post<{ session: Session; error?: string }>(`/servers/${serverId}/sessions`, body); onCreated(result.session, result.error); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-4">
    <label className="block space-y-2 text-sm">Working directory<Input name="cwd" required defaultValue={server?.defaultWorkingDir} placeholder="/home/me/project" /></label>
    <label className="block space-y-2 text-sm">What should Codex do?<Textarea name="prompt" required autoFocus rows={4} placeholder="Describe the work…" /></label>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    <Button disabled={busy} className="w-full">{busy ? 'Starting…' : 'Start session'}</Button>
  </form>;
}
