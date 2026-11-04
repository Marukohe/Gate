import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, FolderGit2, Plus, RefreshCw, Server, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useServerStore, type Server as Machine } from '@/stores/server-store';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { SessionsList } from './SessionsList';
import type { Task } from '../../../../server/src/workbench/types';
import { useWorkbench } from './use-workbench';
import { ProjectForm, selectClass } from './ProjectForm';
import { TaskForm } from './TaskForm';
import { TaskDetail, taskLabels } from './TaskDetail';
import { ExternalSessions } from './ExternalSessions';
import { ProjectSettings } from './ProjectSettings';

function readRoute() {
  const [kind, id] = window.location.hash.slice(1).split('/');
  return { kind: ['project', 'task', 'projects', 'sessions', 'machines'].includes(kind) ? kind : 'overview', id };
}

export function Workbench({ onNewSession, onEditServer, onAddServer, onLegacySession }: {
  onNewSession: (serverId: string) => void; onEditServer: (server: Machine) => void;
  onAddServer: () => void; onLegacySession: (serverId: string, sessionId: string) => void;
}) {
  const { snapshot, error, busy, refresh, mutate } = useWorkbench();
  const servers = useServerStore((state) => state.servers);
  const [route, setRoute] = useState(readRoute);
  const [addingProject, setAddingProject] = useState(false);
  const [addingCheckout, setAddingCheckout] = useState(false);
  const [newTaskProject, setNewTaskProject] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [projectFilter, setProjectFilter] = useState('');
  const [machineFilter, setMachineFilter] = useState('');
  useEffect(() => {
    const change = () => { setRoute(readRoute()); setAddingProject(false); setAddingCheckout(false); setNewTaskProject(null); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const navigate = (kind: string, id?: string) => { window.location.hash = id ? `${kind}/${id}` : kind; };
  const project = snapshot?.projects.find((p) => p.id === route.id && route.kind === 'project');
  const task = snapshot?.tasks.find((t) => t.id === route.id && route.kind === 'task');
  const checkout = snapshot?.checkouts.find((c) => c.id === task?.checkoutId);
  const visibleProjects = snapshot?.projects.filter((p) => !p.archivedAt) ?? [];
  const filteredTasks = (snapshot?.tasks ?? []).filter((task) =>
    (!query || `${task.title} ${task.goal}`.toLowerCase().includes(query.toLowerCase())) &&
    (!projectFilter || task.projectId === projectFilter) &&
    (!machineFilter || snapshot?.checkouts.find((c) => c.id === task.checkoutId)?.serverId === machineFilter));
  const activeRuns = snapshot?.runs.filter((run) => ['queued', 'starting', 'running', 'waiting', 'stopping'].includes(run.state)) ?? [];

  const needsAttention = filteredTasks.filter((task) => snapshot?.attention.some((item) => item.taskId === task.id &&
    ['pending', 'sending'].includes(item.state)));

  function taskList(tasks: Task[]) {
    return <div className="work-list">
      {tasks.map((task) => {
        const parent = snapshot?.projects.find((p) => p.id === task.projectId);
        const run = snapshot?.runs.find((r) => r.taskId === task.id);
        return <button key={task.id} onClick={() => navigate('task', task.id)}
          className="work-row">
          <span className={`task-dot task-dot-${task.status}`} aria-hidden="true" />
          <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{task.title}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{parent?.name} · {task.provider}
              {run ? ` · ${run.state}` : ''}</p>
            {snapshot?.attention.some((item) => item.taskId === task.id && ['pending', 'sending'].includes(item.state)) &&
              <p className="mt-1 text-xs text-amber-600">Needs your attention</p>}</div>
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
        </button>;
      })}
    </div>;
  }

  return <div className="flex h-full min-h-0 flex-col bg-muted/25">
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-7 px-4 py-7 sm:px-8 sm:py-10">
        {error && <div role="alert" className="flex items-center justify-between rounded-lg border border-destructive/30 p-3 text-sm">
          <span>{error}</span><Button variant="ghost" size="sm" onClick={() => void refresh()}><RefreshCw />Retry</Button></div>}
        {!snapshot && !error && <p className="text-sm text-muted-foreground">Loading workbench…</p>}
        {snapshot && <>
          {addingProject ? <ProjectForm servers={servers} mutate={mutate} busy={busy}
            onCancel={() => setAddingProject(false)} onCreated={(id) => { setAddingProject(false); navigate('project', id); }} />
            : task && checkout ? <>
              <Button variant="ghost" size="sm" onClick={() => navigate('overview')}><ArrowLeft />All tasks</Button>
              <TaskDetail key={task.id} task={task} checkout={checkout} runs={snapshot.runs.filter((r) => r.taskId === task.id)}
                attention={snapshot.attention.filter((item) => item.taskId === task.id)}
                collaborations={snapshot.collaborations.filter((item) => item.taskId === task.id)}
                deliveries={snapshot.deliveries.filter((item) => item.taskId === task.id)}
                defaultBranch={snapshot.projects.find((item) => item.id === task.projectId)?.defaultBranch ?? null}
                verifications={snapshot.verifications.filter((item) => item.taskId === task.id)}
                checkoutBlocked={snapshot.observedSessions.some((item) => item.checkoutId === checkout.id &&
                  item.state !== 'ended' && item.dismissedRevision !== item.revision)}
                externalSessions={<ExternalSessions checkouts={[checkout]}
                  sessions={snapshot.observedSessions.filter((item) => item.checkoutId === checkout.id)}
                  settings={snapshot.hookSettings} tasks={snapshot.tasks} configure mutate={mutate} busy={busy} />}
                mutate={mutate} busy={busy} onLegacySession={onLegacySession} />
            </> : project ? <>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><h1 className="text-2xl font-semibold">{project.name}</h1>
                  <p className="mt-1 text-sm text-muted-foreground">{project.remoteUrl || 'Local repository'}</p></div>
                <Button variant="outline" size="sm" onClick={() => setAddingCheckout(!addingCheckout)}><Plus />Working copy</Button>
              </div>
              {addingCheckout && <ProjectForm projectId={project.id} servers={servers} mutate={mutate} busy={busy}
                onCancel={() => setAddingCheckout(false)} onCreated={() => setAddingCheckout(false)} />}
              <div className="flex flex-wrap gap-2">{snapshot.checkouts.filter((c) => c.projectId === project.id).map((c) =>
                <div key={c.id} className="max-w-full rounded-lg border px-3 py-2 text-xs">
                  <span className="font-medium">{servers.find((s) => s.id === c.serverId)?.name ?? 'Machine'}</span>
                  <span className="ml-2 text-muted-foreground">{c.branch}</span><p className="mt-1 break-all text-muted-foreground">{c.path}</p>
                </div>)}</div>
              <ProjectSettings key={`settings-${project.id}`} project={project} checkouts={snapshot.checkouts.filter((c) => c.projectId === project.id)}
                mutate={mutate} busy={busy} />
              <Button onClick={() => setNewTaskProject(project.id)}><Plus />New task</Button>
              <ExternalSessions checkouts={snapshot.checkouts.filter((c) => c.projectId === project.id)}
                sessions={snapshot.observedSessions.filter((item) => snapshot.checkouts.some((c) => c.id === item.checkoutId && c.projectId === project.id))}
                settings={snapshot.hookSettings} tasks={snapshot.tasks} configure mutate={mutate} busy={busy} />
              <section className="space-y-3"><h2 className="font-medium">Tasks</h2>
                {snapshot.tasks.some((t) => t.projectId === project.id)
                  ? taskList(snapshot.tasks.filter((t) => t.projectId === project.id))
                  : <p className="text-sm text-muted-foreground">Create your first task above.</p>}</section>
            </> : route.kind === 'sessions' ? <SessionsList onOpen={onLegacySession} onCreate={onNewSession} />
            : route.kind === 'machines' ? <>
              <div className="flex flex-wrap items-end justify-between gap-4">
                <div><h1 className="page-title">Machines</h1><p className="page-description">Connect your development environments.</p></div>
                <Button onClick={onAddServer}><Plus />Add machine</Button>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">{servers.map((server) => <button key={server.id}
                className="project-tile" onClick={() => onEditServer(server)}>
                <Server className="size-5 text-muted-foreground" />
                <div className="min-w-0"><h2 className="truncate font-medium">{server.name}</h2>
                  <p className="mt-1 break-all text-xs text-muted-foreground">{server.username}@{server.host}:{server.port}</p></div>
                <span className="ml-auto text-xs text-muted-foreground">Edit</span>
              </button>)}</div>
              {!servers.length && <p className="py-10 text-center text-sm text-muted-foreground">Add a machine to connect over SSH.</p>}
            </> : route.kind === 'projects' ? <>
              <div className="flex items-center justify-between"><div><h1 className="page-title">Projects</h1><p className="page-description">Repositories and their working copies.</p></div>
                <Button onClick={() => setAddingProject(true)}><Plus />Add project</Button></div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{visibleProjects.map((project) =>
                <button key={project.id} onClick={() => navigate('project', project.id)}
                  className="project-tile flex-col items-start">
                  <FolderGit2 className="size-5 text-muted-foreground" />
                  <h2 className="font-semibold">{project.name}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{snapshot.tasks.filter((t) => t.projectId === project.id).length} tasks
                    {' · '}{snapshot.checkouts.filter((c) => c.projectId === project.id).length} working copies</p>
                </button>)}</div>
              {!visibleProjects.length && <p className="text-sm text-muted-foreground">Add a repository from one of your machines to get started.</p>}
            </> : route.kind === 'task' || route.kind === 'project' ? <p role="alert">This item is no longer available.</p> : <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div><h1 className="page-title">Tasks</h1>
                  <p className="page-description">{activeRuns.length} active {activeRuns.length === 1 ? 'run' : 'runs'} across {visibleProjects.length} {visibleProjects.length === 1 ? 'project' : 'projects'}</p>
                </div><Button onClick={() => visibleProjects.length ? setNewTaskProject(projectFilter || visibleProjects[0].id) : setAddingProject(true)}><Plus />New task</Button>
              </div>
              <div className="flex flex-wrap gap-2">
                <div className="relative w-full sm:w-64"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" />
                  <Input aria-label="Search tasks" placeholder="Search tasks…" className="pl-9" value={query}
                    onChange={(event) => setQuery(event.target.value)} /></div>
                <select aria-label="Filter by project" className={selectClass} value={projectFilter}
                  onChange={(event) => setProjectFilter(event.target.value)}><option value="">All projects</option>
                  {visibleProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}</select>
                <select aria-label="Filter by machine" className={selectClass} value={machineFilter}
                  onChange={(event) => setMachineFilter(event.target.value)}><option value="">All machines</option>
                  {servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}</select>
              </div>
              {!snapshot.tasks.length && <div className="rounded-xl border border-dashed px-5 py-12 text-center">
                <FolderGit2 className="mx-auto mb-3 size-7 text-muted-foreground" /><h2 className="font-medium">A place for every task</h2>
                <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">Connect a repository, describe a goal, and keep each piece of work together.</p>
                <Button className="mt-5" onClick={() => visibleProjects.length ? setNewTaskProject(visibleProjects[0].id) : setAddingProject(true)}>
                  {visibleProjects.length ? 'New task' : 'Add your first project'}</Button>
              </div>}
              {needsAttention.length > 0 && <section className="space-y-3">
                <h2 className="font-medium text-amber-600">Needs attention <span className="ml-1">{needsAttention.length}</span></h2>
                {taskList(needsAttention)}
              </section>}
              <ExternalSessions checkouts={snapshot.checkouts} settings={snapshot.hookSettings} tasks={snapshot.tasks}
                sessions={snapshot.observedSessions.filter((item) => item.state !== 'ended' && item.dismissedRevision !== item.revision &&
                  (!machineFilter || snapshot.checkouts.find((c) => c.id === item.checkoutId)?.serverId === machineFilter) &&
                  (!projectFilter || snapshot.checkouts.find((c) => c.id === item.checkoutId)?.projectId === projectFilter))}
                mutate={mutate} busy={busy} />
              {(['review', 'in-progress', 'backlog', 'paused', 'done', 'canceled'] as const).map((status) => {
                const group = filteredTasks.filter((task) => task.status === status && !needsAttention.includes(task));
                return group.length > 0 && <section key={status} className="space-y-3">
                  <h2 className="text-sm font-medium">{taskLabels[status]} <span className="ml-1 text-muted-foreground">{group.length}</span></h2>
                  {taskList(group)}</section>;
              })}
              {!!snapshot.tasks.length && !filteredTasks.length && <p className="text-sm text-muted-foreground">No tasks match these filters.</p>}
            </>}
        </>}
      </div>
    </main>
    <Dialog open={newTaskProject !== null} onOpenChange={(open) => { if (!open) setNewTaskProject(null); }}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-2xl sm:max-w-xl">
        <DialogHeader><DialogTitle>New task</DialogTitle><DialogDescription>Choose a project and describe the work.</DialogDescription></DialogHeader>
        <label className="text-sm">Project
          <select aria-label="Task project" className={`${selectClass} mt-2 w-full`} value={newTaskProject ?? ''}
            onChange={(event) => setNewTaskProject(event.target.value)}>
            {visibleProjects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
          </select>
        </label>
        {snapshot && snapshot.projects.filter((project) => project.id === newTaskProject).map((project) =>
          <TaskForm key={project.id} project={project} checkouts={snapshot.checkouts.filter((item) => item.projectId === project.id)}
            mutate={mutate} busy={busy} onCreated={(task) => { setNewTaskProject(null); navigate('task', task.id); }} />)}
      </DialogContent>
    </Dialog>
  </div>;
}
