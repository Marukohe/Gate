import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Checkout, Run, Task, TaskStatus } from '../../../../server/src/workbench/types';
import type { WorkbenchActions } from './use-workbench';
import { selectClass } from './ProjectForm';

export const taskLabels: Record<TaskStatus, string> = {
  backlog: 'Backlog', 'in-progress': 'In progress', paused: 'Paused', review: 'Ready for review', done: 'Done', canceled: 'Canceled',
};

export function TaskDetail({ task, checkout, runs, mutate, busy, onLegacySession }: WorkbenchActions & {
  task: Task; checkout: Checkout; runs: Run[]; onLegacySession: (serverId: string, sessionId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  async function update(values: Partial<Task>) {
    setError('');
    try { await mutate(`/tasks/${task.id}`, 'PATCH', values); setEditing(false); }
    catch (error) { setError((error as Error).message); }
  }
  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void update(Object.fromEntries(new FormData(event.currentTarget)));
  }
  return <div className="space-y-5">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0"><h1 className="break-words text-2xl font-semibold">{task.title}</h1>
        <p className="mt-1 break-all text-xs text-muted-foreground">{checkout.path} · {task.provider}</p></div>
      <select aria-label="Task status" className={selectClass} value={task.status} disabled={busy}
        onChange={(event) => void update({ status: event.target.value as TaskStatus })}>
        {Object.entries(taskLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select>
    </div>
    {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    <section className="rounded-xl border bg-card p-5">
      {editing ? <form onSubmit={save} className="space-y-3">
        <label className="block text-sm">Title<Input name="title" defaultValue={task.title} required /></label>
        <label className="block text-sm">Goal<Textarea aria-label="Goal" name="goal" defaultValue={task.goal} rows={4} required /></label>
        <label className="block text-sm">Acceptance criteria
          <Textarea aria-label="Acceptance criteria" name="acceptance" defaultValue={task.acceptance} rows={3} /></label>
        <div className="flex gap-2"><Button disabled={busy}>Save goal</Button>
          <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button></div>
      </form> : <>
        <div className="flex items-center justify-between"><h2 className="font-medium">Goal</h2>
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>Edit</Button></div>
        <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed">{task.goal}</p>
        <h3 className="mt-5 text-sm font-medium">Acceptance criteria</h3>
        <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{task.acceptance || 'No criteria added yet.'}</p>
      </>}
    </section>
    <section className="rounded-xl border bg-card p-5">
      <h2 className="font-medium">Execution history</h2>
      {runs.length ? <div className="mt-3 divide-y">{runs.map((run) => <div key={run.id} className="py-3 text-sm">
        <span className="font-medium">{run.provider} · {run.kind}</span>
        <span className="ml-3 text-muted-foreground">{run.state}</span>
        <p className="mt-1 text-xs text-muted-foreground">{new Date(run.createdAt).toLocaleString()}</p>
      </div>)}</div> : <p className="mt-3 text-sm text-muted-foreground">No executions yet.</p>}
      {task.legacySessionId && <Button className="mt-4" variant="outline"
        onClick={() => onLegacySession(checkout.serverId, task.legacySessionId!)}>Open previous conversation</Button>}
    </section>
    {task.prUrl && <a className="text-sm underline" href={task.prUrl} target="_blank" rel="noreferrer">Open pull request</a>}
  </div>;
}
