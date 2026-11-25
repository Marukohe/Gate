import { useId, useState, type FormEvent } from 'react';
import { Archive, Filter, ChevronRight, Plus, Search, Server as ServerIcon, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useServerStore } from '@/stores/server-store';
import { post } from '@/lib/api';
import type { MonitorServer, Session } from '../../../../server/src/types';
import { useMonitorStore } from '@/stores/monitor-store';
import { sessionKey } from '@/stores/session-view-store';
import { groupServers, toolName, type ServerSession } from '@/lib/server-groups';
import { ToolConnectionSelect } from '@/components/server/ToolConnectionSelect';
import { ToolTag } from './ToolTag';

import { SessionFilters } from './SessionFilters';
import { labels } from '@/lib/session';
import type { SessionTarget } from '@/lib/attention';
import { groupProjects, isPastSession, type ProjectGroup } from '@/lib/project-groups';
export type MonitorFilter = 'running' | 'waiting' | null;
export function SessionMonitor({ current, onOpen, onEditServer, statusFilter, onStatusFilter }: {
  onOpen: (serverId: string, sessionId: string, error?: string) => void; onEditServer: (id: string) => void;
  current: SessionTarget | null; statusFilter: MonitorFilter; onStatusFilter: (filter: MonitorFilter) => void;
}) {
  const { servers, error, refresh } = useMonitorStore();
  const [query, setQuery] = useState('');
  const [creating, setCreating] = useState<string | null>(null);
  const [filterServer, setFilterServer] = useState<string | null>(null);
  const groups = groupServers(servers ?? []);
  const sessions = groups.flatMap((s) => s.sessions);
  const creatingServer = groups.find((s) => s.key === creating);
  const filteringServer = groups.find((s) => s.key === filterServer);
  const search = query.trim().toLowerCase();
  const filtered = groups.map((server) => ({ ...server, sessions: server.sessions.filter((session) =>
    (!statusFilter || (!error && session.state === statusFilter)) &&
    `${server.name} ${server.host} ${session.toolName} ${session.username} ${session.name} ${session.cwd} ${session.projectPath ?? ''} ${session.preview}`.toLowerCase().includes(search)) }))
    .filter((s) => statusFilter ? s.sessions.length || s.connections.some((c) => c.error) : !search || s.sessions.length || `${s.name} ${s.host}`.toLowerCase().includes(search));
  return <div className="session-monitor">
    <div className="sidebar-controls">
      <div className="relative"><Search className="absolute left-2.5 top-2.5 size-3.5 text-muted-foreground" />
        <Input className="h-9 bg-background/70 pl-8 text-sm" aria-label="Search sessions" placeholder="Find a session…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
      <div role="group" aria-label="Session summary" className="mt-2 grid grid-cols-3 gap-1.5">
        {([
          { label: 'Needs you', count: sessions.filter((s) => s.state === 'waiting').length, tone: 'waiting' },
          { label: 'Running', count: sessions.filter((s) => s.state === 'running').length, tone: 'running' },
          { label: 'Servers', count: groups.length, tone: 'unknown' },
        ] as const).map(({ label, count, tone }) => {
          const className = `monitor-summary monitor-${error || !servers ? 'unknown' : tone}`;
          const content = <><span>{label}</span><span className="font-semibold tabular-nums">{error || !servers ? '—' : count}</span></>;
          return tone === 'unknown' ? <div key={label} className={className}>{content}</div>
            : <button key={label} className={className} aria-label={label} aria-pressed={statusFilter === tone} onClick={() => onStatusFilter(statusFilter === tone ? null : tone)}>{content}</button>;
        })}
      </div>
    </div>
    <nav aria-label="Server sessions" className="sidebar-list">
    {error && <p role="alert" className="break-words text-sm text-destructive">Updates paused. {error} Retrying automatically.</p>}
    {!servers && !error && <p className="py-12 text-center text-sm text-muted-foreground">Connecting to your servers…</p>}
    {servers?.length === 0 && <div className="monitor-empty"><ServerIcon className="mx-auto mb-4 size-7 text-muted-foreground" />
      <h2 className="font-medium">Your servers. Your sessions.</h2><p className="mt-2 text-sm text-muted-foreground">Add a server below to see its sessions.</p></div>}
    {filtered.map((server) => <section key={server.key} aria-label={`${server.name} sessions`} className="server-group">
      <div className="server-group-header"><ServerIcon className="size-3.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0 flex-1" title={`${[...new Set(server.connections.map((c) => c.username))].join(', ')}@${server.host}:${server.port}`}><h2 className="truncate text-sm font-semibold">{server.name}<span className="ml-2 font-normal text-muted-foreground">{server.sessions.length}</span></h2></div>
        <Button variant="ghost" size="icon-sm" aria-label={`Filter sessions on ${server.name}`} title="Session filters"
          className={server.connections.some((c) => c.hasFilters) ? 'text-primary bg-accent' : ''} onClick={() => setFilterServer(server.key)}><Filter /></Button>
        <Button variant="ghost" size="icon-sm" aria-label={`Edit ${server.name}`} onClick={() => onEditServer(server.connections[0].id)}><Settings2 /></Button>
        <Button variant="ghost" size="icon-sm" title="New session" aria-label={`New session on ${server.name}`} onClick={() => setCreating(server.key)}><Plus /></Button>
      </div>
      {server.connections.map((connection) => connection.error
        ? <p key={connection.id} role="alert" className="break-words border-b px-5 py-3 text-xs text-destructive">{toolName(connection)} · {connection.error}</p>
        : connection.state === 'connecting' ? <p key={connection.id} className="px-5 py-3 text-xs text-muted-foreground">Connecting to {toolName(connection)}…</p> : null)}
      {groupProjects(server.sessions).map((project) => <ProjectSessions key={project.path} project={project}
        current={current} searching={!!search || !!statusFilter} stale={!!error} onOpen={(session) => onOpen(session.connectionId, session.id)} onArchive={async (session) => {
          await post(`/servers/${encodeURIComponent(session.connectionId)}/sessions/${encodeURIComponent(session.id)}/archive`, { name: session.name, cwd: session.cwd });
          await refresh();
        }} />)}
      {!server.sessions.length && server.connections.some((c) => c.state === 'connected') && <p className="px-5 py-8 text-sm text-muted-foreground">{search || statusFilter ? 'No matching sessions.' : server.connections.some((c) => c.hasFilters) ? 'No visible sessions. Check your session filters.' : 'No sessions yet. Start one here or in your terminal.'}</p>}
      {server.connections.some((c) => c.hasMore) && <p className="px-5 py-3 text-xs text-muted-foreground">Showing the most recent sessions.</p>}
    </section>)}
    {servers && !error && (search || statusFilter) && !filtered?.length && <p role="status" className="py-12 text-center text-sm text-muted-foreground">
      {search ? 'No matching sessions.' : statusFilter === 'running' ? 'No sessions are running.' : 'No sessions need your attention.'}
    </p>}
    </nav>
  <Dialog open={creating !== null} onOpenChange={(open) => { if (!open) setCreating(null); }}><DialogContent className="rounded-2xl">
    <DialogHeader><DialogTitle>New session</DialogTitle><DialogDescription>{creatingServer?.name}</DialogDescription></DialogHeader>
    {creatingServer && <NewSession key={creatingServer.key} connections={creatingServer.connections} onCreated={(id, session, error) => { setCreating(null); onOpen(id, session.id, error); }} />}
  </DialogContent></Dialog>
  {filteringServer && <SessionFilters connections={filteringServer.connections} serverName={filteringServer.name}
    onClose={() => setFilterServer(null)} onChanged={refresh} />}
  </div>;
}

