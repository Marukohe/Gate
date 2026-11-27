import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { connectAgy, type AcpMessage, type AcpRpc } from './connection.js';
import type { AgentBackend } from '../backend.js';
import { imageInputs } from '../../images.js';
import { sessionFilePath } from '../../session-files.js';
import { connectionKey } from '../../ssh.js';
import type { Item, ModelOption, MonitorServer, Request, Server, ServerEvent, Session, SessionDetail } from '../../types.js';

const statusNote = 'Live status covers work started through this Gate connection. ACP does not report activity in other terminal clients.';
const choices = (option: any): any[] => (option?.options ?? []).flatMap((entry: any) => entry.options ?? [entry]);
const compact = (value: unknown, max = 200) => String(value ?? '').replace(/\s+/g, ' ').trim().slice(0, max);
const time = (value: unknown) => typeof value === 'string' ? Date.parse(value) || 0 : 0;
type Cache = { items: Item[]; version: string; config: any[]; legacyModels: any; turnId: string | null;
  replaying: boolean; sequence: number; lastMessage?: string; skipUserEcho: boolean; dirty: boolean };
type Entry = { settings: Server; signature: string; controller: AbortController; rpc?: AcpRpc; connecting?: Promise<AcpRpc>;
  sessions: Session[]; cache: Map<string, Cache>; loading: Map<string, Promise<Cache>>; requests: Map<string, { request: Request; message: AcpMessage }>;
  projects: Map<string, string>; projectsAt: number; checkedAt: number; refreshing?: Promise<void>; hasMore: boolean; error?: string };

