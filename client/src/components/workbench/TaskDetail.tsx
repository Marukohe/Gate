import { useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Delivery, CodeSnapshot, CollaborationRecord, Attention, Verification, Checkout, Run, Task, TaskStatus } from '../../../../server/src/workbench/types';
import type { WorkbenchActions } from './use-workbench';
import { AttentionPanel } from './AttentionPanel';
import { CollaborationPanel } from './CollaborationPanel';
import { TaskResults } from './TaskResults';
import { DeliveryPanel } from './DeliveryPanel';
import { RunPanel } from './RunPanel';
import { selectClass } from './ProjectForm';

export const taskLabels: Record<TaskStatus, string> = {
  backlog: 'Backlog', 'in-progress': 'In progress', paused: 'Paused', review: 'Ready for review', done: 'Done', canceled: 'Canceled',
};

export function TaskDetail({ task, checkout, runs, attention, verifications, collaborations, deliveries, defaultBranch, externalSessions, checkoutBlocked,
  mutate, busy, onLegacySession }: WorkbenchActions & {
  externalSessions: ReactNode; checkoutBlocked: boolean;
  deliveries: Delivery[]; defaultBranch: string | null;
  task: Task; checkout: Checkout; runs: Run[]; attention: Attention[]; verifications: Verification[]; collaborations: CollaborationRecord[]; onLegacySession: (serverId: string, sessionId: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [current, setCurrent] = useState<CodeSnapshot | null>(null);
  const executionPanel = useRef<HTMLDivElement>(null);
  const resultsPanel = useRef<HTMLDivElement>(null);
  const deliveryPanel = useRef<HTMLDivElement>(null);
  const [executionFirst] = useState(() => !runs.length || runs.some((run) =>
    ['queued', 'starting', 'running', 'waiting', 'stopping'].includes(run.state)));
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
    <nav aria-label="Task sections" className="flex flex-wrap gap-2 lg:hidden">
      {([['Execution', executionPanel], ['Results', resultsPanel], ['Delivery', deliveryPanel]] as const).map(([label, panel]) =>
        <Button key={label} variant="outline" size="sm" onClick={() => {
          panel.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
        }}>{label}</Button>)}
    </nav>
    {error && <p role="alert" className="rounded-md bg-destructive/10 p-3 text-sm text-destructive">{error}</p>}
    <AttentionPanel items={attention} mutate={mutate} busy={busy} />
    {checkoutBlocked && externalSessions}
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
    <div className="grid items-start gap-5 lg:grid-cols-2">
      <div ref={executionPanel} className={`${executionFirst ? 'order-1' : 'order-2'} min-w-0 scroll-mt-4 lg:order-1`} aria-label="Task execution">
        <RunPanel task={task} checkout={checkout} runs={runs} checkoutBlocked={checkoutBlocked} mutate={mutate} busy={busy} />
      </div>
      <div className={`${executionFirst ? 'order-2' : 'order-1'} min-w-0 space-y-5 lg:order-2`}>
        <div ref={resultsPanel} className="scroll-mt-4" aria-label="Task results">
          <TaskResults task={task} runs={runs} verifications={verifications} onSnapshot={setCurrent} mutate={mutate} busy={busy} />
        </div>
        <CollaborationPanel task={task} runs={runs} records={collaborations} current={current} mutate={mutate} busy={busy} />
        <div ref={deliveryPanel} className="scroll-mt-4">
          <DeliveryPanel key={task.checkoutId} task={task} runs={runs} records={deliveries} defaultBranch={defaultBranch}
            checkoutBlocked={checkoutBlocked} mutate={mutate} busy={busy} />
        </div>
      </div>
    </div>
    {!checkoutBlocked && externalSessions}
    {task.legacySessionId && <Button variant="outline"
      onClick={() => onLegacySession(checkout.serverId, task.legacySessionId!)}>Open previous conversation</Button>}
    {task.prUrl && <a className="text-sm underline" href={task.prUrl} target="_blank" rel="noreferrer">Open pull request</a>}
  </div>;
}
