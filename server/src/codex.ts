import { EventEmitter } from 'node:events';
import { sessionFilePath } from './session-files.js';
import { connectCodex, type CodexRpc, type RpcMessage } from './codex-connection.js';
import { describeRequest, decision } from './codex-requests.js';
import { imageInputs } from './images.js';
import { connectionKey } from './ssh.js';
import type { AgentBackend } from './agent-backend.js';
import type { Server, Session, MonitorServer, Item, Request, SessionDetail, ServerEvent, ModelOption } from './types.js';

const compact = (text: unknown, length = 200) => String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, length);
export function sessionFromThread(thread: any): Session {
  const flags = thread.status?.activeFlags ?? [];
  const cwd = thread.cwd ?? thread.environments?.[0]?.cwd ?? '';
  return { id: thread.id, name: thread.name || cwd.split('/').filter(Boolean).at(-1) || 'New session', cwd,
    preview: compact(thread.preview), updatedAt: (thread.updatedAt ?? thread.createdAt ?? Date.now() / 1000) * 1000,
    canInput: thread.canAcceptDirectInput !== false, ...(typeof thread.model === 'string' ? { model: thread.model } : {}),
    ...(typeof thread.reasoningEffort === 'string' ? { effort: thread.reasoningEffort } : {}),
    attentionReason: flags.includes('waitingOnApproval') ? 'Waiting for approval'
      : flags.includes('waitingOnUserInput') ? 'Waiting for your answer'
        : thread.status?.type === 'systemError' ? 'Session error' : undefined,
    state: flags.some((f: string) => ['waitingOnApproval', 'waitingOnUserInput'].includes(f)) ? 'waiting'
      : thread.status?.type === 'active' ? 'running' : thread.status?.type === 'idle' ? 'idle'
        : thread.status?.type === 'notLoaded' ? 'saved' : thread.status?.type === 'systemError' ? 'error' : 'unknown' };
}
export function itemFromCodex(item: any): Item | null {
  if (!item?.id || item.type === 'reasoning') return null;
  if (item.type === 'userMessage') {
    const content = item.content ?? [];
    const imageSource = (c: any) => c.type === 'image' ? c.url : c.type === 'localImage' ? c.path : undefined;
    const images = content.map(imageSource).filter((src: unknown) => typeof src === 'string' && src);
    return { id: item.id, kind: 'user', text: content.filter((c: any) => !imageSource(c))
      .map((c: any) => c.text ?? `[${c.type}]`).join('\n'), ...(images.length ? { images } : {}) };
  }
  if (item.type === 'agentMessage' || item.type === 'plan') return { id: item.id, kind: 'assistant', text: item.text ?? '' };
  if (item.type === 'commandExecution') return { id: item.id, kind: 'tool', title: compact(item.command), status: item.status,
    text: String(item.aggregatedOutput ?? '').slice(-32_000) };
  if (item.type === 'fileChange') return { id: item.id, kind: 'tool', title: 'File changes', status: item.status,
    text: (item.changes ?? []).map((c: any) => `${c.path}\n${c.diff ?? ''}`).join('\n').slice(0, 32_000) };
  if (item.type === 'mcpToolCall') return { id: item.id, kind: 'tool', title: `${item.server} · ${item.tool}`, status: item.status,
    text: JSON.stringify(item.result ?? item.error ?? item.arguments ?? {}, null, 2).slice(0, 32_000) };
  return { id: item.id, kind: 'tool', title: item.type, status: item.status,
    text: JSON.stringify(item, null, 2).slice(0, 32_000) };
}

type Entry = { settings: Server; signature: string; controller: AbortController; rpc?: CodexRpc; connecting?: Promise<CodexRpc>;
  projects: Map<string, string>; projectsCheckedAt: number; sessions: Session[]; hasMore: boolean; error?: string; checkedAt: number; refreshing?: Promise<void>;
  subscriptions: Map<string, Promise<void>>; requests: Map<string, { request: Request; message: RpcMessage }> };
type Connector = typeof connectCodex;

