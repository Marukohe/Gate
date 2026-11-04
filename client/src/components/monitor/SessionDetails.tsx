import type { MonitoredSession } from '../../../../server/src/monitor-types';
import { useWorkbench } from '@/components/workbench/use-workbench';
import { AttentionPanel } from '@/components/workbench/AttentionPanel';
import { RunOutput } from '@/components/workbench/RunPanel';

export function SessionDetails({ session }: { session: MonitoredSession }) {
  if (session.source === 'external') return <div className="space-y-3 text-sm">
    <p>{session.activity}</p>
    <p className="break-all text-xs text-muted-foreground">Session {session.nativeSessionId}</p>
    <p className="text-muted-foreground">Observed through hooks. Continue in the original terminal; Gate cannot control this session.</p>
  </div>;
  return <ManagedSession runId={session.runId!} />;
}

function ManagedSession({ runId }: { runId: string }) {
  const { snapshot, error, mutate, busy } = useWorkbench();
  const run = snapshot?.runs.find((item) => item.id === runId);
  return <div className="space-y-4">
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {snapshot && <AttentionPanel items={snapshot.attention.filter((item) => item.runId === runId)} mutate={mutate} busy={busy} />}
    {run ? <RunOutput run={run} mutate={mutate} busy={busy} expanded />
      : <p className="text-sm text-muted-foreground">{snapshot ? 'Session is no longer available.' : 'Loading session…'}</p>}
  </div>;
}
