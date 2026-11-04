import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Checkout, Project, Task } from '../../../../server/src/workbench/types';
import type { WorkbenchActions } from './use-workbench';
import { selectClass } from './ProjectForm';

export function TaskForm({ project, checkouts, mutate, busy, onCreated }: WorkbenchActions & {
  project: Project; checkouts: Checkout[]; onCreated: (task: Task) => void;
}) {
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    setError('');
    try {
      const task = await mutate<Task>('/tasks', 'POST', { ...data, projectId: project.id,
        title: data.title || undefined });
      form.reset();
      onCreated(task);
    } catch (error) { setError((error as Error).message); }
  }
  return <form onSubmit={submit} className="space-y-3 rounded-xl border bg-card p-5">
    <h2 className="font-semibold">New task</h2>
    <Textarea name="goal" required aria-label="Task goal" placeholder="What should this task accomplish?" rows={3} />
    <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">Acceptance criteria and options</summary>
      <div className="mt-3 space-y-3">
        <Input name="title" aria-label="Task title" placeholder="Short title (optional)" maxLength={120} />
        <Textarea name="acceptance" aria-label="Acceptance criteria" placeholder="How will you know the work is done?" />
        <label className="block">Working copy
          <select key={project.defaultCheckoutId} className={`${selectClass} mt-1 w-full`} name="checkoutId"
            defaultValue={project.defaultCheckoutId ?? checkouts[0]?.id} required>
            {checkouts.map((checkout) => <option key={checkout.id} value={checkout.id}>{checkout.path}</option>)}
          </select>
        </label>
        <div className="flex flex-wrap gap-3">
          <label>Agent <select key={project.defaultProvider} name="provider" className={selectClass} defaultValue={project.defaultProvider}>
            <option value="claude">Claude</option><option value="codex">Codex</option>
          </select></label>
          <label>Files <select key={project.defaultIsolation} name="isolation" className={selectClass} defaultValue={project.defaultIsolation}>
            <option value="worktree">Isolated worktree</option><option value="shared">Shared working copy</option>
          </select></label>
        </div>
      </div>
    </details>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button disabled={busy || !checkouts.length} type="submit">Create task</Button>
  </form>;
}
