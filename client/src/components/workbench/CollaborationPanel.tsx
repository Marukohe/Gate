import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import type { CodeSnapshot, CollaborationRecord, Run, Task } from '../../../../server/src/workbench/types';
import type { WorkbenchActions } from './use-workbench';
import { selectClass } from './ProjectForm';

export function CollaborationPanel({ task, runs, records, current, mutate, busy }: WorkbenchActions & {
  task: Task; runs: Run[]; records: CollaborationRecord[]; current: CodeSnapshot | null;
}) {
  const sources = runs.filter((run) => ['completed', 'failed', 'interrupted'].includes(run.state) &&
    ['claude', 'codex'].includes(run.provider) && run.kind !== 'review');
  const [provider, setProvider] = useState(task.provider === 'codex' ? 'claude' : 'codex');
  const [sourceId, setSourceId] = useState('');
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState('');
  const request = useRef<{ signature: string; id: string } | null>(null);
  const writing = runs.some((run) => ['queued', 'starting', 'running', 'waiting', 'stopping', 'lost'].includes(run.state) &&
    (run.kind !== 'review' || run.checkoutId === task.checkoutId));
  const disabled = busy || writing || ['done', 'canceled'].includes(task.status);
  async function start(kind: 'handoff' | 'review') {
    setError('');
    const data = { kind, provider, instructions, ...(kind === 'handoff' ? { sourceRunId: sourceId || sources[0]?.id } : {}) };
    const signature = JSON.stringify(data);
    if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
    try {
      await mutate(`/tasks/${task.id}/collaborate`, 'POST', { ...data, requestId: request.current.id });
      request.current = null;
    } catch (err) { setError((err as Error).message); }
  }
  return <section className="space-y-4 rounded-xl border bg-card p-5">
    <h2 className="font-medium">Handoff & independent review</h2>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    <div className="flex flex-wrap gap-3">
      <label className="flex min-w-0 flex-col gap-1 text-sm">Next agent
        <select aria-label="Next agent" className={selectClass} value={provider} onChange={(event) => setProvider(event.target.value)}>
          <option value="claude">Claude</option><option value="codex">Codex</option>
        </select></label>
      {sources.length > 0 && <label className="flex min-w-0 flex-col gap-1 text-sm">Handoff from
        <select aria-label="Handoff from" className={selectClass} value={sourceId || sources[0].id}
          onChange={(event) => setSourceId(event.target.value)}>
          {sources.map((run) => <option key={run.id} value={run.id}>{run.provider} · {new Date(run.createdAt).toLocaleString()}</option>)}
        </select></label>}
    </div>
    <Textarea aria-label="Handoff or review instructions" placeholder="Optional focus, concerns, or next steps"
      rows={3} value={instructions} onChange={(event) => setInstructions(event.target.value)} />
    <div className="flex flex-wrap gap-2">
      <Button disabled={disabled || !sources.length} variant="outline" onClick={() => void start('handoff')}>Hand off task</Button>
      <Button disabled={disabled} variant="outline" onClick={() => void start('review')}>Review fixed snapshot</Button>
    </div>
    <p className="text-xs text-muted-foreground">Handoff starts a fresh conversation with the goal, previous results and test evidence.
      Review uses a separate checkout and a fresh conversation. Once its snapshot is ready, work can continue in the task checkout.</p>
    {writing && <p className="text-xs text-muted-foreground">Wait for the active writer to exit before handing off or capturing a review.</p>}
    {records.map((record) => <article key={record.id} className="space-y-2 rounded-lg border p-3 text-sm">
      <p className="font-medium">{record.kind === 'review' ? 'Independent review' : 'Handoff'} · {record.targetProvider} · {record.state}</p>
      {record.snapshot && <>
        <p className="break-all text-xs text-muted-foreground">Snapshot {record.snapshot.commit}<br />Tree {record.snapshot.tree}</p>
        {record.kind === 'review' && <p className="text-xs text-muted-foreground">{!current
          ? 'Refresh changes to compare this review with the current task code.'
          : current.tree === record.snapshot.tree ? 'Review matches the last captured task code.'
            : 'Task code has changed since this review snapshot.'}</p>}
      </>}
      {record.result && <div className="max-h-96 overflow-auto whitespace-pre-wrap break-words text-sm">{record.result}</div>}
      {record.packet && <details><summary className="cursor-pointer text-xs text-muted-foreground">Context sent to the agent</summary>
        <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs">{record.packet}</pre></details>}
      {record.kind === 'review' && record.state === 'completed' && <p className="text-xs text-muted-foreground">
        Review finished. Read the findings before accepting the task.</p>}
    </article>)}
  </section>;
}
