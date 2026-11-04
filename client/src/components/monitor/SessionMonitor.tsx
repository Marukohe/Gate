import { useEffect, useState, type FormEvent } from 'react';
import { ArrowUpRight, Plus, Search, Server as ServerIcon, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useServerStore } from '@/stores/server-store';
import { useSessionStore, type Session } from '@/stores/session-store';
import type { MonitoredSession, MonitorSnapshot, SessionState } from '../../../../server/src/monitor-types';
import { SessionDetails } from './SessionDetails';

const labels: Record<SessionState, string> = {
  running: 'Running', waiting: 'Needs you', idle: 'Idle', completed: 'Finished', failed: 'Failed', stopped: 'Stopped', unknown: 'Unknown',
};
function age(time: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  return seconds < 60 ? 'Just now' : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago`
    : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`;
}

export function SessionMonitor({ onOpen, onAddServer, onEditServer }: {
  onOpen: (serverId: string, sessionId: string) => void; onAddServer: () => void; onEditServer: (id: string) => void;
}) {
  const [snapshot, setSnapshot] = useState<MonitorSnapshot | null>(null);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState<string | null>(null);
  const [selected, setSelected] = useState<MonitoredSession | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch('/api/monitor', { signal: controller.signal });
        if (!response.ok) throw new Error('Unable to refresh session status.');
        const data: MonitorSnapshot = await response.json();
        if (!controller.signal.aborted) { setSnapshot(data); setError(''); }
      } catch (err) { if (!controller.signal.aborted) setError((err as Error).message); }
      finally { if (!controller.signal.aborted) timer = setTimeout(() => void refresh(), 3000); }
    }
    void refresh();
    return () => { controller.abort(); clearTimeout(timer); };
  }, []);
  const sessions = snapshot?.servers.flatMap((server) => server.sessions) ?? [];
  const running = sessions.filter((item) => item.state === 'running').length;
  const waiting = sessions.filter((item) => item.state === 'waiting' || item.state === 'failed').length;
  const filtered = snapshot?.servers.map((server) => ({ ...server, sessions: server.sessions.filter((session) =>
    `${server.name} ${server.host} ${session.name} ${session.provider} ${session.cwd ?? ''}`.toLowerCase().includes(query.toLowerCase())) }))
    .filter((server) => !query || server.sessions.length || `${server.name} ${server.host}`.toLowerCase().includes(query.toLowerCase()));
  const detail = sessions.find((item) => item.id === selected?.id) ?? selected;
  return <main className="h-full overflow-y-auto bg-muted/20">
    <div className="mx-auto max-w-6xl space-y-7 px-4 py-6 sm:px-8 sm:py-9">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div><h1 className="page-title">Sessions</h1>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground" role="status">
            {error ? 'Updates paused' : <><span>{running} running</span><span className={waiting ? 'text-amber-600 dark:text-amber-400' : ''}>
              {waiting} {waiting === 1 ? 'needs' : 'need'} you</span><span>{snapshot?.servers.length ?? 0} servers</span></>}
          </p>
        </div>
        <div className="relative w-full sm:w-64"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-9" aria-label="Search sessions" placeholder="Find a server or session…" value={query}
            onChange={(event) => setQuery(event.target.value)} /></div>
      </div>
      {error && <p role="alert" className="rounded-lg border border-amber-500/30 p-3 text-sm text-amber-700 dark:text-amber-400">
        {error} Showing the last update{snapshot ? ` from ${new Date(snapshot.capturedAt).toLocaleTimeString()}` : ''}; retrying automatically.</p>}
      {!snapshot && !error && <p className="py-12 text-center text-sm text-muted-foreground">Loading sessions…</p>}
      {snapshot && !snapshot.servers.length && <div className="monitor-empty">
        <ServerIcon className="mx-auto mb-4 size-7 text-muted-foreground" /><h2 className="font-medium">Your servers. Your sessions.</h2>
        <p className="mt-2 text-sm text-muted-foreground">Add a server to get started.</p>
        <Button className="mt-5" onClick={onAddServer}><Plus />Add server</Button>
      </div>}
      {filtered?.map((server) => <section key={server.id} aria-label={`${server.name} sessions`} className="server-group">
        <div className="server-group-header">
          <ServerIcon className="size-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{server.name}
            <span className="ml-2 font-normal text-muted-foreground">{server.sessions.length}</span></h2>
            <p className="mt-0.5 truncate text-xs text-muted-foreground">{server.username}@{server.host}</p></div>
          <Button variant="ghost" size="icon-sm" aria-label={`Edit ${server.name}`} onClick={() => onEditServer(server.id)}><Settings2 /></Button>
          <Button variant="outline" size="sm" aria-label={`New session on ${server.name}`} onClick={() => setCreating(server.id)}>
            <Plus /><span className="hidden min-[380px]:inline">Session</span>
          </Button>
        </div>
        {server.sessions.map((session) => <button key={session.id} className="monitor-session"
          onClick={() => session.source === 'chat' && session.sessionId ? onOpen(server.id, session.sessionId) : setSelected(session)}>
          <span className={`monitor-dot monitor-${error ? 'unknown' : session.state}`} aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1"><span className="truncate text-sm font-medium">{session.name}</span>
              <span className="text-xs text-muted-foreground">{session.provider}{session.source === 'external' ? ' · external' : ''}</span></div>
            <p className="mt-1 truncate text-xs text-muted-foreground" title={session.activity}>{session.activity || session.cwd || 'No activity yet'}</p>
          </div>
          <div className="shrink-0 text-right"><span className={`monitor-state monitor-${error ? 'unknown' : session.state}`}>
            {error ? 'Unconfirmed' : labels[session.state]}</span>
            <p className="mt-1 text-[11px] text-muted-foreground"><time dateTime={new Date(session.updatedAt).toISOString()}
              title={new Date(session.updatedAt).toLocaleString()}>{age(session.updatedAt)}</time></p></div>
          <ArrowUpRight className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" />
        </button>)}
        {!server.sessions.length && <p className="px-5 py-8 text-sm text-muted-foreground">
          {query ? 'No matching sessions.' : 'No sessions yet. Create one with + Session.'}</p>}
      </section>)}
      {snapshot && query && !filtered?.length && <p className="py-12 text-center text-sm text-muted-foreground">No matching servers or sessions.</p>}
    </div>
    <Dialog open={creating !== null} onOpenChange={(open) => { if (!open) setCreating(null); }}>
      <DialogContent className="rounded-2xl"><DialogHeader><DialogTitle>New session</DialogTitle>
        <DialogDescription>{snapshot?.servers.find((server) => server.id === creating)?.name}</DialogDescription></DialogHeader>
        {creating && <NewSession key={creating} serverId={creating} onCreated={(session) => {
          setCreating(null); onOpen(session.serverId, session.id);
        }} />}
      </DialogContent>
    </Dialog>
    <Dialog open={selected !== null} onOpenChange={(open) => { if (!open) setSelected(null); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-2xl sm:max-w-3xl">
        <DialogHeader><DialogTitle>{detail?.name}</DialogTitle><DialogDescription className="break-all">
          {detail?.provider} · {detail?.cwd}</DialogDescription></DialogHeader>
        {detail && <SessionDetails key={detail.id} session={detail} />}
      </DialogContent>
    </Dialog>
  </main>;
}

function NewSession({ serverId, onCreated }: { serverId: string; onCreated: (session: Session) => void }) {
  const server = useServerStore((state) => state.servers.find((item) => item.id === serverId));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      const response = await fetch(`/api/servers/${serverId}/sessions`, { method: 'POST',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
      const session = await response.json();
      if (!response.ok) throw new Error(session.error ?? 'Could not create session');
      useSessionStore.getState().addSession(serverId, session);
      onCreated(session);
    } catch (err) { setError((err as Error).message); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-4">
    <label className="block space-y-2 text-sm">Name<Input name="name" required placeholder="What are you working on?" autoFocus /></label>
    <label className="block space-y-2 text-sm">Directory<Input name="workingDir" aria-label="Directory" defaultValue={server?.defaultWorkingDir ?? ''}
      placeholder="/home/me/project" /><span className="text-xs text-muted-foreground">Leave empty to use the server’s home directory.</span></label>
    <label className="block space-y-2 text-sm">Agent<select name="provider" defaultValue="codex" className="h-9 w-full rounded-md border bg-background px-3">
      <option value="codex">Codex</option><option value="claude">Claude</option></select></label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={busy} className="w-full">{busy ? 'Creating…' : 'Create session'}</Button>
  </form>;
}