export class CodexService extends EventEmitter implements AgentBackend {
  private entries = new Map<string, Entry>();
  constructor(private connector: Connector = connectCodex) { super(); }
  private publish(event: ServerEvent) { this.emit('event', event); }
  sync(servers: Server[]) {
    const ids = new Set(servers.map((s) => s.id));
    for (const [id, entry] of this.entries) if (!ids.has(id)) { entry.controller.abort(); entry.rpc?.close(); this.entries.delete(id); }
    for (const settings of servers) {
      const signature = connectionKey(settings, settings.executablePath || settings.codexPath || 'codex');
      const old = this.entries.get(settings.id);
      if (old?.signature === signature) { old.settings = settings; continue; }
      old?.controller.abort(); old?.rpc?.close();
      this.entries.set(settings.id, { settings, signature, controller: new AbortController(), sessions: [], hasMore: false,
        checkedAt: 0, projects: new Map(), projectsCheckedAt: 0, subscriptions: new Map(), requests: new Map() });
    }
  }
  private entry(id: string) {
    const entry = this.entries.get(id);
    if (!entry) throw new Error('Server not found');
    return entry;
  }
  private async connection(entry: Entry): Promise<CodexRpc> {
    if (entry.rpc) return entry.rpc;
    if (entry.connecting) return entry.connecting;
    entry.connecting = this.connector(entry.settings, entry.controller.signal).then((rpc) => {
      if (entry.controller.signal.aborted) { rpc.close(); throw new Error('Connection canceled'); }
      entry.rpc = rpc; entry.error = undefined;
      rpc.on('event', (event: RpcMessage) => this.event(entry, event));
      rpc.once('disconnected', () => {
        if (entry.rpc !== rpc) return;
        entry.rpc = undefined; entry.subscriptions.clear(); entry.requests.clear();
        entry.error = 'Disconnected from Codex; reconnecting automatically.';
        this.publish({ serverId: entry.settings.id, type: 'disconnected' });
      });
      return rpc;
    }).finally(() => { entry.connecting = undefined; });
    return entry.connecting;
  }
  private event(entry: Entry, message: RpcMessage) {
    const p = message.params ?? {};
    const serverId = entry.settings.id;
    const threadId = p.threadId ?? p.thread?.id;
    if (message.method === 'thread/name/updated' && typeof p.threadName === 'string') {
      for (const session of entry.sessions) if (session.id === threadId) session.name = p.threadName;
    }
    if (message.id !== undefined) {
      const request = describeRequest(message);
      entry.requests.set(request.id, { request, message });
    } else if (message.method === 'serverRequest/resolved') entry.requests.delete(String(p.requestId));
    if (message.method === 'turn/completed') for (const [id, value] of entry.requests) {
      if (value.request.threadId === threadId && value.request.turnId === p.turn?.id) entry.requests.delete(id);
    }
    if (['item/started', 'item/completed'].includes(message.method!)) {
      const item = itemFromCodex(p.item);
      if (item) this.publish({ serverId, threadId, type: 'item', item });
    } else if (['item/agentMessage/delta', 'item/plan/delta', 'item/commandExecution/outputDelta'].includes(message.method!)) {
      this.publish({ serverId, threadId, type: 'delta', itemId: p.itemId, delta: p.delta });
    } else if (threadId || message.method === 'serverRequest/resolved') {
      this.publish({ serverId, threadId, type: 'changed' });
    }
  }
  async refresh(id: string) {
    const entry = this.entry(id);
    if (entry.refreshing) return entry.refreshing;
    entry.refreshing = (async () => {
      try {
        const rpc = await this.connection(entry);
        const response = await rpc.request('thread/list', { limit: 100, sortKey: 'updated_at' });
        const sessions: Session[] = response.data.filter((t: any) => !t.parentThreadId).map(sessionFromThread);
        const directories = [...new Set(sessions.map((s) => s.cwd).filter((cwd) => cwd.startsWith('/') && !cwd.includes('\0')))];
        if (Date.now() - entry.projectsCheckedAt > 60_000 || directories.some((cwd) => !entry.projects.has(cwd))) {
          // Metadata failure must not hide native sessions or change their execution state.
          const paths = await rpc.projectPaths(directories).catch(() => directories.map((cwd) => entry.projects.get(cwd) ?? cwd));
          entry.projects = new Map(directories.map((cwd, i) => [cwd, paths[i] ?? cwd]));
          entry.projectsCheckedAt = Date.now();
        }
        if (entry.rpc !== rpc) throw new Error('Disconnected from Codex; reconnecting automatically.');
        entry.sessions = sessions.map((session) => ({ ...session, projectPath: entry.projects.get(session.cwd) ?? session.cwd }));
        entry.hasMore = !!response.nextCursor; entry.error = undefined;
      } catch (error) { entry.error = (error as Error).message; }
      finally { entry.checkedAt = Date.now(); entry.refreshing = undefined; }
    })();
    return entry.refreshing;
  }
  monitor(): { servers: MonitorServer[] } {
    return { servers: [...this.entries.values()].map((entry) => {
      if (Date.now() - entry.checkedAt > 3000) void this.refresh(entry.settings.id);
      return { id: entry.settings.id, name: entry.settings.name, host: entry.settings.host, username: entry.settings.username,
        port: entry.settings.port, createdAt: entry.settings.createdAt,
        tool: 'codex', toolName: 'Codex',
        state: entry.error ? 'error' : entry.rpc ? 'connected' : 'connecting', error: entry.error, hasMore: entry.hasMore,
        sessions: entry.sessions.map((s) => ({ ...s, state: entry.error ? 'unknown' : s.state })) };
    }) };
  }
  private async subscribe(entry: Entry, threadId: string) {
    const rpc = await this.connection(entry);
    let pending = entry.subscriptions.get(threadId);
    if (!pending) {
      pending = rpc.request('thread/resume', { threadId, excludeTurns: true }).then(() => {});
      entry.subscriptions.set(threadId, pending);
      pending.catch(() => { entry.subscriptions.delete(threadId); });
    }
    await pending;
    return rpc;
  }
  async detail(serverId: string, threadId: string, cursor?: string): Promise<SessionDetail> {
    const entry = this.entry(serverId);
    const rpc = await this.subscribe(entry, threadId);
    const [thread, history, turns] = await Promise.all([
      rpc.request('thread/read', { threadId }),
      rpc.request('thread/items/list', { threadId, limit: 50, sortDirection: 'desc', ...(cursor ? { cursor } : {}) }),
      rpc.request('thread/turns/list', { threadId, limit: 1, sortDirection: 'desc', itemsView: 'notLoaded' }),
    ]);
    const latest = turns.data[0];
    const items: Item[] = history.data.map((v: any) => itemFromCodex(v.item)).filter(Boolean).reverse();
    if (latest?.status === 'failed') items.push({ id: `error-${latest.id}`, kind: 'notice',
      text: `Turn failed: ${latest.error?.message ?? 'Codex could not finish this turn.'}` });
    return { session: sessionFromThread(thread.thread), items,
      toolName: 'Codex', capabilities: { rename: true, images: true, steer: true, models: true, effort: true, interrupt: true },
      nextCursor: history.nextCursor, turnId: latest?.status === 'inProgress' ? latest.id : null,
      requests: [...entry.requests.values()].map((v) => v.request).filter((r) => r.threadId === threadId) };
  }
  async directory(serverId: string, threadId: string, directory: string) {
    const rpc = await this.connection(this.entry(serverId));
    const { thread } = await rpc.request('thread/read', { threadId });
    const path = sessionFilePath(thread.cwd, directory);
    return { cwd: thread.cwd as string, path, ...await rpc.listDirectory(path) };
  }
  async file(serverId: string, threadId: string, filePath: string) {
    const rpc = await this.connection(this.entry(serverId));
    const { thread } = await rpc.request('thread/read', { threadId });
    const path = sessionFilePath(thread.cwd, filePath);
    return { path, data: await rpc.readFile(path) };
  }
  async shell(serverId: string, threadId: string, command: string) {
    const rpc = await this.connection(this.entry(serverId));
    const { thread } = await rpc.request('thread/read', { threadId });
    const cwd = sessionFromThread(thread).cwd;
    if (!cwd.startsWith('/') || cwd.includes('\0')) throw new Error('Session working directory is unavailable');
    // Direct SSH execution: no turn, prompt, or command output is sent to the model.
    return rpc.shell(cwd, command);
  }
  async create(serverId: string, cwd: string) {
    const entry = this.entry(serverId);
    const rpc = await this.connection(entry);
    const result = await rpc.request('thread/start', { cwd });
    const session = sessionFromThread(result.thread);
    entry.subscriptions.set(session.id, Promise.resolve());
    entry.sessions.unshift(session);
    return session;
  }
  async models(serverId: string): Promise<ModelOption[]> {
    const rpc = await this.connection(this.entry(serverId));
    const models: ModelOption[] = [];
    let cursor: string | null = null;
    do {
      const response: { data: any[]; nextCursor?: string | null } = await rpc.request('model/list', {
        limit: 100, includeHidden: false, ...(cursor ? { cursor } : {}),
      });
      for (const model of response.data) if (!model.hidden) models.push({ id: model.model, name: model.displayName || model.model,
        efforts: (model.supportedReasoningEfforts ?? []).map((option: any) => ({ id: option.reasoningEffort, description: option.description ?? '' })),
        ...(model.defaultReasoningEffort ? { defaultEffort: model.defaultReasoningEffort } : {}) });
      cursor = response.nextCursor ?? null;
    } while (cursor);
    return models;
  }
  async input(serverId: string, threadId: string, text: string, turnId?: string, model?: string, effort?: string, attachments?: unknown) {
    const images = imageInputs(attachments);
    if (!text.trim() && !images.length) throw new Error('Enter a message or attach an image.');
    if (turnId && (model || effort)) throw new Error('Models and reasoning effort can only be changed between turns');
    const entry = this.entry(serverId);
    const rpc = await this.subscribe(entry, threadId);
    // Writes are never replayed on reconnect; the native backend arbitrates concurrent clients.
    const input = [...(text.trim() ? [{ type: 'text', text }] : []), ...images.map((url) => ({ type: 'image', url }))];
    return rpc.request(turnId ? 'turn/steer' : 'turn/start', { threadId, input,
      ...(turnId ? { expectedTurnId: turnId } : {}), ...(model ? { model } : {}), ...(effort ? { effort } : {}) });
  }
  async rename(serverId: string, threadId: string, name: string) {
    const entry = this.entry(serverId);
    const rpc = await this.connection(entry);
    await rpc.request('thread/name/set', { threadId, name });
    for (const session of entry.sessions) if (session.id === threadId) session.name = name;
    this.publish({ serverId, threadId, type: 'changed' });
  }
  async interrupt(serverId: string, threadId: string, turnId: string) {
    const rpc = await this.connection(this.entry(serverId));
    return rpc.request('turn/interrupt', { threadId, turnId });
  }
  async answer(serverId: string, threadId: string, id: string, value: unknown) {
    const entry = this.entry(serverId);
    const pending = entry.requests.get(id);
    if (!pending || pending.request.threadId !== threadId) throw new Error('This request has already been resolved');
    if (pending.request.answering) throw new Error('A response is already being sent');
    const result = decision(pending.request, pending.message.params ?? {}, value);
    pending.request.answering = true;
    // Approval IDs belong to this connection. Never reconnect and replay a response on a new one.
    try {
      if (!entry.rpc) throw new Error('Codex disconnected before the answer was sent');
      await entry.rpc.send({ id: pending.message.id, result });
    }
    catch (error) { entry.requests.delete(id); throw error; }
    this.publish({ serverId, threadId, type: 'changed' });
  }
  close() { for (const entry of this.entries.values()) { entry.controller.abort(); entry.rpc?.close(); } this.entries.clear(); }
}
