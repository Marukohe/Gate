import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Delivery, DeliveryInfo, DeliveryRequest, Run, Task } from '../../../../server/src/workbench/types';
import { workbenchRequest, type WorkbenchActions } from './use-workbench';

export function DeliveryPanel({ task, runs, records, defaultBranch, checkoutBlocked, mutate, busy }: WorkbenchActions & {
  task: Task; runs: Run[]; records: Delivery[]; defaultBranch: string | null; checkoutBlocked: boolean;
}) {
  const [preview, setPreview] = useState<DeliveryInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState(task.title);
  const [title, setTitle] = useState(task.title);
  const [body, setBody] = useState(task.goal + (task.acceptance ? `\n\nAcceptance criteria:\n${task.acceptance}` : ''));
  const [base, setBase] = useState(defaultBranch ?? 'main');
  const pending = useRef<{ content: string; id: string } | null>(null);
  const active = checkoutBlocked || runs.some((run) => ['queued', 'starting', 'running', 'waiting', 'stopping', 'lost'].includes(run.state) &&
    (run.kind !== 'review' || run.checkoutId === task.checkoutId));
  const disabled = busy || active || ['done', 'canceled'].includes(task.status);
  async function refresh() {
    setLoading(true); setError('');
    try { setPreview(await workbenchRequest<DeliveryInfo>(`/tasks/${task.id}/delivery`)); }
    catch (err) { setError((err as Error).message); }
    finally { setLoading(false); }
  }
  async function deliver(action: DeliveryRequest['action']) {
    if (!preview) return;
    setError('');
    const request: DeliveryRequest = { ...preview, action, ...(action === 'commit' ? { message } : {}),
      ...(action === 'create-pr' ? { title, body, base } : {}) };
    const content = JSON.stringify(request);
    if (pending.current?.content !== content) pending.current = { content, id: crypto.randomUUID() };
    try {
      await mutate(`/tasks/${task.id}/delivery`, 'POST', { requestId: pending.current.id, request });
      pending.current = null; setPreview(null);
    } catch (err) { setError((err as Error).message); }
  }
  const times = new Map(runs.map((run) => [run.id, run.createdAt]));
  const history = [...records].sort((a, b) => (times.get(b.runId) ?? 0) - (times.get(a.runId) ?? 0)).map((item) => <article key={item.id} className="space-y-1 rounded-lg border p-3 text-xs">
      <p className="font-medium">{item.request.action} · {item.state}</p>
      <p>{item.startedAt || item.endedAt ? new Date((item.startedAt ?? item.endedAt)!).toLocaleString() : 'Queued'}</p>
      {item.result && <><p className="break-all text-muted-foreground">Commit {item.result.commit}<br />Tree {item.result.tree}</p>
        {item.result.url && <a className="underline" href={item.result.url} target="_blank" rel="noreferrer">Open pull request</a>}</>}
      <p className="text-muted-foreground">{['failed', 'lost', 'interrupted'].includes(item.state)
        ? 'Inspect the execution log and repository before retrying; a command may have changed local or remote state.'
        : 'Command output is saved in the execution log.'}</p>
    </article>);
  return <section className="space-y-4 rounded-xl border bg-card p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium">Delivery</h2>
      <Button size="sm" variant="outline" disabled={loading} onClick={() => void refresh()}>
        {loading ? 'Reading branch…' : 'Refresh delivery preview'}</Button></div>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {preview && <div className="space-y-4">
      <div className="space-y-1 break-all text-xs">
        <p className="font-medium">{preview.branch || 'Detached HEAD'} · {preview.snapshot.dirty ? 'Uncommitted changes' : 'Clean working copy'}</p>
        <p className="text-muted-foreground">Commit {preview.snapshot.head}<br />Tree {preview.snapshot.tree}</p>
        <p>Origin: {preview.remote?.display ?? 'Not configured'}</p>
      </div>
      {preview.snapshot.dirty ? <div className="space-y-2">
        <label className="block text-sm">Commit message
          <Textarea aria-label="Commit message" value={message} onChange={(event) => setMessage(event.target.value)} rows={3} /></label>
        <p className="text-xs text-muted-foreground">Includes all tracked and non-ignored untracked changes shown in the current checkout. Inspect changes above first. Repository commit hooks still run.</p>
        <Button disabled={disabled || !preview.branch || !message.trim()} onClick={() => void deliver('commit')}>Commit inspected changes</Button>
      </div> : <div className="space-y-3">
        <p className="break-all text-xs text-muted-foreground">Push commit {preview.snapshot.head.slice(0, 12)} to origin, branch {preview.branch}.</p>
        <Button disabled={disabled || !preview.branch || !preview.remote} variant="outline" onClick={() => void deliver('push')}>Push inspected commit</Button>
        <details><summary className="cursor-pointer text-sm">Create draft pull request</summary>
          <div className="mt-3 space-y-3">
            <label className="block text-sm">PR title<Input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
            <label className="block text-sm">Base branch<Input value={base} onChange={(event) => setBase(event.target.value)} /></label>
            <label className="block text-sm">PR description<Textarea value={body} onChange={(event) => setBody(event.target.value)} rows={5} /></label>
            <p className="text-xs text-muted-foreground">Push first. Requires a github.com origin and authenticated GitHub CLI on this machine. An existing open PR for this branch and base is reused.</p>
            <Button disabled={disabled || !preview.remote || !preview.branch || !title.trim() || !base.trim()}
              onClick={() => void deliver('create-pr')}>Create draft PR</Button>
          </div>
        </details>
      </div>}
      {active && <p className="text-xs text-muted-foreground">Wait for the current checkout owner to finish before delivery.</p>}
    </div>}
    {history[0]}
    {history.length > 1 && <details className="text-sm">
      <summary className="cursor-pointer text-muted-foreground">Earlier delivery records ({history.length - 1})</summary>
      <div className="mt-3 space-y-3">{history.slice(1)}</div>
    </details>}
    <p className="text-xs text-muted-foreground">Delivery does not accept the task. Mark it Done after checking the change and acceptance criteria.</p>
  </section>;
}
