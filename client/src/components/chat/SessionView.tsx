import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { api, post } from '@/lib/api';
import { useEvents } from '@/hooks/use-events';
import { MessageBubble } from './MessageBubble';
import { ApprovalRequest } from './ApprovalRequest';
import { labels } from '@/lib/session';
import type { SessionDetail, Item } from '../../../../server/src/types';

function mergeItems(old: Item[], incoming: Item[]) {
  const result = new Map(old.map((item) => [item.id, item]));
  for (const item of incoming) result.set(item.id, item);
  return [...result.values()];
}
export function SessionView({ serverId, threadId, serverName, initialError }: {
  serverId: string; threadId: string; serverName: string; initialError: string;
}) {
  const base = `/servers/${encodeURIComponent(serverId)}/sessions/${encodeURIComponent(threadId)}`;
  const [detail, setDetail] = useState<SessionDetail | null>(null);
  const [error, setError] = useState(initialError);
  const [offline, setOffline] = useState(false);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const viewport = useRef<HTMLDivElement>(null);
  const follow = useRef(true);
  const alive = useRef(true);
  const revision = useRef(0);
  const eventTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    try {
      const data = await api<SessionDetail>(base);
      if (!alive.current || current !== revision.current) return;
      setDetail((previous) => ({ ...data, items: mergeItems(previous?.items ?? [], data.items),
        nextCursor: previous ? previous.nextCursor : data.nextCursor }));
      setOffline(false);
    } catch (e) { if (alive.current && current === revision.current) { setError((e as Error).message); setOffline(true); } }
  }, [base]);
  useEffect(() => {
    alive.current = true;
    void refresh();
    const timer = setInterval(() => void refresh(), 5000);
    return () => { alive.current = false; clearInterval(timer); clearTimeout(eventTimer.current); };
  }, [refresh]);
  useEvents((event) => {
    if (event.serverId && event.serverId !== serverId) return;
    if (event.threadId && event.threadId !== threadId) return;
    if (event.type === 'disconnected') { setOffline(true); return; }
    if (event.type === 'item' && event.item) setDetail((previous) => previous ? { ...previous, items: mergeItems(previous.items, [event.item!]) } : previous);
    else if (event.type === 'delta') setDetail((previous) => previous ? { ...previous, items: previous.items.map((item) =>
      item.id === event.itemId ? { ...item, text: (item.text + (event.delta ?? '')).slice(-200_000) } : item) } : previous);
    else {
      clearTimeout(eventTimer.current);
      eventTimer.current = setTimeout(() => void refresh(), 150);
    }
  });
  useEffect(() => { if (follow.current && viewport.current) viewport.current.scrollTop = viewport.current.scrollHeight; }, [detail]);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!text.trim() || busy) return;
    setBusy(true); setError('');
    try { await post(`${base}/input`, { text, turnId: detail?.turnId }); setText(''); follow.current = true; await refresh(); }
    catch (e) { setError((e as Error).message); await refresh(); } finally { setBusy(false); }
  }
  async function stop() {
    if (!detail?.turnId) return;
    setBusy(true); setError('');
    try { await post(`${base}/interrupt`, { turnId: detail.turnId }); await refresh(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function older() {
    if (!detail?.nextCursor || loadingOlder) return;
    setLoadingOlder(true);
    const node = viewport.current;
    const height = node?.scrollHeight ?? 0;
    follow.current = false;
    try {
      const page = await api<SessionDetail>(`${base}?cursor=${encodeURIComponent(detail.nextCursor)}`);
      setDetail((previous) => previous ? { ...previous, items: mergeItems(page.items, previous.items), nextCursor: page.nextCursor } : page);
      requestAnimationFrame(() => { if (node) node.scrollTop += node.scrollHeight - height; });
    } catch (e) { setError((e as Error).message); } finally { setLoadingOlder(false); }
  }
  return <main className="flex h-full min-h-0 flex-col">
    <div className="border-b px-4 py-3 sm:px-8"><div className="mx-auto flex max-w-3xl items-center gap-3">
      <div className="min-w-0 flex-1"><h1 className="truncate text-sm font-semibold">{detail?.session.name ?? 'Session'}</h1>
        <p className="mt-1 truncate text-xs text-muted-foreground" title={detail?.session.cwd}>{serverName} · {detail?.session.cwd}</p></div>
      <span className="shrink-0 text-xs text-muted-foreground">{offline ? 'Reconnecting…' : detail ? labels[detail.session.state] : 'Loading…'}</span>
    </div></div>
    <div className="min-h-0 flex-1 overflow-y-auto" ref={viewport} onScroll={() => {
      const node = viewport.current; if (node) follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 100;
    }}><div className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
      {detail?.nextCursor && <div className="text-center"><Button variant="ghost" size="sm" disabled={loadingOlder} onClick={() => void older()}>{loadingOlder ? 'Loading…' : 'Earlier messages'}</Button></div>}
      {detail?.items.map((item) => <MessageBubble key={item.id} item={item} />)}
      {!detail && !error && <p className="py-12 text-center text-sm text-muted-foreground">Loading conversation…</p>}
      {detail && !detail.items.length && <p className="py-12 text-center text-sm text-muted-foreground">Start with a message below.</p>}
    </div></div>
    <div className="border-t bg-background px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6"><div className="mx-auto max-w-3xl space-y-3">
      {detail?.requests.map((request) => <ApprovalRequest key={request.id} request={request} onAnswer={async (value) => {
        try { await post(`${base}/requests/${encodeURIComponent(request.id)}`, value); } finally { await refresh(); }
      }} />)}
      {error && <div role="alert" className="flex items-start gap-2 text-sm text-destructive"><p className="min-w-0 flex-1 break-words">{error}</p>
        <button className="shrink-0 text-xs underline" onClick={() => setError('')}>Dismiss</button></div>}
      {detail && !detail.session.canInput && <p className="text-sm text-muted-foreground">Continue this child session through its parent conversation.</p>}
      <form onSubmit={send} className="flex items-end gap-2">
        <Textarea aria-label="Message Codex" placeholder={detail?.turnId ? 'Send an update to Codex…' : 'Message Codex…'} value={text}
          onChange={(e) => setText(e.target.value)} rows={2} className="max-h-40 min-h-16 flex-1 resize-y"
          disabled={!detail?.session.canInput || offline} onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
          }} />
        {detail?.turnId && <Button type="button" size="icon" variant="outline" aria-label="Stop current turn" disabled={busy || offline} onClick={() => void stop()}><Square className="size-4" /></Button>}
        <Button type="submit" size="icon" aria-label={detail?.turnId ? 'Send update' : 'Send message'} disabled={busy || offline || !detail?.session.canInput || !text.trim()}><ArrowUp /></Button>
      </form>
    </div></div>
  </main>;
}
