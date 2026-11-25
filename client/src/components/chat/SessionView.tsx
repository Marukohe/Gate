import { Fragment, useCallback, useEffect, useLayoutEffect, useRef, useState, type FormEvent } from 'react';
import { createPortal } from 'react-dom';
import { Popover } from 'radix-ui';
import { ArrowUp, ChevronDown, ImagePlus, LoaderCircle, Moon, Pencil, Square, Sun, Terminal, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { api, post } from '@/lib/api';
import { clipboardImages, readImages } from '@/lib/image-attachments';
import { IMAGE_TYPES } from '../../../../server/src/images';
import { useEvents } from '@/hooks/use-events';
import { MessageBubble } from './MessageBubble';
import { ShellOutput } from './ShellOutput';
import { SessionFileContext } from '@/lib/message-url';
import { ApprovalRequest } from './ApprovalRequest';
import { labels } from '@/lib/session';
import { emptyView, sessionKey, useSessionViewStore } from '@/stores/session-view-store';
import { useUIStore } from '@/stores/ui-store';
import type { SessionDetail, Item, ModelOption, ShellResult } from '../../../../server/src/types';

function mergeItems(old: Item[], incoming: Item[]) {
  const result = new Map(old.map((item) => [item.id, item]));
  for (const item of incoming) result.set(item.id, item);
  return [...result.values()];
}
export function SessionView({ serverId, threadId, serverName, initialError, headerTarget, onHome }: {
  serverId: string; threadId: string; serverName: string; initialError: string;
  headerTarget: HTMLElement | null; onHome: () => void;
}) {
  const base = `/servers/${encodeURIComponent(serverId)}/sessions/${encodeURIComponent(threadId)}`;
  const key = sessionKey(serverId, threadId);
  const saved = useSessionViewStore((state) => state.views[key] ?? emptyView);
  const update = useSessionViewStore((state) => state.update);
  const { text, model, effort, busy, shellRuns, images } = saved;
  const isShell = text.trimStart().startsWith('!');
  const command = isShell ? text.trimStart().slice(1).trim() : '';
  const setText = (text: string) => update(key, { text });
  const setModel = (model: string) => update(key, { model });
  const setEffort = (effort: string) => update(key, { effort });
  const setBusy = (busy: boolean) => update(key, { busy });
  const [detail, setDetail] = useState<SessionDetail | null>(() => saved.detail ? { ...saved.detail, requests: [] } : null);
  const [error, setError] = useState(initialError);
  const [offline, setOffline] = useState(!!saved.detail);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [historyError, setHistoryError] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [name, setName] = useState('');
  const [savingName, setSavingName] = useState(false);
  const [renameError, setRenameError] = useState('');
  const [showDetails, setShowDetails] = useState(false);
  const dark = useUIStore((state) => state.darkMode);
  const toggleDark = useUIStore((state) => state.toggleDarkMode);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelError, setModelError] = useState('');
  const [modelRevision, setModelRevision] = useState(0);
  const [loadingModels, setLoadingModels] = useState(true);
  const viewport = useRef<HTMLDivElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const messageInput = useRef<HTMLTextAreaElement>(null);
  const focusAfterPaste = useRef(false);
  const lastScrollTop = useRef(0);
  const olderPending = useRef(false);
  const prepend = useRef<{ anchor?: HTMLElement; offset: number; top: number; height: number } | null>(null);
  const composing = useRef(false);
  const follow = useRef(saved.follow);
  const latestDetail = useRef(detail);
  useEffect(() => { latestDetail.current = detail; }, [detail]);
  useLayoutEffect(() => {
    const node = viewport.current;
    const cached = useSessionViewStore.getState().views[key];
    if (node && cached) { node.scrollTop = cached.scrollTop; lastScrollTop.current = node.scrollTop; }
    return () => update(key, { detail: latestDetail.current, scrollTop: node?.scrollTop ?? 0, follow: follow.current });
  }, [key, update]);
  const alive = useRef(true);
  const revision = useRef(0);
  const eventTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const draftModel = detail?.turnId ? '' : model;
  const selectedModel = models.find((option) => option.id === (draftModel || detail?.session.model));
  const efforts = selectedModel?.efforts ?? [];
  const selectedEffort = efforts.some((option) => option.id === effort) ? effort : '';
  const defaultEffort = draftModel ? selectedModel?.defaultEffort : detail?.session.effort;
  const effortOverride = selectedEffort || (model && efforts.some((option) => option.id === defaultEffort) ? defaultEffort : undefined);
  useEffect(() => {
    const controller = new AbortController();
    setLoadingModels(true); setModelError('');
    void api<{ models: ModelOption[] }>(`/servers/${encodeURIComponent(serverId)}/models`, { signal: controller.signal })
      .then((result) => { if (!controller.signal.aborted) setModels(result.models); })
      .catch((e: Error) => { if (!controller.signal.aborted) setModelError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoadingModels(false); });
    return () => controller.abort();
  }, [serverId, modelRevision]);
  const refresh = useCallback(async () => {
    const current = ++revision.current;
    const startingItems = new Map(latestDetail.current?.items.map((item) => [item.id, item]));
    try {
      const data = await api<SessionDetail>(base);
      if (!alive.current || current !== revision.current) return;
      setDetail((previous) => {
        const currentItems = new Map(previous?.items.map((item) => [item.id, item]));
        // HTTP can arrive after newer live output. Reconcile only items unchanged since this read began.
        const items = data.items.map((item) => {
          const latest = currentItems.get(item.id);
          return latest && latest !== startingItems.get(item.id) ? latest : item;
        });
        return { ...data, items: mergeItems(previous?.items ?? [], items),
          nextCursor: previous ? previous.nextCursor : data.nextCursor };
      });
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
  useLayoutEffect(() => {
    const node = viewport.current;
    if (!node) return;
    if (prepend.current) {
      const { anchor, offset, top, height } = prepend.current;
      // Keep the visible message fixed even if streaming also changed content below it.
      if (anchor?.isConnected) node.scrollTop += anchor.getBoundingClientRect().top - offset;
      else node.scrollTop = top + node.scrollHeight - height;
      prepend.current = null; olderPending.current = false;
    } else if (follow.current) node.scrollTop = node.scrollHeight;
    else return;
    lastScrollTop.current = node.scrollTop;
  }, [detail, shellRuns]);
  const canAttach = !!detail?.session.canInput && !offline;
  const attach = useCallback(async (files: File[]) => {
    const draft = useSessionViewStore.getState().views[key] ?? emptyView;
    if (!files.length || draft.busy || !canAttach) return;
    update(key, { busy: true }); setError('');
    try {
      update(key, { images: [...draft.images, ...await readImages(files, draft.images)] });
    }
    catch (e) { if (alive.current) setError((e as Error).message); }
    finally { update(key, { busy: false }); }
  }, [key, canAttach, update]);
  useLayoutEffect(() => {
    if (!busy && focusAfterPaste.current) {
      focusAfterPaste.current = false;
      if (!document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"]')) {
        messageInput.current?.focus({ preventScroll: true });
      }
    }
  });
  useEffect(() => {
    const paste = (event: ClipboardEvent) => {
      if (event.defaultPrevented || !event.clipboardData || !canAttach || useSessionViewStore.getState().views[key]?.busy) return;
      const target = event.target instanceof Element ? event.target : null;
      // Leave other editors and dialogs alone; ordinary text keeps the browser's normal paste behavior.
      if (target?.closest('[role="dialog"], [role="alertdialog"]') || document.querySelector('[role="dialog"][data-state="open"]')) return;
      if (target?.closest('input, textarea, [contenteditable]:not([contenteditable="false"]), [role="textbox"]') && target !== messageInput.current) return;
      const files = clipboardImages(event.clipboardData);
      if (!files.length) return;
      event.preventDefault();
      focusAfterPaste.current = true;
      void attach(files);
    };
    document.addEventListener('paste', paste);
    return () => document.removeEventListener('paste', paste);
  }, [attach, canAttach, key]);
  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if ((!text.trim() && !images.length) || (isShell && (!command || images.length)) ||
      useSessionViewStore.getState().views[key]?.busy || offline || !detail?.session.canInput) return;
    setBusy(true); setError('');
    if (isShell) {
      const run = { id: `shell-${Date.now()}-${Math.random().toString(36).slice(2)}`, command, afterItemId: detail?.items.at(-1)?.id };
      const record = useSessionViewStore.getState().shellRun;
      follow.current = true; record(key, run); setText('');
      try { record(key, { ...run, result: await post<ShellResult>(`${base}/shell`, { command }) }); }
      catch (e) { record(key, { ...run, error: `${(e as Error).message}. Check the command before running it again.` }); }
      finally { setBusy(false); }
      return;
    }
    try {
      await post(`${base}/input`, { text, ...(images.length ? { images: images.map((image) => image.url) } : {}),
        turnId: detail?.turnId, ...(!detail?.turnId && model ? { model } : {}),
        ...(!detail?.turnId && effortOverride ? { effort: effortOverride } : {}) });
      update(key, { text: '', images: [], model: '', effort: '' }); follow.current = true; await refresh();
    }
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
    if (!detail?.nextCursor || olderPending.current || offline) return;
    olderPending.current = true;
    setLoadingOlder(true); setHistoryError('');
    const node = viewport.current;
    follow.current = false;
    try {
      const page = await api<SessionDetail>(`${base}?cursor=${encodeURIComponent(detail.nextCursor)}`);
      if (!alive.current) return;
      if (node) {
        const edge = node.getBoundingClientRect().top;
        const anchor = [...node.querySelectorAll<HTMLElement>('[data-message-id]')].find((item) => item.getBoundingClientRect().bottom > edge);
        prepend.current = { anchor, offset: anchor?.getBoundingClientRect().top ?? 0, top: node.scrollTop, height: node.scrollHeight };
      }
      setDetail((previous) => previous ? { ...previous, items: mergeItems(page.items, previous.items), nextCursor: page.nextCursor } : page);
    } catch (e) { if (alive.current) setHistoryError((e as Error).message); }
    finally { if (!prepend.current) olderPending.current = false; if (alive.current) setLoadingOlder(false); }
  }
  return <main className="flex h-full min-h-0 flex-col">
    {headerTarget && createPortal(<Popover.Root open={showDetails} onOpenChange={setShowDetails}>
      <div className="relative flex min-w-0 items-center gap-1.5 rounded-md px-1 py-1.5">
        <span aria-hidden="true" className={`monitor-dot monitor-${offline ? 'unknown' : detail?.session.state ?? 'unknown'}`} />
        <h1 className="min-w-0 truncate text-sm font-semibold">{detail?.session.name ?? 'Session'}</h1>
        <ChevronDown aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
        <Popover.Trigger asChild><button type="button" aria-label="Session details" title={`${serverName} · ${detail?.session.cwd ?? ''}`}
          className="absolute inset-0 rounded-md hover:bg-muted/30 focus-visible:outline-2 focus-visible:outline-ring" /></Popover.Trigger>
      </div>
      <Popover.Portal><Popover.Content align="start" sideOffset={10} collisionPadding={16} aria-label="Session details"
        className="z-50 w-[min(24rem,calc(100vw-2rem))] space-y-3 rounded-xl border bg-popover p-4 text-popover-foreground shadow-lg outline-none">
        <p className="break-words text-sm font-semibold">{detail?.session.name ?? 'Session'}</p>
        <dl className="space-y-2 text-xs"><div><dt className="text-muted-foreground">Server</dt><dd className="mt-1 break-words">{serverName}</dd></div>
          <div><dt className="text-muted-foreground">Working directory</dt><dd className="mt-1 break-all">{detail?.session.cwd || 'Loading…'}</dd></div>
          <div><dt className="text-muted-foreground">Status</dt><dd className="mt-1">{offline ? 'Reconnecting…' : detail ? labels[detail.session.state] : 'Loading…'}</dd></div></dl>
        <div className="flex flex-wrap gap-2 border-t pt-3">
          <Button variant="outline" size="sm" aria-label="Rename session" disabled={!detail || offline}
            onClick={() => { setName(detail!.session.name); setRenameError(''); setShowDetails(false); setRenaming(true); }}><Pencil />Rename</Button>
          <Button variant="ghost" size="sm" aria-label="Toggle theme" onClick={toggleDark}>{dark ? <Sun /> : <Moon />}Theme</Button>
          <Button variant="ghost" size="sm" aria-label="All sessions" onClick={() => { setShowDetails(false); onHome(); }}>All sessions</Button>
        </div>
      </Popover.Content></Popover.Portal>
    </Popover.Root>, headerTarget)}
    <div role="region" aria-label="Conversation" className="min-h-0 flex-1 overflow-y-auto" ref={viewport} onScroll={() => {
      const node = viewport.current;
      if (!node) return;
      // Ignore scroll events from our own positioning; they must not turn follow back on.
      if (Math.abs(node.scrollTop - lastScrollTop.current) < 1) return;
      const scrollingUp = node.scrollTop < lastScrollTop.current;
      const enteredTop = lastScrollTop.current > 48 && node.scrollTop <= 48;
      lastScrollTop.current = node.scrollTop;
      follow.current = !scrollingUp && node.scrollHeight - node.scrollTop - node.clientHeight < 100;
      // One request per entry, not per scroll tick. Failed pages require explicit retry.
      if (scrollingUp && enteredTop && !historyError) void older();
    }}><div className="mx-auto max-w-3xl px-4 py-4 sm:px-6">
      {detail?.nextCursor && <div className="text-center"><Button variant="ghost" size="sm" className="transition-none disabled:opacity-100"
        aria-busy={loadingOlder} disabled={loadingOlder || offline} onClick={() => void older()}>
        <span className="history-loading-indicator" data-loading={loadingOlder} aria-hidden="true">
          <LoaderCircle className={`size-3.5 ${loadingOlder ? 'motion-safe:animate-spin' : ''}`} />
        </span>Earlier messages</Button>
        {historyError && <p role="alert" className="mt-1 break-words text-xs text-destructive">{historyError}</p>}</div>}
      <SessionFileContext value={`/api${base}/file`}>
        {detail?.items.map((item) => <Fragment key={item.id}>
          <MessageBubble item={item} />
          {shellRuns.filter((run) => run.afterItemId === item.id).map((run) => <ShellOutput key={run.id} run={run} />)}
        </Fragment>)}
      </SessionFileContext>
      {shellRuns.filter((run) => !detail?.items.some((item) => item.id === run.afterItemId)).map((run) => <ShellOutput key={run.id} run={run} />)}
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
      {isShell ? <p className="flex min-w-0 items-center gap-2 text-xs text-muted-foreground"><Terminal className="size-3.5 shrink-0" />
        <span className="truncate" title={detail?.session.cwd}>Shell · {detail?.session.cwd}</span></p>
        : <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <select aria-label="Model" value={detail?.turnId ? '' : model} onChange={(e) => { setModel(e.target.value); setEffort(''); }}
          disabled={busy || offline || !detail?.session.canInput || !!detail?.turnId || loadingModels || !!modelError || !models.length}
          title={detail?.turnId ? 'Change model after this turn finishes' : 'Model for your next message'}
          className="h-7 max-w-full min-w-0 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
          <option value="">{detail?.session.model || 'Current model'}</option>
          {models.filter((option) => option.id !== detail?.session.model).map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
        <select aria-label="Reasoning effort" value={detail?.turnId ? '' : selectedEffort} onChange={(e) => setEffort(e.target.value)}
          disabled={busy || offline || !detail?.session.canInput || !!detail?.turnId || loadingModels || !!modelError || !efforts.length}
          title={detail?.turnId ? 'Change reasoning effort after this turn finishes' : 'Reasoning effort for your next message'}
          className="h-7 max-w-full min-w-0 rounded-md border bg-background px-2 text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60">
          <option value="">{defaultEffort ? `${draftModel ? 'Default' : 'Current'}: ${defaultEffort}` : 'Model default'}</option>
          {efforts.map((option) => <option key={option.id} value={option.id} title={option.description}>
            {option.id === 'xhigh' ? 'Extra high' : option.id.charAt(0).toUpperCase() + option.id.slice(1)}</option>)}
        </select>
        {modelError ? <span role="status" className="min-w-0 break-words">Models unavailable. {modelError} <button type="button" className="underline" onClick={() => setModelRevision((value) => value + 1)}>Retry models</button></span>
          : detail?.turnId ? <span>Change settings between turns</span> : model || selectedEffort ? <span>Applies to your next message</span> : null}
      </div>}
      <form onSubmit={send} className="space-y-2"
        onDragOver={(event) => { if (event.dataTransfer.types.includes('Files')) event.preventDefault(); }}
        onDrop={(event) => { event.preventDefault(); void attach(Array.from(event.dataTransfer.files)); }}>
        {!!images.length && <div aria-label="Image attachments" className="flex gap-2 overflow-x-auto py-1">
          {images.map((image) => <div key={image.id} className="relative shrink-0 rounded-lg border bg-muted/30 p-1" title={image.name}>
            <img src={image.url} alt={image.name} className="size-16 rounded object-contain" />
            <button type="button" aria-label={`Remove ${image.name}`} disabled={busy}
              onClick={() => update(key, { images: images.filter((entry) => entry.id !== image.id) })}
              className="absolute right-0 top-0 rounded-full border bg-background p-0.5 shadow-sm focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"><X className="size-3.5" /></button>
          </div>)}
        </div>}
        {isShell && !!images.length && <p role="status" className="text-xs text-muted-foreground">Remove image attachments before running a shell command.</p>}
        <div className="flex items-end gap-2">
        <input ref={fileInput} type="file" aria-label="Image files" accept={IMAGE_TYPES.join(',')} multiple hidden
          onChange={(event) => { void attach(Array.from(event.target.files ?? [])); event.target.value = ''; }} />
        <Button type="button" size="icon-lg" variant="ghost" aria-label="Attach images" title="Attach images (or paste / drop)"
          disabled={busy || offline || !detail?.session.canInput || isShell} onClick={() => fileInput.current?.click()}><ImagePlus className="size-5" /></Button>
        <Textarea ref={messageInput} aria-label="Message Codex" placeholder="Message or paste an image…" value={text}
          onChange={(e) => setText(e.target.value)} rows={1} className="max-h-32 min-h-10 min-w-0 flex-1 resize-none py-[9px] leading-5"
          onCompositionStart={() => { composing.current = true; }} onCompositionEnd={() => { composing.current = false; }}
          onBlur={() => { composing.current = false; }}
          disabled={busy || !detail?.session.canInput || offline} onKeyDown={(e) => {
            // IME confirmation can arrive after compositionend with isComposing already false.
            if (composing.current || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); }
          }} />
        {!isShell && detail?.turnId && <Button type="button" size="icon-lg" variant="outline" aria-label="Stop current turn" disabled={busy || offline} onClick={() => void stop()}><Square className="size-4" /></Button>}
        <Button type="submit" size="icon-lg" aria-label={isShell ? 'Run shell command' : detail?.turnId ? 'Send update' : 'Send message'}
          disabled={busy || offline || !detail?.session.canInput || (isShell ? !command || !!images.length : !text.trim() && !images.length)}>{isShell ? <Terminal /> : <ArrowUp />}</Button>
        </div>
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