function ProjectSessions({ project, current, searching, stale, onOpen, onArchive }: {
  project: ProjectGroup<ServerSession>; current: SessionTarget | null; searching: boolean; stale: boolean; onOpen: (session: ServerSession) => void; onArchive: (session: ServerSession) => Promise<void>;
}) {
  const [expandedOverride, setExpandedOverride] = useState<boolean | null>(null);
  const sessionsId = useId();
  // Expansion applies to the whole folder, including saved sessions arriving from another tool.
  const expanded = searching || (expandedOverride ?? project.sessions.some((session) =>
    !isPastSession(session) || (current?.serverId === session.connectionId && current.threadId === session.id)));
  const visible = expanded ? project.sessions : [];
  const waiting = project.sessions.filter((session) => session.state === 'waiting').length;
  const running = project.sessions.filter((session) => session.state === 'running').length;
  const errors = project.sessions.filter((session) => session.state === 'error').length;
  const summary = stale ? 'Status unavailable' : [waiting && `${waiting} need you`, errors && `${errors} error`, running && `${running} running`].filter(Boolean).join(' · ');
  return <div className="project-group" role="group" aria-label={`Project ${project.path || project.name}`}>
    <h3>
      <button type="button" className="project-heading" title={project.path || 'Directory unavailable'}
        disabled={searching} aria-controls={sessionsId}
        aria-expanded={expanded}
        aria-label={`${searching ? 'Matching sessions in' : expanded ? 'Collapse sessions in' : 'Show all sessions in'} ${project.name}${project.context ? ` (${project.context})` : ''}`}
        onClick={() => setExpandedOverride(!expanded)}>
        <span className="min-w-0 flex-1 truncate font-semibold">{project.name}
          {project.context && <span className="ml-2 text-xs font-normal text-muted-foreground">· {project.context}</span>}
        </span>
        <span className="max-w-[55%] truncate text-xs font-normal text-muted-foreground" title={summary}>
          {summary || `${project.sessions.length} ${project.sessions.length === 1 ? 'session' : 'sessions'}`}
        </span>
        <ChevronRight aria-hidden="true" className={`size-3.5 shrink-0 text-muted-foreground ${expanded ? 'rotate-90' : ''}`} />
      </button>
    </h3>
    <div id={sessionsId}>
    {visible.map((session) => <SessionRow key={sessionKey(session.connectionId, session.id)} session={session} selected={current?.serverId === session.connectionId && current.threadId === session.id} stale={stale} onOpen={onOpen} onArchive={onArchive} />)}
    </div>
  </div>;
}

