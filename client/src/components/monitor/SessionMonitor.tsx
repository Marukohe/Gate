import { useId, useState, type FormEvent } from 'react';
import { Activity, Archive, CircleAlert, Filter, ChevronRight, Plus, Search, Server as ServerIcon, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useServerStore } from '@/stores/server-store';
import { post } from '@/lib/api';
import type { Session } from '../../../../server/src/types';
import { useMonitorStore } from '@/stores/monitor-store';

import { SessionFilters } from './SessionFilters';
import { labels } from '@/lib/session';
import { groupProjects, isPastSession, type ProjectGroup } from '@/lib/project-groups';
function age(time: number) {
  const seconds = Math.max(0, Math.floor((Date.now() - time) / 1000));
  return seconds < 60 ? 'Just now' : seconds < 3600 ? `${Math.floor(seconds / 60)}m ago`
    : seconds < 86400 ? `${Math.floor(seconds / 3600)}h ago` : `${Math.floor(seconds / 86400)}d ago`;
}
export type MonitorFilter = 'running' | 'waiting' | null;
export function SessionMonitor({ onOpen, onAddServer, onEditServer, statusFilter, onStatusFilter }: {
  onOpen: (serverId: string, sessionId: string, error?: string) => void; onAddServer: () => void; onEditServer: (id: string) => void;
  statusFilter: MonitorFilter; onStatusFilter: (filter: MonitorFilter) => void;
}) {
  const { servers, error, refresh } = useMonitorStore();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState<string | null>(null);
  const [filterServer, setFilterServer] = useState<string | null>(null);
  const sessions = servers?.flatMap((s) => s.sessions) ?? [];
  const search = query.trim().toLowerCase();
  const filtered = servers?.map((server) => ({ ...server, sessions: server.sessions.filter((session) =>
    (!statusFilter || (!error && session.state === statusFilter)) &&
    `${server.name} ${server.host} ${session.name} ${session.cwd} ${session.projectPath ?? ''} ${session.preview}`.toLowerCase().includes(search)) }))
    .filter((s) => statusFilter ? s.sessions.length || s.error : !search || s.sessions.length || `${s.name} ${s.host}`.toLowerCase().includes(search));
  return <main className="h-full overflow-y-auto bg-muted/20"><div className="mx-auto max-w-6xl space-y-7 px-4 py-6 sm:px-8 sm:py-9">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <h1 className="page-title">Sessions</h1>
      <div className="relative w-full sm:w-64"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input className="pl-9" aria-label="Search sessions" placeholder="Find a project or session…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
    </div>
    <div role="group" aria-label="Session summary" className="grid grid-cols-3 gap-2 sm:gap-3">
        {([
          { label: 'Needs you', count: sessions.filter((s) => s.state === 'waiting').length, tone: 'waiting', Icon: CircleAlert },
          { label: 'Running', count: sessions.filter((s) => s.state === 'running').length, tone: 'running', Icon: Activity },
          { label: 'Servers', count: servers?.length ?? 0, tone: 'unknown', Icon: ServerIcon },
        ] as const).map(({ label, count, tone, Icon }) => {
          const className = `monitor-summary monitor-${error || !servers ? 'unknown' : tone}`;
          const content = <><span className="flex items-center gap-1.5 text-xs font-semibold sm:text-sm"><Icon aria-hidden="true" className="hidden size-4 min-[380px]:block" />{label}</span>
            <span className="mt-2 block text-3xl font-semibold tracking-tight tabular-nums sm:text-4xl">{error || !servers ? '—' : count}</span></>;
          return tone === 'unknown' ? <div key={label} className={className}>{content}</div>
            : <button key={label} type="button" className={className} aria-label={label} aria-pressed={statusFilter === tone}
              title={statusFilter === tone ? 'Show all sessions' : `Show ${label.toLowerCase()} sessions`}
              onClick={() => onStatusFilter(statusFilter === tone ? null : tone)}>{content}</button>;
        })}
    </div>
    {error && <p role="alert" className="break-words text-sm text-destructive">Updates paused. {error} Retrying automatically.</p>}
    {!servers && !error && <p className="py-12 text-center text-sm text-muted-foreground">Connecting to your servers…</p>}
    {servers?.length === 0 && <div className="monitor-empty"><ServerIcon className="mx-auto mb-4 size-7 text-muted-foreground" />
      <h2 className="font-medium">Your servers. Your sessions.</h2><p className="mt-2 text-sm text-muted-foreground">Add a server to see your Codex sessions.</p>
      <Button className="mt-5" onClick={onAddServer}><Plus />Add server</Button></div>}
    {filtered?.map((server) => <section key={server.id} aria-label={`${server.name} sessions`} className="server-group">
      <div className="server-group-header"><ServerIcon className="size-4 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1"><h2 className="truncate text-sm font-semibold">{server.name}<span className="ml-2 font-normal text-muted-foreground">{server.sessions.length}</span></h2>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{server.username}@{server.host}</p></div>
        <Button variant="ghost" size="icon-sm" aria-label={`Filter sessions on ${server.name}`} title="Session filters"
          className={server.hasFilters ? 'text-primary bg-accent' : ''} onClick={() => setFilterServer(server.id)}><Filter /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${server.name}`} onClick={() => onEditServer(server.id)}><Settings2 /></Button>
        <Button variant="outline" size="sm" aria-label={`New session on ${server.name}`} onClick={() => setCreating(server.id)}><Plus /><span className="hidden min-[380px]:inline">Session</span></Button>
      </div>
      {server.error && <p role="alert" className="break-words border-b px-5 py-3 text-xs text-destructive">{server.error}</p>}
      {server.state === 'connecting' && <p className="px-5 py-4 text-sm text-muted-foreground">Connecting to Codex…</p>}
      {groupProjects(server.sessions).map((project) => <ProjectSessions key={project.path} project={project}
        searching={!!search || !!statusFilter} stale={!!error} onOpen={(id) => onOpen(server.id, id)} onArchive={async (session) => {
          await post(`/servers/${encodeURIComponent(server.id)}/sessions/${encodeURIComponent(session.id)}/archive`, { name: session.name, cwd: session.cwd });
          await refresh();
        }} />)}
      {!server.sessions.length && server.state === 'connected' && <p className="px-5 py-8 text-sm text-muted-foreground">{query ? 'No matching sessions.' : server.hasFilters ? 'No visible sessions. Check your session filters.' : 'No sessions yet. Start one here or in your terminal.'}</p>}
      {server.hasMore && <p className="px-5 py-3 text-xs text-muted-foreground">Showing the most recent sessions.</p>}
    </section>)}
    {servers && !error && (search || statusFilter) && !filtered?.length && <p role="status" className="py-12 text-center text-sm text-muted-foreground">
      {search ? 'No matching sessions.' : statusFilter === 'running' ? 'No sessions are running.' : 'No sessions need your attention.'}
    </p>}
  </div>
  <Dialog open={creating !== null} onOpenChange={(open) => { if (!open) setCreating(null); }}><DialogContent className="rounded-2xl">
    <DialogHeader><DialogTitle>New session</DialogTitle><DialogDescription>{servers?.find((s) => s.id === creating)?.name}</DialogDescription></DialogHeader>
    {creating && <NewSession serverId={creating} onCreated={(session, error) => { setCreating(null); onOpen(creating, session.id, error); }} />}
  </DialogContent></Dialog>
  {filterServer && <SessionFilters serverId={filterServer} serverName={servers?.find((s) => s.id === filterServer)?.name ?? 'Server'}
    onClose={() => setFilterServer(null)} onChanged={refresh} />}
  </main>;
}

function ProjectSessions({ project, searching, stale, onOpen, onArchive }: {
  project: ProjectGroup; searching: boolean; stale: boolean; onOpen: (id: string) => void; onArchive: (session: Session) => Promise<void>;
}) {
  const [view, setView] = useState<'active' | 'all' | 'collapsed'>('active');
  const sessionsId = useId();
  const past = project.sessions.filter(isPastSession);
  const visible = searching || view === 'all' ? project.sessions : view === 'collapsed' ? []
    : project.sessions.filter((session) => !isPastSession(session));
  const canCollapse = visible.length > 0 && (view === 'all' || past.length === 0);
  const waiting = project.sessions.filter((session) => session.state === 'waiting').length;
  const running = project.sessions.filter((session) => session.state === 'running').length;
  const errors = project.sessions.filter((session) => session.state === 'error').length;
  const summary = stale ? 'Status unavailable' : [waiting && `${waiting} need you`, errors && `${errors} error`, running && `${running} running`].filter(Boolean).join(' · ');
  return <div className="project-group" role="group" aria-label={`Project ${project.path || project.name}`}>
    <h3>
      <button type="button" className="project-heading" title={project.path || 'Directory unavailable'}
        disabled={searching} aria-controls={sessionsId}
        aria-expanded={visible.length > 0}
        aria-label={`${searching ? 'Matching sessions in' : canCollapse ? 'Collapse sessions in' : 'Show all sessions in'} ${project.name}${project.context ? ` (${project.context})` : ''}`}
        onClick={() => setView(canCollapse ? 'collapsed' : 'all')}>
        <span className="min-w-0 flex-1 truncate font-semibold">{project.name}
          {project.context && <span className="ml-2 font-normal text-muted-foreground">· {project.context}</span>}
        </span>
        <span className="max-w-[55%] truncate text-xs font-normal text-muted-foreground" title={summary}>
          {summary || `${project.sessions.length} ${project.sessions.length === 1 ? 'session' : 'sessions'}`}
        </span>
        <ChevronRight aria-hidden="true" className={`size-3.5 shrink-0 text-muted-foreground ${visible.length ? 'rotate-90' : ''}`} />
      </button>
    </h3>
    <div id={sessionsId}>
    {visible.map((session) => <SessionRow key={session.id} session={session} stale={stale} onOpen={onOpen} onArchive={onArchive} />)}
    </div>
  </div>;
}

function SessionRow({ session, stale, onOpen, onArchive }: {
  session: Session; stale: boolean; onOpen: (id: string) => void; onArchive: (session: Session) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function archive() {
    setBusy(true); setError('');
    try { await onArchive(session); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div>
    <div className="flex items-center">
      <button className="monitor-session min-w-0 flex-1" onClick={() => onOpen(session.id)}>
        <span className={`monitor-dot monitor-${stale ? 'unknown' : session.state}`} aria-hidden="true" />
        <p className="min-w-0 flex-1 truncate text-sm font-medium">{session.name}</p>
        <div className="shrink-0 text-right"><span className={`monitor-state monitor-${stale ? 'unknown' : session.state}`}>{stale ? 'Unknown' : labels[session.state]}</span>
          <p className="mt-1 text-[11px] text-muted-foreground"><time dateTime={new Date(session.updatedAt).toISOString()}>{age(session.updatedAt)}</time></p></div>
      </button>
      <Button variant="ghost" size="icon-sm" className="mr-2 shrink-0 text-muted-foreground" disabled={busy}
        aria-label={`Archive ${session.name}`} title="Archive in Gate" onClick={() => void archive()}><Archive /></Button>
    </div>
    {error && <p role="alert" className="px-4 pb-3 text-xs text-destructive">{error}</p>}
  </div>;
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
