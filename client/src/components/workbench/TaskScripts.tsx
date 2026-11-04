import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import type { ScriptName, Task, TaskScripts as Scripts } from '../../../../server/src/workbench/types';
import { workbenchRequest, type WorkbenchActions } from './use-workbench';

export function TaskScripts({ task, active, mutate, busy }: WorkbenchActions & { task: Task; active: boolean }) {
  const [scripts, setScripts] = useState<Scripts | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<{ name: ScriptName; command: string; id: string } | null>(null);
  async function refresh() {
    setLoading(true); setError('');
    try { setScripts(await workbenchRequest<Scripts>(`/tasks/${task.id}/scripts`)); }
    catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }
  async function start(name: ScriptName, command: string) {
    setError('');
    if (request.current?.name !== name || request.current.command !== command) {
      request.current = { name, command, id: crypto.randomUUID() };
    }
    try {
      await mutate(`/tasks/${task.id}/scripts`, 'POST', { name, command, requestId: request.current.id });
      request.current = null;
    } catch (err) { setError((err as Error).message); }
  }
  return <div className="space-y-3 border-t pt-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">Project scripts</h3>
      <Button size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>
        {loading ? 'Reading scripts…' : 'Refresh scripts'}</Button></div>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {scripts?.warning && <p className="break-words text-xs text-amber-600">{scripts.warning}</p>}
    {scripts && !Object.keys(scripts.scripts).length && <p className="text-xs text-muted-foreground">Add setup, run, or test commands in project settings or gate.json.</p>}
    {scripts && (['setup', 'run', 'test'] as const).map((name) => {
      const script = scripts.scripts[name];
      return script && <div key={name} className="space-y-2 rounded-lg border p-3">
        <p className="text-xs font-medium">{name} <span className="text-muted-foreground">· {script.source === 'project' ? 'Project override' : 'gate.json'}</span></p>
        <pre className="whitespace-pre-wrap break-all text-xs">{script.command}</pre>
        <Button size="sm" variant="outline" disabled={active || busy || ['done', 'canceled'].includes(task.status)}
          onClick={() => void start(name, script.command)}>Run {name} script</Button>
      </div>;
    })}
    {scripts && <p className="text-xs text-muted-foreground">Runs in the task’s checkout with a saved command and exit status. Stop long-running scripts from their execution log. Setup and run records are not test evidence.</p>}
  </div>;
}
