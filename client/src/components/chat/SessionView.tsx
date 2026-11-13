import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowUp, Pencil, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
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
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [renameError, setRenameError] = useState('');
  const viewport = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
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
  async function rename(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!name.trim() || savingName) return;
    setSavingName(true); setRenameError('');
    try {
      await post(`${base}/rename`, { name: name.trim() });
      setDetail((previous) => previous ? { ...previous, session: { ...previous.session, name: name.trim() } } : previous);
      setRenaming(false);
      await refresh();
    } catch (e) { setRenameError((e as Error).message); }
    finally { setSavingName(false); }
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
      <div className="min-w-0 flex-1"><div className="flex items-center gap-1"><h1 className="truncate text-sm font-semibold">{detail?.session.name ?? 'Session'}</h1>
        <Button variant="ghost" size="icon-sm" aria-label="Rename session" title="Rename session" disabled={!detail || offline}
          className="text-muted-foreground" onClick={() => { setName(detail!.session.name); setRenameError(''); setRenaming(true); }}><Pencil className="size-3.5" /></Button></div>
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
        <Textarea aria-label="Message Codex" placeholder={detail?.turnId ? 'Update Codex…' : 'Message Codex…'} value={text}
          onChange={(e) => setText(e.target.value)} rows={1} className="max-h-32 min-h-10 min-w-0 flex-1 resize-none py-[9px] leading-5"
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onBlur={() => { composing.current = false; }}
          disabled={!detail?.session.canInput || offline} onKeyDown={(e) => {
            // IME confirmation can arrive after compositionend with isComposing already false.
            if (composing.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
          }} />
        {detail?.turnId && <Button type="button" size="icon-lg" variant="outline" aria-label="Stop current turn" disabled={busy || offline} onClick={() => void stop()}><Square className="size-4" /></Button>}
        <Button type="submit" size="icon-lg" aria-label={detail?.turnId ? 'Send update' : 'Send message'} disabled={busy || offline || !detail?.session.canInput || !text.trim()}><ArrowUp /></Button>
      </form>
    </div></div>
    <Dialog open={renaming} onOpenChange={(open) => { if (!savingName) setRenaming(open); }}>
      <DialogContent><DialogHeader><DialogTitle>Rename session</DialogTitle>
        <DialogDescription>Saved in Codex and shared with your terminal.</DialogDescription></DialogHeader>
        <form onSubmit={rename} className="space-y-4">
          <label className="block space-y-2 text-sm">Session name<Input value={name} onChange={(e) => setName(e.target.value)}
            maxLength={1000} required autoFocus disabled={savingName} /></label>
          {renameError && <p role="alert" className="break-words text-sm text-destructive">{renameError}</p>}
          <div className="flex justify-end gap-2"><Button type="button" variant="outline" disabled={savingName} onClick={() => setRenaming(false)}>Cancel</Button>
            <Button type="submit" disabled={savingName || offline || !name.trim()}>{savingName ? 'Saving…' : 'Save name'}</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  </main>;
}