function SessionRow({ session, selected, stale, onOpen, onArchive }: {
  session: ServerSession; selected: boolean; stale: boolean; onOpen: (session: ServerSession) => void; onArchive: (session: ServerSession) => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function archive() {
    setBusy(true); setError('');
    try { await onArchive(session); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <div>
    <div className="session-row" data-selected={selected}>
      <button aria-current={selected ? 'page' : undefined} title={`${session.name} · ${stale ? 'Unknown' : labels[session.state]}`} className="monitor-session min-w-0 flex-1" aria-label={`${session.name} ${stale ? 'Unknown' : labels[session.state]} · ${session.toolName}`} onClick={() => onOpen(session)}>
        <span className={`monitor-dot monitor-${stale ? 'unknown' : session.state}`} aria-hidden="true" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5"><span className="min-w-0 flex-1 truncate text-xs">{session.name}</span>
          <ToolTag name={session.toolName} title={[session.toolName, session.username, session.toolNote].filter(Boolean).join(' · ')} /></span>
      </button>
      <Button variant="ghost" size="icon-sm" className="session-archive shrink-0 text-muted-foreground" disabled={busy}
        aria-label={`Archive ${session.name}`} title="Archive in Gate" onClick={() => void archive()}><Archive /></Button>
    </div>
    {error && <p role="alert" className="px-4 pb-3 text-xs text-destructive">{error}</p>}
  </div>;
}

function NewSession({ connections, onCreated }: { connections: MonitorServer[]; onCreated: (id: string, session: Session, error?: string) => void }) {
  const [serverId, setServerId] = useState(connections.find((c) => c.state === 'connected')?.id ?? connections[0].id);
  const server = useServerStore((s) => s.servers.find((v) => v.id === serverId));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try { const result = await post<{ session: Session; error?: string }>(`/servers/${serverId}/sessions`, body); onCreated(serverId, result.session, result.error); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-4">
    {connections.length > 1 && <ToolConnectionSelect connections={connections} value={serverId} onChange={(id) => { setServerId(id); setError(''); }} disabled={busy} />}
    <label className="block space-y-2 text-sm">Working directory<Input key={serverId} name="cwd" required defaultValue={server?.defaultWorkingDir} placeholder="/home/me/project" /></label>
    <label className="block space-y-2 text-sm">First message<Textarea name="prompt" required autoFocus rows={4} placeholder="Describe the work…" /></label>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    <Button disabled={busy} className="w-full">{busy ? 'Starting…' : 'Start session'}</Button>
  </form>;
}
