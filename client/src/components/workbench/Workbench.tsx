import { useEffect, useState } from 'react';
import { ArrowLeft, ArrowUpRight, FolderGit2, Moon, Plus, RefreshCw, Server, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useServerStore } from '@/stores/server-store';
import { useUIStore } from '@/stores/ui-store';
import type { Task } from '../../../../server/src/workbench/types';
import { useWorkbench } from './use-workbench';
import { ProjectForm, selectClass } from './ProjectForm';
import { TaskForm } from './TaskForm';
import { TaskDetail, taskLabels } from './TaskDetail';
import { ExternalSessions } from './ExternalSessions';
import { ProjectSettings } from './ProjectSettings';

function readRoute() {
  const [kind, id] = window.location.hash.slice(1).split('/');
  return { kind: ['project', 'task', 'projects'].includes(kind) ? kind : 'overview', id };
}

export function Workbench({ onLegacy, onAddServer, onLegacySession }: {
  onLegacy: () => void; onAddServer: () => void; onLegacySession: (serverId: string, sessionId: string) => void;
}) {
  const { snapshot, error, busy, refresh, mutate } = useWorkbench();
  const servers = useServerStore((state) => state.servers);
  const dark = useUIStore((state) => state.darkMode);
  const toggleDark = useUIStore((state) => state.toggleDarkMode);
  const [route, setRoute] = useState(readRoute);
  const [addingProject, setAddingProject] = useState(false);
  const [addingCheckout, setAddingCheckout] = useState(false);
  const [projectFilter, setProjectFilter] = useState('');
  const [machineFilter, setMachineFilter] = useState('');
  useEffect(() => {
    const change = () => { setRoute(readRoute()); setAddingProject(false); setAddingCheckout(false); };
    window.addEventListener('hashchange', change);
    return () => window.removeEventListener('hashchange', change);
  }, []);
  const navigate = (kind: string, id?: string) => { window.location.hash = id ? `${kind}/${id}` : kind; };
  const project = snapshot?.projects.find((p) => p.id === route.id && route.kind === 'project');
  const task = snapshot?.tasks.find((t) => t.id === route.id && route.kind === 'task');
  const checkout = snapshot?.checkouts.find((c) => c.id === task?.checkoutId);
  const visibleProjects = snapshot?.projects.filter((p) => !p.archivedAt) ?? [];
  const filteredTasks = (snapshot?.tasks ?? []).filter((task) =>
    (!projectFilter || task.projectId === projectFilter) &&
    (!machineFilter || snapshot?.checkouts.find((c) => c.id === task.checkoutId)?.serverId === machineFilter));
  const activeRuns = snapshot?.runs.filter((run) => ['queued', 'starting', 'running', 'waiting', 'stopping'].includes(run.state)) ?? [];

  const needsAttention = filteredTasks.filter((task) => snapshot?.attention.some((item) => item.taskId === task.id &&
    ['pending', 'sending'].includes(item.state)));

  function taskList(tasks: Task[]) {
    return <div className="divide-y overflow-hidden rounded-xl border bg-card">
      {tasks.map((task) => {
        const parent = snapshot?.projects.find((p) => p.id === task.projectId);
        const run = snapshot?.runs.find((r) => r.taskId === task.id);
        return <button key={task.id} onClick={() => navigate('task', task.id)}
          className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left transition-colors hover:bg-accent/50">
          <div className="min-w-0"><p className="truncate text-sm font-medium">{task.title}</p>
            <p className="mt-1 truncate text-xs text-muted-foreground">{parent?.name} · {task.provider}
              {run ? ` · ${run.state}` : ''}</p>
            {snapshot?.attention.some((item) => item.taskId === task.id && ['pending', 'sending'].includes(item.state)) &&
              <p className="mt-1 text-xs text-amber-600">Needs your attention</p>}</div>
          <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
        </button>;
      })}
    </div>;
  }

  return <div className="flex h-full min-h-0 flex-col bg-background">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-4 py-3 sm:flex-nowrap sm:px-7">
      <div className="flex items-center gap-2 sm:gap-5">
        <button onClick={() => navigate('overview')} className="text-lg font-semibold tracking-tight">Gate</button>
        <nav className="flex gap-1" aria-label="Workbench">
          <Button size="sm" variant={route.kind === 'overview' ? 'secondary' : 'ghost'} onClick={() => navigate('overview')}>Overview</Button>
          <Button size="sm" variant={route.kind === 'projects' || project ? 'secondary' : 'ghost'}
            onClick={() => navigate('projects')}>Projects</Button>
        </nav>
      </div>
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="icon-sm" title="Add machine" aria-label="Add machine" onClick={onAddServer}><Server /></Button>
        <Button variant="ghost" size="icon-sm" title="Toggle theme" aria-label="Toggle theme" onClick={toggleDark}>
          {dark ? <Sun /> : <Moon />}</Button>
        <Button variant="ghost" size="sm" onClick={onLegacy}>Sessions</Button>
      </div>
    </header>
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-6 px-4 py-6 sm:px-7 sm:py-9">
        {error && <div role="alert" className="flex items-center justify-between rounded-lg border border-destructive/30 p-3 text-sm">
          <span>{error}</span><Button variant="ghost" size="sm" onClick={() => void refresh()}><RefreshCw />Retry</Button></div>}
        {!snapshot && !error && <p className="text-sm text-muted-foreground">Loading workbench…</p>}
        {snapshot && <>
          {addingProject ? <ProjectForm servers={servers} mutate={mutate} busy={busy}
            onCancel={() => setAddingProject(false)} onCreated={(id) => { setAddingProject(false); navigate('project', id); }} />
            : task && checkout ? <>
              <Button variant="ghost" size="sm" onClick={() => navigate('project', task.projectId)}><ArrowLeft />
                {snapshot.projects.find((p) => p.id === task.projectId)?.name}</Button>
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
              <TaskForm key={`task-${project.id}`} project={project} checkouts={snapshot.checkouts.filter((c) => c.projectId === project.id)}
                mutate={mutate} busy={busy} onCreated={(task) => navigate('task', task.id)} />
              <ExternalSessions checkouts={snapshot.checkouts.filter((c) => c.projectId === project.id)}
                sessions={snapshot.observedSessions.filter((item) => snapshot.checkouts.some((c) => c.id === item.checkoutId && c.projectId === project.id))}
                settings={snapshot.hookSettings} tasks={snapshot.tasks} configure mutate={mutate} busy={busy} />
              <section className="space-y-3"><h2 className="font-medium">Tasks</h2>
                {snapshot.tasks.some((t) => t.projectId === project.id)
                  ? taskList(snapshot.tasks.filter((t) => t.projectId === project.id))
                  : <p className="text-sm text-muted-foreground">Create your first task above.</p>}</section>
            </> : route.kind === 'projects' ? <>
              <div className="flex items-center justify-between"><h1 className="text-2xl font-semibold">Projects</h1>
                <Button onClick={() => setAddingProject(true)}><Plus />Add project</Button></div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">{visibleProjects.map((project) =>
                <button key={project.id} onClick={() => navigate('project', project.id)}
                  className="rounded-xl border bg-card p-5 text-left transition-colors hover:border-foreground/30">
                  <FolderGit2 className="mb-4 size-5 text-muted-foreground" />
                  <h2 className="font-semibold">{project.name}</h2>
                  <p className="mt-2 text-sm text-muted-foreground">{snapshot.tasks.filter((t) => t.projectId === project.id).length} tasks
                    {' · '}{snapshot.checkouts.filter((c) => c.projectId === project.id).length} working copies</p>
                </button>)}</div>
              {!visibleProjects.length && <p className="text-sm text-muted-foreground">Add a repository from one of your machines to get started.</p>}
            </> : route.kind === 'task' || route.kind === 'project' ? <p role="alert">This item is no longer available.</p> : <>
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div><p className="text-xs font-medium uppercase tracking-widest text-muted-foreground">Your work</p>
                  <h1 className="mt-2 text-2xl font-semibold">Keep things moving.</h1>
                  <p className="mt-2 text-sm text-muted-foreground">{activeRuns.length} active runs across {visibleProjects.length} projects</p>
                </div><Button onClick={() => navigate('projects')}><Plus />New task</Button>
              </div>
              <div className="flex flex-wrap gap-2">
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
                <Button className="mt-5" onClick={() => visibleProjects.length ? navigate('projects') : setAddingProject(true)}>
                  {visibleProjects.length ? 'Choose a project' : 'Add your first project'}</Button>
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
  </div>;
}