export class AgyService extends EventEmitter implements AgentBackend {
  private entries = new Map<string, Entry>();
  constructor(private connector = connectAgy) { super(); }
  private publish(entry: Entry, threadId?: string, item?: Item) {
    this.emit('event', { serverId: entry.settings.id, threadId, type: item ? 'item' : 'changed', ...(item ? { item } : {}) } satisfies ServerEvent);
  }
  sync(servers: Server[]) {
    const ids = new Set(servers.map((server) => server.id));
    for (const [id, entry] of this.entries) if (!ids.has(id)) { entry.controller.abort(); entry.rpc?.close(); this.entries.delete(id); }
    for (const settings of servers) {
      const signature = connectionKey(settings, settings.executablePath || 'agy'); const old = this.entries.get(settings.id);
      if (old?.signature === signature) { old.settings = settings; continue; }
      old?.controller.abort(); old?.rpc?.close();
      this.entries.set(settings.id, { settings, signature, controller: new AbortController(), sessions: [], cache: new Map(), loading: new Map(),
        requests: new Map(), projects: new Map(), projectsAt: 0, checkedAt: 0, hasMore: false });
    }
  }
  private entry(id: string) { const entry = this.entries.get(id); if (!entry) throw new Error('Server not found'); return entry; }
  private async connection(entry: Entry): Promise<AcpRpc> {
    if (entry.rpc) return entry.rpc;
    if (entry.connecting) return entry.connecting;
    entry.connecting = this.connector(entry.settings, entry.controller.signal).then((rpc) => {
      if (entry.controller.signal.aborted) { rpc.close(); throw new Error('Connection canceled'); }
      entry.rpc = rpc; entry.error = undefined;
      rpc.on('event', (message: AcpMessage) => this.event(entry, rpc, message));
      rpc.once('disconnected', () => {
        if (entry.rpc !== rpc) return;
        entry.rpc = undefined; entry.cache.clear(); entry.loading.clear(); entry.requests.clear();
        entry.error = 'Disconnected from Antigravity. Inputs are not replayed; check the session before sending again.';
        entry.sessions = entry.sessions.map((session) => ({ ...session, state: 'unknown' }));
        this.emit('event', { serverId: entry.settings.id, type: 'disconnected' } satisfies ServerEvent);
      });
      return rpc;
    }).finally(() => { entry.connecting = undefined; });
    return entry.connecting;
  }
  private session(entry: Entry, id: string) {
    const session = entry.sessions.find((session) => session.id === id);
    if (!session) throw new Error('Session not found'); return session;
  }
  private setItem(entry: Entry, id: string, item: Item) {
    const cache = entry.cache.get(id); if (!cache) return;
    const index = cache.items.findIndex((current) => current.id === item.id);
    if (index < 0) cache.items.push(item); else cache.items[index] = item;
    if (!cache.replaying) this.publish(entry, id, item);
  }
  private configure(entry: Entry, id: string, result: any) {
    const cache = entry.cache.get(id); if (!cache) return;
    if (Array.isArray(result.configOptions)) cache.config = result.configOptions;
    if (result.models) cache.legacyModels = result.models;
    const session = this.session(entry, id);
    session.model = cache.config.find((c) => c.category === 'model')?.currentValue ?? cache.legacyModels?.currentModelId;
    session.effort = cache.config.find((c) => c.category === 'thought_level')?.currentValue;
  }
  private event(entry: Entry, rpc: AcpRpc, message: AcpMessage) {
    if (entry.rpc !== rpc) return;
    const p = message.params ?? {}; const id = p.sessionId; const cache = entry.cache.get(id);
    if (message.id !== undefined) {
      if (message.method === 'session/request_permission' && cache) {
        const options = (p.options ?? []).filter((option: any) => typeof option.optionId === 'string');
        const request: Request = { id: String(message.id), threadId: id, turnId: cache.turnId ?? undefined, method: message.method,
          kind: 'approval', title: compact(p.toolCall?.title || 'Allow this action?'), detail: JSON.stringify(p.toolCall?.rawInput ?? {}, null, 2).slice(0, 32_000),
          choices: options.map((option: any) => option.optionId), choiceLabels: Object.fromEntries(options.map((option: any) => [option.optionId, option.name])),
          questions: [], answering: false };
        entry.requests.set(request.id, { request, message }); this.session(entry, id).state = 'waiting'; this.publish(entry, id);
      } else void rpc.send({ id: message.id, error: { code: -32601, message: 'Client method not supported' } }).catch(() => {});
      return;
    }
    if (message.method !== 'session/update' || !cache) return;
    const update = p.update ?? {}; const kind = update.sessionUpdate;
    if (kind === 'config_option_update') { this.configure(entry, id, update); this.publish(entry, id); return; }
    if (kind === 'session_info_update') {
      if (typeof update.title === 'string') this.session(entry, id).name = compact(update.title, 1000);
      this.publish(entry, id); return;
    }
    if (kind === 'agent_thought_chunk' || kind === 'available_commands_update' || kind === 'usage_update') return;
    if (kind === 'user_message_chunk' || kind === 'agent_message_chunk') {
      if (kind === 'user_message_chunk' && cache.skipUserEcho && !cache.replaying) return;
      if (kind === 'agent_message_chunk') cache.skipUserEcho = false;
      const role = kind === 'user_message_chunk' ? 'user' : 'assistant';
      const last = cache.items.find((item) => item.id === cache.lastMessage);
      const itemId = update.messageId ? `message-${update.messageId}` : !cache.replaying && role === 'assistant' && last?.kind === role
        ? last.id : `message-${++cache.sequence}`;
      const previous = cache.items.find((item) => item.id === itemId);
      const content = update.content ?? {};
      const images = content.type === 'image' && content.data && content.mimeType
        ? [`data:${content.mimeType};base64,${content.data}`] : [];
      const text = content.type === 'text' ? content.text ?? '' : images.length ? '' : `[${content.type ?? 'content'}]`;
      this.setItem(entry, id, { id: itemId, kind: role, text: ((previous?.text ?? '') + text).slice(-200_000),
        ...((previous?.images?.length || images.length) ? { images: [...(previous?.images ?? []), ...images] } : {}) });
      cache.lastMessage = itemId; return;
    }
    if (kind === 'tool_call' || kind === 'tool_call_update') {
      cache.lastMessage = undefined; cache.skipUserEcho = false;
      const itemId = `tool-${update.toolCallId}`; const previous = cache.items.find((item) => item.id === itemId);
      const content = update.content?.map((part: any) => part.type === 'diff' ? `${part.path}\n${part.newText ?? ''}`
        : part.content?.text ?? '').filter(Boolean).join('\n');
      const output = content || (update.rawOutput !== undefined ? JSON.stringify(update.rawOutput, null, 2) : undefined);
      this.setItem(entry, id, { id: itemId, kind: 'tool', title: compact(update.title ?? previous?.title ?? 'Tool'),
        status: update.status ?? previous?.status, text: String(output ?? previous?.text ?? '').slice(-32_000) });
    } else if (kind === 'plan') {
      this.setItem(entry, id, { id: `plan-${cache.turnId ?? cache.sequence}`, kind: 'tool', title: 'Plan',
        text: (update.entries ?? []).map((step: any) => `[${step.status}] ${step.content}`).join('\n').slice(0, 32_000) });
    }
  }
  async refresh(id: string) {
    const entry = this.entry(id); if (entry.refreshing) return entry.refreshing;
    entry.refreshing = (async () => {
      try {
        const rpc = await this.connection(entry); const records: any[] = []; const seen = new Set<string>(); let cursor: string | undefined;
        do {
          const response = await rpc.request('session/list', cursor ? { cursor } : {});
          records.push(...(response.sessions ?? [])); cursor = response.nextCursor || undefined;
          if (cursor && seen.has(cursor)) throw new Error('ACP returned a repeated session cursor');
          if (cursor) seen.add(cursor);
        } while (cursor && records.length < 100);
        const directories = [...new Set([...records.slice(0, 100).map((record) => record.cwd),
          ...entry.sessions.filter((session) => entry.cache.has(session.id)).map((session) => session.cwd)]
          .filter((cwd): cwd is string => typeof cwd === 'string' && cwd.startsWith('/') && !cwd.includes('\0')))];
        if (Date.now() - entry.projectsAt > 60_000 || directories.some((cwd) => !entry.projects.has(cwd))) {
          const paths = await rpc.projectPaths(directories).catch(() => directories);
          entry.projects = new Map(directories.map((cwd, i) => [cwd, paths[i] || cwd])); entry.projectsAt = Date.now();
        }
        if (entry.rpc !== rpc) throw new Error('ACP disconnected during refresh');
        // Merge live state after SSH metadata finishes; permissions and turns may change while it is in flight.
        const sessions = records.slice(0, 100).map((record): Session => {
          const old = entry.sessions.find((session) => session.id === record.sessionId); const cache = entry.cache.get(record.sessionId);
          const updatedAt = time(record.updatedAt);
          if (cache && old && updatedAt > old.updatedAt && !cache.turnId && old.state !== 'error') cache.dirty = true;
          return { ...old, id: record.sessionId, cwd: record.cwd ?? '', name: record.title || record.cwd?.split('/').at(-1) || 'Session',
            preview: '', updatedAt: updatedAt || old?.updatedAt || Date.now(), state: cache?.turnId ? old?.state ?? 'running'
              : cache && !cache.dirty ? old?.state ?? 'saved' : 'saved', canInput: true };
        });
        // Newly created empty sessions may not appear in the native list until their first prompt.
        for (const old of entry.sessions) if (entry.cache.has(old.id) && !sessions.some((session) => session.id === old.id)) sessions.push(old);
        entry.sessions = sessions.map((session) => ({ ...session, projectPath: entry.projects.get(session.cwd) || session.cwd }));
        entry.hasMore = !!cursor || records.length > 100; entry.error = undefined;
      } catch (error) { entry.error = (error as Error).message; }
      finally { entry.checkedAt = Date.now(); entry.refreshing = undefined; }
    })(); return entry.refreshing;
  }
  monitor(): { servers: MonitorServer[] } {
    return { servers: [...this.entries.values()].map((entry) => {
      if (Date.now() - entry.checkedAt > 3000) void this.refresh(entry.settings.id);
      return { id: entry.settings.id, name: entry.settings.name, host: entry.settings.host, username: entry.settings.username,
        port: entry.settings.port, createdAt: entry.settings.createdAt,
        tool: 'agy', toolName: 'Antigravity', statusNote, state: entry.error ? 'error' : entry.rpc ? 'connected' : 'connecting', error: entry.error,
        hasMore: entry.hasMore, sessions: entry.sessions.map((session) => ({ ...session, state: entry.error ? 'unknown' : session.state })) };
    }) };
  }
  private fresh(): Cache { return { items: [], version: randomUUID(), config: [], legacyModels: null, turnId: null, replaying: true, sequence: 0, skipUserEcho: false, dirty: false }; }
  private async load(entry: Entry, id: string): Promise<Cache> {
    if (entry.loading.has(id)) return entry.loading.get(id)!;
    const cached = entry.cache.get(id); if (cached && !cached.dirty) return cached;
    const pending = (async () => {
      const rpc = await this.connection(entry);
      if (!entry.sessions.some((session) => session.id === id)) await this.refresh(entry.settings.id);
      const session = this.session(entry, id); const cache = this.fresh(); entry.cache.set(id, cache);
      try {
        const result = await rpc.request('session/load', { sessionId: id, cwd: session.cwd, mcpServers: [] });
        if (entry.rpc !== rpc) throw new Error('ACP disconnected during history load');
        this.configure(entry, id, result); this.session(entry, id).state = 'saved';
        cache.replaying = false; cache.lastMessage = undefined; return cache;
      } catch (error) { if (entry.cache.get(id) === cache) entry.cache.delete(id); throw error; }
    })();
    entry.loading.set(id, pending);
    try { return await pending; } finally { if (entry.loading.get(id) === pending) entry.loading.delete(id); }
  }
  async detail(serverId: string, id: string, cursor?: string): Promise<SessionDetail> {
    const entry = this.entry(serverId); const cache = await this.load(entry, id);
    if (cursor && !/^\d+$/.test(cursor)) throw new Error('Invalid history cursor');
    const end = cursor ? Math.min(Number(cursor), cache.items.length) : cache.items.length; const start = Math.max(0, end - 50);
    return { session: { ...this.session(entry, id) }, items: cache.items.slice(start, end), nextCursor: start ? String(start) : null,
      turnId: cache.turnId, requests: [...entry.requests.values()].map((value) => value.request).filter((request) => request.threadId === id),
      historyVersion: cache.version, toolName: 'Antigravity',
      statusNote: `${statusNote} agy currently omits image attachments when reloading native history after reconnecting.`,
      capabilities: { rename: false, images: !!entry.rpc?.capabilities.promptCapabilities?.image, steer: false,
        models: cache.config.some((c) => c.category === 'model') || !!cache.legacyModels, effort: cache.config.some((c) => c.category === 'thought_level'), interrupt: true } };
  }
  async create(serverId: string, cwd: string) {
    const entry = this.entry(serverId); const rpc = await this.connection(entry);
    const result = await rpc.request('session/new', { cwd, mcpServers: [] });
    const session: Session = { id: result.sessionId, name: cwd.split('/').at(-1) || 'New session', cwd, preview: '', updatedAt: Date.now(), state: 'idle', canInput: true };
    entry.sessions.unshift(session); const cache = this.fresh(); cache.replaying = false; entry.cache.set(session.id, cache);
    this.configure(entry, session.id, result); return session;
  }
  async models(serverId: string, id?: string): Promise<ModelOption[]> {
    if (!id) return [];
    const entry = this.entry(serverId); const cache = await this.load(entry, id);
    const model = cache.config.find((c) => c.category === 'model'); const effort = cache.config.find((c) => c.category === 'thought_level');
    if (!model) return (cache.legacyModels?.availableModels ?? []).map((m: any) => ({ id: m.modelId, name: m.name, efforts: [] }));
    return choices(model).map((m) => ({ id: m.value, name: m.name, efforts: choices(effort)
      .filter((e) => m.value === model.currentValue || cache.legacyModels?.availableModels?.some((native: any) => native.modelId === `${m.value}-${e.value}`))
      .map((e) => ({ id: e.value, description: e.name })), ...(m.value === model.currentValue ? { defaultEffort: effort?.currentValue } : {}) }));
  }
  async input(serverId: string, id: string, text: string, turnId?: string, model?: string, effort?: string, attachments?: unknown) {
    const images = imageInputs(attachments); if (!text.trim() && !images.length) throw new Error('Enter a message or attach an image.');
    const entry = this.entry(serverId); const cache = await this.load(entry, id); const rpc = await this.connection(entry);
    if (entry.cache.get(id) !== cache) throw new Error('Connection changed. Check the session before sending again.');
    if (turnId || cache.turnId) throw new Error('Antigravity cannot accept updates during a running turn. Wait for it to finish or stop it first.');
    if (images.length && !rpc.capabilities.promptCapabilities?.image) throw new Error('This agent does not support image input.');
    const session = this.session(entry, id); cache.turnId = randomUUID(); session.state = 'running';
    try {
      if (model) {
        const option = cache.config.find((c) => c.category === 'model');
        if (option) {
          if (!choices(option).some((choice) => choice.value === model)) throw new Error('Model is not offered by this agent');
          this.configure(entry, id, await rpc.request('session/set_config_option', { sessionId: id, configId: option.id, value: model }));
        } else {
          if (!cache.legacyModels?.availableModels?.some((m: any) => m.modelId === model)) throw new Error('Model is not offered by this agent');
          await rpc.request('session/set_model', { sessionId: id, modelId: model }); session.model = model;
        }
      }
      if (effort) {
        const option = cache.config.find((c) => c.category === 'thought_level');
        if (!choices(option).some((choice) => choice.value === effort)) throw new Error('Reasoning effort is not offered for this model');
        this.configure(entry, id, await rpc.request('session/set_config_option', { sessionId: id, configId: option.id, value: effort }));
      }
    } catch (error) { cache.turnId = null; if (entry.rpc === rpc) this.session(entry, id).state = 'idle'; this.publish(entry, id); throw error; }
    const active = cache.turnId; cache.lastMessage = undefined; cache.skipUserEcho = true;
    this.session(entry, id).updatedAt = Date.now();
    this.setItem(entry, id, { id: `message-${++cache.sequence}`, kind: 'user', text, ...(images.length ? { images } : {}) });
    const prompt = [...(text.trim() ? [{ type: 'text', text }] : []), ...images.map((url) => {
      const split = url.indexOf(','); return { type: 'image', mimeType: url.slice(5, url.indexOf(';')), data: url.slice(split + 1) };
    })];
    this.publish(entry, id);
    // ACP replies only when the turn finishes. HTTP acknowledges acceptance while events carry progress.
    void rpc.request('session/prompt', { sessionId: id, prompt }, 0).then(() => {
      if (entry.rpc === rpc) this.session(entry, id).state = 'idle';
    }).catch((error) => {
      if (entry.rpc !== rpc) return;
      this.session(entry, id).state = 'error';
      this.setItem(entry, id, { id: `error-${active}`, kind: 'notice', text: `Turn failed: ${(error as Error).message}` });
    }).finally(() => {
      if (entry.rpc !== rpc) return;
      cache.turnId = null; cache.lastMessage = undefined; cache.skipUserEcho = false;
      this.session(entry, id).updatedAt = Date.now();
      for (const [key, pending] of entry.requests) if (pending.request.threadId === id) entry.requests.delete(key);
      this.publish(entry, id);
    });
    return { turnId: active };
  }
  async interrupt(serverId: string, id: string, turnId: string) {
    const entry = this.entry(serverId); const cache = entry.cache.get(id);
    if (!entry.rpc || !cache?.turnId || cache.turnId !== turnId) throw new Error('This turn is no longer active on this connection');
    await entry.rpc.send({ method: 'session/cancel', params: { sessionId: id } });
    for (const [key, pending] of entry.requests) if (pending.request.threadId === id) {
      await entry.rpc.send({ id: pending.message.id, result: { outcome: { outcome: 'cancelled' } } }); entry.requests.delete(key);
    }
    return { sent: true };
  }
  async answer(serverId: string, id: string, requestId: string, value: unknown) {
    const entry = this.entry(serverId); const pending = entry.requests.get(requestId); const choice = (value as any)?.decision;
    if (!entry.rpc || !pending || pending.request.threadId !== id) throw new Error('This request has already been resolved');
    if (pending.request.answering) throw new Error('A response is already being sent');
    if (!pending.request.choices.includes(choice)) throw new Error('Choose an option offered by the agent');
    pending.request.answering = true;
    try { await entry.rpc.send({ id: pending.message.id, result: { outcome: { outcome: 'selected', optionId: choice } } }); }
    finally { entry.requests.delete(requestId); }
    this.session(entry, id).state = [...entry.requests.values()].some((p) => p.request.threadId === id) ? 'waiting' : 'running';
    this.publish(entry, id);
  }
  async rename(_serverId: string, _id: string, _name: string): Promise<void> { throw new Error('Antigravity ACP does not offer session renaming.'); }
  async directory(serverId: string, id: string, directory: string) {
    const entry = this.entry(serverId); const rpc = await this.connection(entry);
    if (!entry.sessions.some((session) => session.id === id)) await this.refresh(serverId);
    const cwd = this.session(entry, id).cwd;
    const path = sessionFilePath(cwd, directory);
    return { cwd, path, ...await rpc.listDirectory(path) };
  }
  async file(serverId: string, id: string, filePath: string) {
    const entry = this.entry(serverId); const rpc = await this.connection(entry);
    if (!entry.sessions.some((session) => session.id === id)) await this.refresh(serverId);
    const path = sessionFilePath(this.session(entry, id).cwd, filePath); return { path, data: await rpc.readFile(path) };
  }
  async shell(serverId: string, id: string, command: string) {
    const entry = this.entry(serverId); const rpc = await this.connection(entry);
    if (!entry.sessions.some((session) => session.id === id)) await this.refresh(serverId);
    const cwd = this.session(entry, id).cwd;
    if (!cwd.startsWith('/') || cwd.includes('\0')) throw new Error('Session working directory is unavailable');
    return rpc.shell(cwd, command);
  }
  close() { for (const entry of this.entries.values()) { entry.controller.abort(); entry.rpc?.close(); } this.entries.clear(); }
}
