import { useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import type { CodeSnapshot, Run, Task, TaskResult, Verification } from '../../../../server/src/workbench/types';
import { workbenchRequest, type WorkbenchActions } from './use-workbench';
import { TaskScripts } from './TaskScripts';

export function TaskResults({ task, runs, verifications, onSnapshot, mutate, busy }: WorkbenchActions & {
  task: Task; runs: Run[]; verifications: Verification[]; onSnapshot: (value: CodeSnapshot) => void;
}) {
  const [result, setResult] = useState<TaskResult | null>(null);
  const [error, setError] = useState('');
  const [refreshing, setRefreshing] = useState(false);
  const [command, setCommand] = useState('');
  const request = useRef<string | null>(null);
  const active = runs.some((run) => ['queued', 'starting', 'running', 'waiting', 'stopping', 'lost'].includes(run.state) &&
    (run.kind !== 'review' || run.checkoutId === task.checkoutId));
  async function refresh() {
    setRefreshing(true); setError('');
    try {
      const next = await workbenchRequest<TaskResult>(`/tasks/${task.id}/result`);
      setResult(next); onSnapshot(next.snapshot);
    }
    catch (err) { setError((err as Error).message); }
    finally { setRefreshing(false); }
  }
  async function verify(event: FormEvent) {
    event.preventDefault(); setError('');
    request.current ??= crypto.randomUUID();
    try {
      await mutate(`/tasks/${task.id}/verify`, 'POST', { command, requestId: request.current });
      request.current = null;
    } catch (err) { setError((err as Error).message); }
  }
  const times = new Map(runs.map((run) => [run.id, run.createdAt]));
  const evidence = [...verifications].sort((a, b) => (times.get(b.runId) ?? 0) - (times.get(a.runId) ?? 0)).map((item) => {
    const matches = result && item.before && result.snapshot.tree === item.before.tree && result.snapshot.head === item.before.head;
    const changed = item.before && item.after && (item.before.tree !== item.after.tree || item.before.head !== item.after.head);
    return <article key={item.id} className="space-y-1 rounded-lg border p-3 text-xs">
      <p className="font-medium">{item.purpose ?? 'test'} · {item.state} · <code className="break-all">{item.command}</code></p>
      <p className="break-all text-muted-foreground">{item.cwd}</p>
      <p>{item.startedAt ? new Date(item.startedAt).toLocaleString() : 'Queued'}
        {item.endedAt ? ` → ${new Date(item.endedAt).toLocaleString()}` : ''}</p>
      <p>Exit: {item.exitCode ?? 'not confirmed'}{item.signal ? ` · ${item.signal}` : ''}</p>
      {item.before && <p className="break-all text-muted-foreground">Code tree: {item.before.tree}</p>}
      {changed && <p className="text-amber-600">The checkout changed during verification.</p>}
      {item.before && <p className={matches ? 'text-emerald-600' : 'text-amber-600'}>{!result
        ? 'Refresh changes to compare this evidence with the current checkout.'
        : matches ? 'Matches the last captured checkout.' : 'Evidence belongs to a different code snapshot.'}</p>}
      <p className="text-muted-foreground">Full command output is in this run’s execution log.</p>
    </article>;
  });
  return <section className="space-y-4 rounded-xl border bg-card p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-medium">Results & verification</h2>
      <Button variant="outline" size="sm" disabled={refreshing} onClick={() => void refresh()}>
        {refreshing ? 'Reading checkout…' : 'Refresh changes'}</Button>
    </div>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {result && <div className="space-y-2 text-sm">
      <p className="text-xs text-muted-foreground">Captured {new Date(result.capturedAt).toLocaleString()}</p>
      <p className="break-all text-xs text-muted-foreground">HEAD {result.snapshot.head}<br />Tree {result.snapshot.tree}</p>
      <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words text-xs">{result.status || 'Working copy is clean.'}</pre>
      {result.diff && <details><summary className="cursor-pointer">Inspect changes</summary>
        <pre className="mt-2 max-h-96 overflow-auto whitespace-pre-wrap break-words rounded-md bg-muted p-3 text-xs">{result.diff}</pre>
        {result.truncated && <p className="text-xs text-amber-600">Diff preview is truncated. Inspect the full change in the repository.</p>}
      </details>}
    </div>}
    <form onSubmit={verify} className="space-y-2">
      <label className="block text-sm">Test command<Input aria-label="Test command" value={command} placeholder="npm test"
        required onChange={(event) => { setCommand(event.target.value); request.current = null; }} /></label>
      <p className="text-xs text-muted-foreground">Runs in this task’s checkout. Records the command, code snapshot, output, and exit status.</p>
      <Button variant="outline" disabled={busy || active || ['done', 'canceled'].includes(task.status)}>Run verification</Button>
      {active && <p className="text-xs text-muted-foreground">Wait for the current run to exit before verifying this checkout.</p>}
    </form>
    <TaskScripts key={task.checkoutId} task={task} active={active} mutate={mutate} busy={busy} />
    {evidence[0]}
    {evidence.length > 1 && <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">Earlier command records ({evidence.length - 1})</summary>
      <div className="mt-3 space-y-3">{evidence.slice(1)}</div>
    </details>}
    <p className="text-xs text-muted-foreground">Tests and agent completion do not accept the task. Review the results before marking it Done.</p>
  </section>;
}
