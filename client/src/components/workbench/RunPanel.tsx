import { lazy, Suspense, useEffect, useRef, useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import type { Checkout, Run, RunEvent, Task } from '../../../../server/src/workbench/types';
import { workbenchRequest, type WorkbenchActions } from './use-workbench';

const active = ['queued', 'starting', 'running', 'waiting', 'stopping'];
const TerminalView = lazy(() => import('./TerminalView'));

export function RunPanel({ task, checkout, runs, checkoutBlocked, mutate, busy }: WorkbenchActions & {
  task: Task; checkout: Checkout; runs: Run[]; checkoutBlocked: boolean;
}) {
  const [error, setError] = useState('');
  const [settings, setSettings] = useState<Record<string, string> | null>(null);
  const [configOpen, setConfigOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [prompt, setPrompt] = useState('');
  const [terminalProvider, setTerminalProvider] = useState('shell');
  const requestId = useRef<string | null>(null);
  const terminalRequestId = useRef<string | null>(null);
  const pending = (checkoutBlocked && (task.isolation === 'shared' || checkout.kind === 'worktree')) ||
    runs.some((run) => (active.includes(run.state) || run.state === 'lost') &&
    (run.kind !== 'review' || run.checkoutId === task.checkoutId));
  const closedTask = ['done', 'canceled'].includes(task.status);
  useEffect(() => {
    let disposed = false;
    void workbenchRequest<Record<string, string> | null>(`/machines/${checkout.serverId}/runtime`).then((value) => {
      if (!disposed) { setSettings(value); setLoaded(true); }
    }).catch((err) => { if (!disposed) setError(err.message); });
    return () => { disposed = true; };
  }, [checkout.serverId]);

  async function setup(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    const values = Object.fromEntries(new FormData(event.currentTarget)) as Record<string, string>;
    try { setSettings(await mutate(`/machines/${checkout.serverId}/runtime`, 'PUT', values)); setConfigOpen(false); }
    catch (err) { setError((err as Error).message); }
  }
  async function start() {
    setError('');
    requestId.current ??= crypto.randomUUID();
    try {
      await mutate(`/tasks/${task.id}/runs`, 'POST', { requestId: requestId.current, ...(prompt.trim() ? { prompt } : {}) });
      requestId.current = null;
      setPrompt('');
    } catch (err) { setError((err as Error).message); }
  }
  async function startTerminal() {
    setError(''); terminalRequestId.current ??= crypto.randomUUID();
    try {
      await mutate(`/tasks/${task.id}/terminal`, 'POST', { requestId: terminalRequestId.current, provider: terminalProvider });
      terminalRequestId.current = null;
    } catch (err) { setError((err as Error).message); }
  }
  return <section className="space-y-4 rounded-xl border bg-card p-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="font-medium">Execution</h2>
      {loaded && <Button variant="ghost" size="sm" onClick={() => setConfigOpen(true)}>
        {settings ? 'Runtime settings' : 'Set up machine'}</Button>}
    </div>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    <Dialog open={configOpen} onOpenChange={setConfigOpen}>
      <DialogContent className="max-h-[85dvh] overflow-y-auto rounded-2xl">
        <DialogHeader><DialogTitle>Machine runtime</DialogTitle>
          <DialogDescription>Executable paths on the remote machine.</DialogDescription></DialogHeader>
      <form onSubmit={setup} className="mt-3 space-y-3">
        <p className="text-xs text-muted-foreground">Use absolute paths on the remote machine. Setup installs Gate’s runtime via SSH.</p>
        {[
          ['nodePath', 'Node.js executable', '/usr/bin/node'], ['claudePath', 'Claude executable', '/usr/local/bin/claude'],
          ['codexPath', 'Codex executable', '/usr/local/bin/codex'], ['directory', 'Runtime data directory', '/home/user/.gate-runtime'],
        ].map(([key, label, placeholder]) => <label className="block text-sm" key={key}>{label}
          <Input name={key} aria-label={label} defaultValue={settings?.[key] ?? ''} placeholder={placeholder} required />
        </label>)}
        <div>
          <label className="mt-2 block text-sm">Python 3.9+<Input name="pythonPath" defaultValue={settings?.pythonPath ?? '/usr/bin/python3'} /></label>
          <label className="mt-2 block text-sm">Interactive shell<Input name="shellPath" defaultValue={settings?.shellPath ?? '/bin/bash'} /></label>
        </div>
        <div>
          <label className="mt-2 block text-sm">GitHub CLI executable
            <Input name="ghPath" defaultValue={settings?.ghPath ?? ''} placeholder="Optional absolute path; otherwise gh from SSH PATH" /></label>
        </div>
        {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
        <Button disabled={busy} variant="outline">Install / reconnect runtime</Button>
      </form>
      </DialogContent>
    </Dialog>
    {loaded && !settings && <p className="text-sm text-muted-foreground">Set up this machine to start your first run.</p>}
    {settings && !pending && <div className="space-y-3">
      <Textarea aria-label="Run instructions" placeholder="Add instructions, or start with the task goal…"
        value={prompt} onChange={(event) => { setPrompt(event.target.value); requestId.current = null; }} rows={3} />
      <p className="text-xs text-muted-foreground">{task.isolation === 'worktree'
        ? 'Runs use a task worktree created from the repository’s committed HEAD.'
        : 'This run will lock the shared checkout until its exit is confirmed.'}</p>
      <Button disabled={busy || closedTask} onClick={() => void start()}>{runs.length ? 'Start another run' : 'Start task'}</Button>
      {closedTask && <p className="text-xs text-muted-foreground">Reopen the task before starting another execution.</p>}
      <div className="flex flex-wrap items-center gap-2 border-t pt-3">
        <select aria-label="Terminal program" className="rounded border bg-background px-2 py-2 text-sm" value={terminalProvider}
          onChange={(event) => { setTerminalProvider(event.target.value); terminalRequestId.current = null; }}>
          <option value="shell">Shell</option><option value="claude">Claude CLI</option><option value="codex">Codex CLI</option>
        </select>
        <Button disabled={busy || closedTask} variant="outline" onClick={() => void startTerminal()}>Open managed terminal</Button>
      </div>
      <p className="text-xs text-muted-foreground">A persistent native terminal with live input and resize. Approvals stay inside the terminal.</p>
    </div>}
    {runs.map((run) => <RunOutput key={run.id} run={run} mutate={mutate} busy={busy} />)}
    {!runs.length && <p className="text-sm text-muted-foreground">No executions yet.</p>}
  </section>;
}

export function RunOutput({ run, mutate, busy, expanded = false }: WorkbenchActions & { run: Run; expanded?: boolean }) {
  const [attached, setAttached] = useState(false);
  const [events, setEvents] = useState<RunEvent[]>([]);
  const [connection, setConnection] = useState<{ connectionError?: string; stopRequested?: boolean }>({});
  const [error, setError] = useState('');
  const cursor = useRef(0);
  useEffect(() => {
    let disposed = false;
    let timer: ReturnType<typeof setTimeout>;
    async function poll() {
      try {
        const [page, health] = await Promise.all([
          workbenchRequest<RunEvent[]>(`/runs/${run.id}/events?after=${cursor.current}`),
          workbenchRequest<typeof connection>(`/runs/${run.id}/connection`),
        ]);
        if (disposed) return;
        if (page.length) {
          cursor.current = page.at(-1)!.seq;
          setEvents((previous) => [...previous, ...page].slice(-1000));
        }
        setConnection(health);
        setError('');
        if (page.length === 200 || active.includes(run.state)) {
          timer = setTimeout(() => void poll(), page.length === 200 ? 0 : 1500);
        }
      } catch (err) {
        if (disposed) return;
        setError((err as Error).message);
        timer = setTimeout(() => void poll(), 3000);
      }
    }
    void poll();
    return () => { disposed = true; clearTimeout(timer); };
  }, [run.id, run.state]);
  const messages = events.flatMap((event) => {
    if (event.type === 'stderr') return [String(event.data.data)];
    if (event.type !== 'protocol') return [];
    const data = event.data.data as Record<string, unknown>;
    if (data.type === 'test-output' || data.type === 'delivery-output') return [`[${data.stream}] ${data.text}`];
    if (data.type === 'message') return [String(data.text)];
    if (data.type === 'tool') return [JSON.stringify(data.item, null, 2)];
    if (data.type === 'attention') return [`Waiting for a decision: ${data.kind}`];
    return [];
  });
  return <details className="rounded-md border p-3" open={expanded || active.includes(run.state)}>
    <summary className="cursor-pointer text-sm">{run.kind} · {run.provider} · {run.state} · {new Date(run.createdAt).toLocaleString()}</summary>
    {run.kind === 'terminal' && (attached
      ? <Suspense fallback={<p className="mt-3 text-sm">Loading terminal…</p>}><TerminalView runId={run.id} onDetach={() => setAttached(false)} /></Suspense>
      : <Button className="mt-3" size="sm" variant="outline" onClick={() => setAttached(true)}>Attach terminal</Button>)}
    {run.codeRef && <p className="mt-2 break-all text-xs text-muted-foreground">Started at {run.codeRef}</p>}
    {connection.connectionError && <p role="status" className="mt-2 break-words text-sm text-amber-600">
      Connection unavailable: {connection.connectionError}. Execution status is unconfirmed; Gate will reconnect.</p>}
    {run.state === 'lost' && <p className="mt-2 text-sm text-destructive">Runtime ownership was lost. The checkout remains locked until the remote process is inspected.</p>}
    {(error || run.error) && <p role="alert" className="mt-2 break-words text-sm text-destructive">{error || run.error}</p>}
    <pre className="my-3 max-h-96 overflow-auto whitespace-pre-wrap break-words text-xs">{messages.join('\n\n') || 'Waiting for output…'}</pre>
    <p className="mb-3 text-xs text-muted-foreground">Showing the latest 1,000 events.{' '}
      <a className="underline" href={`/api/workbench/runs/${run.id}/log`} download>Download full event log</a></p>
    {active.includes(run.state) && <Button size="sm" variant="outline" disabled={busy || connection.stopRequested}
      onClick={() => { void mutate(`/runs/${run.id}/stop`, 'POST').catch((err) => setError(err.message)); }}>
      {connection.stopRequested ? 'Stop requested — awaiting confirmation' : 'Stop run'}
    </Button>}
  </details>;
}
