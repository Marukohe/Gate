import { useEffect, useId, useState, type FormEvent } from 'react';
import { ArrowUpRight, ChevronRight, Plus, Search, Server as ServerIcon, Settings2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useServerStore } from '@/stores/server-store';
import { api, post } from '@/lib/api';
import type { MonitorServer, Session } from '../../../../server/src/types';

import { labels } from '@/lib/session';
import { groupProjects, isPastSession, type ProjectGroup } from '@/lib/project-groups';
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
  const search = query.trim().toLowerCase();
  const filtered = servers?.map((server) => ({ ...server, sessions: server.sessions.filter((session) =>
    `${server.name} ${server.host} ${session.name} ${session.cwd} ${session.projectPath ?? ''} ${session.preview}`.toLowerCase().includes(search)) }))
    .filter((s) => !search || s.sessions.length || `${s.name} ${s.host}`.toLowerCase().includes(search));
  return <main className="h-full overflow-y-auto bg-muted/20"><div className="mx-auto max-w-6xl space-y-7 px-4 py-6 sm:px-8 sm:py-9">
    <div className="flex flex-wrap items-center justify-between gap-4">
      <div><h1 className="page-title">Sessions</h1><p className="mt-2 text-sm text-muted-foreground" role="status">
        {error ? 'Updates paused' : `${sessions.filter((s) => s.state === 'running').length} running · ${sessions.filter((s) => s.state === 'waiting').length} need you · ${servers?.length ?? 0} servers`}
      </p></div>
      <div className="relative w-full sm:w-64"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
        <Input className="pl-9" aria-label="Search sessions" placeholder="Find a project or session…" value={query} onChange={(e) => setQuery(e.target.value)} /></div>
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
      {groupProjects(server.sessions).map((project) => <ProjectSessions key={project.path} project={project}
        searching={!!search} stale={!!error} onOpen={(id) => onOpen(server.id, id)} />)}
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

function ProjectSessions({ project, searching, stale, onOpen }: {
  project: ProjectGroup; searching: boolean; stale: boolean; onOpen: (id: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const sessionsId = useId();
  const past = project.sessions.filter(isPastSession);
  const visible = searching || expanded ? project.sessions : project.sessions.filter((session) => !isPastSession(session));
  const waiting = project.sessions.filter((session) => session.state === 'waiting').length;
  const running = project.sessions.filter((session) => session.state === 'running').length;
  const errors = project.sessions.filter((session) => session.state === 'error').length;
  const summary = stale ? 'Status unavailable' : [waiting && `${waiting} need you`, errors && `${errors} error`, running && `${running} running`].filter(Boolean).join(' · ');
  return <div className="project-group" role="group" aria-label={`Project ${project.path || project.name}`}>
    <h3>
      <button type="button" className="project-heading" title={project.path || 'Directory unavailable'}
        disabled={searching || past.length === 0} aria-controls={sessionsId}
        aria-expanded={past.length ? searching || expanded : undefined}
        aria-label={`${searching ? 'Matching sessions in' : expanded ? 'Show active sessions in' : 'Show all sessions in'} ${project.name}${project.context ? ` (${project.context})` : ''}`}
        onClick={() => setExpanded(!expanded)}>
        <span className="min-w-0 flex-1 truncate font-semibold">{project.name}
          {project.context && <span className="ml-2 font-normal text-muted-foreground">· {project.context}</span>}
        </span>
        <span className="max-w-[55%] truncate text-xs font-normal text-muted-foreground" title={summary}>
          {summary || `${project.sessions.length} ${project.sessions.length === 1 ? 'session' : 'sessions'}`}
        </span>
        {past.length > 0 && <ChevronRight aria-hidden="true" className={`size-3.5 shrink-0 text-muted-foreground ${searching || expanded ? 'rotate-90' : ''}`} />}
      </button>
    </h3>
    <div id={sessionsId}>
    {visible.map((session) => <button key={session.id} className="monitor-session" onClick={() => onOpen(session.id)}>
      <span className={`monitor-dot monitor-${stale ? 'unknown' : session.state}`} aria-hidden="true" />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{session.name}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground" title={session.preview}>{session.preview || session.cwd}</p></div>
      <div className="shrink-0 text-right"><span className={`monitor-state monitor-${stale ? 'unknown' : session.state}`}>{stale ? 'Unknown' : labels[session.state]}</span>
        <p className="mt-1 text-[11px] text-muted-foreground"><time dateTime={new Date(session.updatedAt).toISOString()}>{age(session.updatedAt)}</time></p></div>
      <ArrowUpRight className="hidden size-3.5 shrink-0 text-muted-foreground sm:block" />
    </button>)}
    </div>
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
