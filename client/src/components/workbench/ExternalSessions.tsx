import { useState } from 'react';
import { Button } from '@/components/ui/button';
import type { Checkout, HookSettings, ObservedSession, Task } from '../../../../server/src/workbench/types';
import type { WorkbenchActions } from './use-workbench';
import { selectClass } from './ProjectForm';

export function ExternalSessions({ checkouts, sessions, settings, tasks, configure = false, mutate, busy }: WorkbenchActions & {
  checkouts: Checkout[]; sessions: ObservedSession[]; settings: HookSettings[]; tasks: Task[]; configure?: boolean;
}) {
  const [error, setError] = useState('');
  async function change(url: string, method: string, data: object) {
    setError('');
    try { await mutate(url, method, data); } catch (err) { setError((err as Error).message); }
  }
  if (!configure && !sessions.length) return null;
  return <section className="space-y-3 rounded-xl border bg-card p-5">
    <h2 className="font-medium">External sessions</h2>
    <p className="text-xs text-muted-foreground">Observed through checkout hooks. Gate shows recent activity; live input,
      approvals, stop, history and terminal attachment are unavailable for these sessions. Continue in the original terminal.</p>
    {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
    {configure && <details><summary className="cursor-pointer text-sm">Manage checkout hooks</summary>
      <p className="my-3 text-xs text-muted-foreground">Install only in these checkouts; existing hooks are preserved.
        Restart the native CLI after changes. For Codex, start with <code>codex --enable hooks</code> and review the
        new definitions in <code>/hooks</code>. Project trust is also required; Gate does not grant it.</p>
      <div className="space-y-3">{checkouts.map((checkout) => {
        const config = settings.find((item) => item.checkoutId === checkout.id);
        return <div key={checkout.id} className="space-y-2 rounded-lg border p-3">
          <p className="break-all text-xs">{checkout.path}</p>
          <div className="flex flex-wrap gap-2">{['claude', 'codex'].map((provider) => <Button key={provider}
            disabled={busy} size="sm" variant="outline" onClick={() => void change(`/checkouts/${checkout.id}/hooks`, 'PUT',
              { provider, enabled: !config?.providers[provider] })}>
            {config?.providers[provider] ? 'Remove' : 'Install'} {provider} hooks</Button>)}</div>
          {config?.connectionError && <p role="status" className="break-words text-xs text-amber-600">Observation unavailable: {config.connectionError}</p>}
        </div>;
      })}</div>
    </details>}
    {!sessions.length && <p className="text-sm text-muted-foreground">No hook events received yet. Installing hooks does not discover already running sessions.</p>}
    {sessions.map((item) => {
      const released = item.dismissedRevision === item.revision;
      const stale = Date.now() - item.lastSeenAt > 60_000;
      return <article key={item.id} className="space-y-2 rounded-lg border p-3 text-sm">
        <p className="font-medium">{item.provider} · {released ? 'manually cleared' : item.state === 'ended' ? 'session ended' : `last reported ${item.state}`}</p>
        <p className="break-all text-xs text-muted-foreground">{item.sessionId}<br />{item.cwd}</p>
        <p className="text-xs text-muted-foreground">{item.event} · {new Date(item.lastSeenAt).toLocaleString()}
          {stale && item.state !== 'ended' ? ' · No recent event; process status is unknown.' : ''}</p>
        <label className="block text-xs">Related task
          <select aria-label={`Task for ${item.sessionId}`} className={`${selectClass} mt-1 w-full max-w-full`}
            value={item.taskId ?? ''} disabled={busy} onChange={(event) => void change(`/observed-sessions/${item.id}`, 'PATCH',
              { taskId: event.target.value || null })}>
            <option value="">Unassigned</option>{tasks.filter((task) => task.checkoutId === item.checkoutId).map((task) =>
              <option key={task.id} value={task.id}>{task.title}</option>)}
          </select></label>
        {!released && item.state !== 'ended' && <>
          <p className="text-xs text-amber-600">New managed runs in this checkout are blocked. Use a separate task worktree,
            or stop the external session in its native terminal. Clear this record only after inspecting that it has exited.</p>
          <Button size="sm" variant="outline" disabled={busy}
            onClick={() => void change(`/observed-sessions/${item.id}`, 'PATCH', { inspected: true })}>I confirmed this session exited</Button>
        </>}
      </article>;
    })}
  </section>;
}
