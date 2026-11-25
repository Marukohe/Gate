import { useEffect, useRef, useState } from 'react';
import { Popover } from 'radix-ui';
import { Activity, CircleAlert, X } from 'lucide-react';
import { useMonitorStore } from '@/stores/monitor-store';
import { sessionKey } from '@/stores/session-view-store';
import { needsAttention, otherSessions, type AttentionSession, type SessionTarget } from '@/lib/attention';
import { ToolTag } from '@/components/monitor/ToolTag';

export function SessionAttention({ current, onOpen }: {
  current: SessionTarget | null; onOpen: (serverId: string, threadId: string) => void;
}) {
  const { servers, error } = useMonitorStore();
  const [panel, setPanel] = useState<'waiting' | 'running' | null>(null);
  const [notices, setNotices] = useState<AttentionSession[]>([]);
  const previous = useRef(new Map<string, string>());
  const [lastCurrent, setLastCurrent] = useState(current);
  // Visiting a thread consumes its notice, including navigation through Next or browser Back.
  if (lastCurrent !== current) {
    setLastCurrent(current);
    setNotices((old) => current ? old.filter((item) => item.serverId !== current.serverId || item.threadId !== current.threadId) : []);
  }
  const candidates = error ? [] : otherSessions(servers, current);
  const waiting = candidates.filter(({ session }) => needsAttention(session));
  const running = error ? [] : otherSessions(servers, null).filter(({ session }) => session.state === 'running');
  useEffect(() => {
    for (const item of otherSessions(useMonitorStore.getState().servers, null)) {
      const key = sessionKey(item.serverId, item.threadId);
      if (item.session.state !== 'unknown' && !previous.current.has(key)) previous.current.set(key, item.session.state);
    }
    return useMonitorStore.subscribe(({ servers, error }) => {
      if (!servers || error) { setNotices([]); return; }
      const incoming: AttentionSession[] = [];
      const available = new Map<string, AttentionSession>();
      for (const item of otherSessions(servers, null)) {
        if (item.session.state === 'unknown') continue;
        const key = sessionKey(item.serverId, item.threadId);
        const before = previous.current.get(key);
        previous.current.set(key, item.session.state);
        if (!current || (current.serverId === item.serverId && current.threadId === item.threadId)) continue;
        available.set(key, item);
        // First observation and reconnection establish a baseline, rather than a new alert.
        if (before && before !== item.session.state && needsAttention(item.session)) incoming.push(item);
      }
      setNotices((old) => [...old.filter((item) => {
        const latest = available.get(sessionKey(item.serverId, item.threadId));
        return latest && latest.session.state === item.session.state && needsAttention(latest.session);
      }), ...incoming].slice(-4));
    });
  }, [current]);
  const notice = error ? undefined : notices.find((item) => item.serverId !== current?.serverId || item.threadId !== current?.threadId);
  const noticeId = notice ? `${sessionKey(notice.serverId, notice.threadId)}:${notice.session.state}` : '';
  useEffect(() => {
    if (!noticeId) return;
    const timer = setTimeout(() => setNotices((old) => old.filter((item) => `${sessionKey(item.serverId, item.threadId)}:${item.session.state}` !== noticeId)), 8000);
    return () => clearTimeout(timer);
  }, [noticeId]);
  const open = (item: SessionTarget) => {
    setPanel(null);
    setNotices((old) => old.filter((notice) => notice.serverId !== item.serverId || notice.threadId !== item.threadId));
    onOpen(item.serverId, item.threadId);
  };
  if (!current) return null;
  return <>
    <div className="ml-auto flex shrink-0 items-center gap-1" aria-label="Session status">
      {(['waiting', 'running'] as const).map((kind) => {
        const items = kind === 'waiting' ? waiting : running;
        const label = kind === 'waiting' ? 'Needs you' : 'Running';
        const listLabel = kind === 'waiting' ? 'Other sessions: Needs you' : 'Running sessions';
        return <Popover.Root key={kind} open={panel === kind} onOpenChange={(value) => setPanel(value ? kind : null)}>
          <Popover.Trigger asChild><button type="button" aria-label={listLabel} title={listLabel}
            className={`inline-flex items-center gap-1 rounded-md px-1.5 py-1.5 text-[11px] font-semibold hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring sm:px-2 sm:text-xs monitor-${kind}`}>
            {kind === 'waiting' ? <CircleAlert className="size-3.5 sm:hidden" aria-hidden="true" /> : <Activity className="size-3.5 sm:hidden" aria-hidden="true" />}
            <span className="sr-only sm:not-sr-only">{label}</span><span className="tabular-nums">{error || !servers ? '—' : items.length}</span>
          </button></Popover.Trigger>
          <Popover.Portal><Popover.Content align="end" sideOffset={12} collisionPadding={16}
            aria-label={listLabel} className="z-50 w-[min(24rem,calc(100vw-2rem))] rounded-xl border bg-popover p-2 text-popover-foreground shadow-lg outline-none">
            <div className="flex items-center justify-between px-2 py-2"><h2 className="text-sm font-semibold">{kind === 'waiting' ? 'Other sessions · Needs you' : listLabel}</h2>
              <Popover.Close aria-label="Close session list" className="rounded p-1 hover:bg-accent"><X className="size-4" /></Popover.Close></div>
            {error ? <p role="status" className="break-words p-2 text-xs text-destructive">Updates paused. {error}</p>
              : <div className="max-h-[50dvh] overflow-y-auto">{items.map((item) => <button key={sessionKey(item.serverId, item.threadId)}
                type="button" onClick={() => open(item)} disabled={item.serverId === current.serverId && item.threadId === current.threadId}
                className="block w-full rounded-lg px-2 py-3 text-left hover:bg-accent focus-visible:outline-2 focus-visible:outline-ring">
                <span className="flex items-center gap-2 text-sm font-medium"><span className="min-w-0 flex-1 truncate">{item.session.name}</span>
                  <ToolTag name={item.toolName} />
                  {item.serverId === current.serverId && item.threadId === current.threadId && <span className="text-xs font-normal text-muted-foreground">Current</span>}</span>
                <span className="mt-1 block truncate text-xs text-muted-foreground">{item.serverName} · {item.session.attentionReason || (kind === 'waiting' ? item.session.state === 'error' ? 'Session error' : 'Waiting for you' : 'Running')}</span>
              </button>)}
              {!items.length && <p className="p-2 text-sm text-muted-foreground">{kind === 'waiting' ? 'No other sessions need you.' : 'No sessions are running.'}</p>}
            </div>}
            {servers?.some((server) => server.state !== 'connected') && <p className="border-t px-2 py-2 text-xs text-muted-foreground">Some tools are unavailable; their session status is unknown.</p>}
          </Popover.Content></Popover.Portal>
        </Popover.Root>;
      })}
    </div>
    {notice && <div role="status" aria-live="polite" className="fixed right-4 top-20 z-40 w-[calc(100%-2rem)] max-w-sm rounded-xl border bg-card p-3 text-card-foreground shadow-lg">
      <div className="flex items-start gap-2"><div className="min-w-0 flex-1"><div className="flex min-w-0 items-center gap-2"><p className="truncate text-sm font-semibold">{notice.session.name}</p><ToolTag name={notice.toolName} /></div>
        <p className="mt-1 break-words text-xs text-muted-foreground">{notice.serverName} · {notice.session.attentionReason || (notice.session.state === 'error' ? 'Session error' : 'Waiting for you')}</p></div>
        <button type="button" aria-label="Dismiss session notice" className="rounded p-1 hover:bg-accent" onClick={() => setNotices((old) => old.filter((item) => item !== notice))}><X className="size-4" /></button></div>
      <button type="button" className="mt-2 text-xs font-semibold underline" onClick={() => open(notice)}>View session</button>
    </div>}
  </>;
}
