import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { Server } from '@/stores/server-store';
import type { Checkout, Project } from '../../../../server/src/workbench/types';
import type { WorkbenchActions } from './use-workbench';

export const selectClass = 'h-9 min-w-0 rounded-md border bg-background px-3 text-sm';

export function ProjectForm({ servers, projectId, mutate, busy, onCreated, onCancel }: WorkbenchActions & {
  servers: Server[]; projectId?: string; onCreated: (projectId: string) => void; onCancel: () => void;
}) {
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    setError('');
    try {
      if (projectId) {
        await mutate<Checkout>(`/projects/${projectId}/checkouts`, 'POST', data);
        onCreated(projectId);
      } else {
        const result = await mutate<{ project: Project }>('/projects', 'POST', data);
        onCreated(result.project.id);
      }
    } catch (error) { setError((error as Error).message); }
  }
  return <form onSubmit={submit} className="space-y-4 rounded-xl border bg-card p-5">
    <h2 className="font-semibold">{projectId ? 'Add working copy' : 'Add project'}</h2>
    {!projectId && <label className="block space-y-1 text-sm">Project name
      <Input name="name" required placeholder="My project" autoFocus />
    </label>}
    <label className="block space-y-1 text-sm">Machine
      <select className={`${selectClass} block w-full`} name="serverId" required defaultValue={servers[0]?.id ?? ''}>
        <option value="" disabled>Select a machine</option>
        {servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}
      </select>
    </label>
    <label className="block space-y-1 text-sm">Repository path
      <Input name="path" required placeholder="/home/me/projects/my-project" />
    </label>
    {!projectId && <label className="block space-y-1 text-sm">Default agent
      <select className={`${selectClass} block w-full`} name="defaultProvider"><option value="claude">Claude</option>
        <option value="codex">Codex</option></select>
    </label>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <div className="flex gap-2"><Button type="submit" disabled={busy || !servers.length}>
      {busy ? 'Checking repository…' : projectId ? 'Add working copy' : 'Add project'}
    </Button><Button type="button" variant="ghost" onClick={onCancel}>Cancel</Button></div>
  </form>;
}
