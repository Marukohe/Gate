import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Checkout, Project } from '../../../../server/src/workbench/types';
import type { WorkbenchActions } from './use-workbench';
import { selectClass } from './ProjectForm';

export function ProjectSettings({ project, checkouts, mutate, busy }: WorkbenchActions & {
  project: Project; checkouts: Checkout[];
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError('');
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await mutate(`/projects/${project.id}`, 'PATCH', {
        name: data.name, defaultProvider: data.provider, defaultBranch: data.branch,
        defaultIsolation: data.isolation, defaultCheckoutId: data.checkout || null,
        scripts: Object.fromEntries(['setup', 'run', 'test'].filter((name) => String(data[name]).trim())
          .map((name) => [name, data[name]])),
      });
      setOpen(false);
    } catch (err) { setError((err as Error).message); }
  }
  return <section className="space-y-3">
    <Button variant="outline" size="sm" onClick={() => setOpen(!open)} aria-expanded={open}>Project settings</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle>Project settings</DialogTitle><DialogDescription>Defaults for new tasks and project scripts.</DialogDescription></DialogHeader>
        <form onSubmit={save} className="space-y-4">
      <label className="block text-sm">Project name<Input name="name" defaultValue={project.name} required /></label>
      <label className="block text-sm">Default working copy
        <select name="checkout" className={`${selectClass} mt-1 w-full`} defaultValue={project.defaultCheckoutId ?? ''}>
          <option value="">First registered working copy</option>
          {checkouts.map((item) => <option key={item.id} value={item.id}>{item.path}</option>)}
        </select>
      </label>
      <div className="flex flex-wrap gap-3 text-sm">
        <label>Default agent <select name="provider" className={selectClass} defaultValue={project.defaultProvider}>
          <option value="claude">Claude</option><option value="codex">Codex</option>
        </select></label>
        <label>Files <select name="isolation" className={selectClass} defaultValue={project.defaultIsolation}>
          <option value="worktree">Isolated worktree</option><option value="shared">Shared working copy</option>
        </select></label>
      </div>
      <label className="block text-sm">Review and PR base branch
        <Input name="branch" defaultValue={project.defaultBranch ?? ''} placeholder="main" /></label>
      <p className="text-xs text-muted-foreground">Existing tasks keep their agent and working copy. New isolated worktrees start from the selected working copy’s committed HEAD.</p>
      <h3 className="text-sm font-medium">Script overrides</h3>
      <p className="text-xs text-muted-foreground">Leave blank to use scripts from gate.json in each checkout. Commands run only when you start them from a task.</p>
      {(['setup', 'run', 'test'] as const).map((name) => <label key={name} className="block text-sm">{name}
        <Textarea name={name} aria-label={`${name} script override`} defaultValue={project.scripts[name] ?? ''} rows={2} />
      </label>)}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2"><Button disabled={busy}>Save project settings</Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </section>;
}
