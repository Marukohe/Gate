import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import { CodexService, itemFromCodex, sessionFromThread } from '../codex.js';
import type { CodexRpc } from '../codex-connection.js';
import type { Server } from '../types.js';

const server: Server = { id: 'server', name: 'Local', host: 'localhost', port: 22, username: 'test', authType: 'password', password: 'secret', createdAt: 1 };
const native = { id: 'native', cwd: '/repo', name: 'Work', preview: 'First message', updatedAt: 1700000000,
  status: { type: 'active', activeFlags: [] }, canAcceptDirectInput: true };
let peer: EventEmitter & { projectPaths: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };
let service: CodexService;
let connect: ReturnType<typeof vi.fn>;
beforeEach(() => {
  peer = Object.assign(new EventEmitter(), {
    projectPaths: vi.fn(async (directories: string[]) => directories),
    request: vi.fn(async (method: string) => {
      if (method === 'thread/list') return { data: [native, { ...native, id: 'child', parentThreadId: native.id }], nextCursor: null };
      if (method === 'thread/start' || method === 'thread/read' || method === 'thread/resume') return { thread: native };
      if (method === 'thread/items/list') return { data: [{ item: { id: 'message', type: 'agentMessage', text: 'Working' } }], nextCursor: 'older' };
      if (method === 'thread/turns/list') return { data: [{ id: 'turn', status: 'inProgress' }] };
      return {};
    }), send: vi.fn(async () => {}), close: vi.fn(),
  });
  connect = vi.fn(async () => peer as unknown as CodexRpc);
  service = new CodexService(connect); service.sync([server]);
});
afterEach(() => service.close());

it('lists native sessions without resuming, creating, or starting a turn', async () => {
  await Promise.all([service.refresh(server.id), service.refresh(server.id)]);
  const snapshot = service.monitor();
  expect(snapshot.servers[0]).toMatchObject({ state: 'connected', sessions: [{ id: 'native', state: 'running' }] });
  expect(snapshot.servers[0].sessions).toHaveLength(1);
  expect(JSON.stringify(snapshot)).not.toContain('secret');
  expect(connect).toHaveBeenCalledTimes(1);
  expect(peer.request.mock.calls.map(([method]) => method)).toEqual(['thread/list']);
});

it('uses one backend for creation, continuation, steering, and interruption', async () => {
  await service.create(server.id, '/repo');
  await service.input(server.id, 'native', 'First');
  await service.input(server.id, 'native', 'Update', 'turn');
  await service.interrupt(server.id, 'native', 'turn');
  expect(connect).toHaveBeenCalledTimes(1);
  expect(peer.request.mock.calls).toEqual([
    ['thread/start', { cwd: '/repo' }],
    ['turn/start', { threadId: 'native', input: [{ type: 'text', text: 'First' }] }],
    ['turn/steer', { threadId: 'native', input: [{ type: 'text', text: 'Update' }], expectedTurnId: 'turn' }],
    ['turn/interrupt', { threadId: 'native', turnId: 'turn' }],
  ]);
});

it('opens the existing thread once and reads paginated native history', async () => {
  const [a, b] = await Promise.all([service.detail(server.id, 'native'), service.detail(server.id, 'native')]);
  expect(a).toEqual(b);
  expect(a).toMatchObject({ session: { id: 'native' }, items: [{ id: 'message', text: 'Working' }], turnId: 'turn', nextCursor: 'older' });
  expect(peer.request.mock.calls.filter(([m]) => m === 'thread/resume')).toHaveLength(1);
  expect(peer.request.mock.calls.some(([m]) => m === 'turn/start')).toBe(false);
});

it('loads the native model catalog across pages and sends model slugs only on new turns', async () => {
  peer.request.mockResolvedValueOnce({ data: [
    { id: 'catalog-one', model: 'model-one', displayName: 'Model One', hidden: false },
    { id: 'hidden', model: 'hidden', hidden: true },
  ], nextCursor: 'next-models' }).mockResolvedValueOnce({ data: [
    { id: 'catalog-two', model: 'model-two', displayName: 'Model Two', defaultReasoningEffort: 'high',
      supportedReasoningEfforts: [{ reasoningEffort: 'high', description: 'Think deeply' }] },
  ], nextCursor: null });
  expect(await service.models(server.id)).toEqual([{ id: 'model-one', name: 'Model One', efforts: [] },
    { id: 'model-two', name: 'Model Two', defaultEffort: 'high', efforts: [{ id: 'high', description: 'Think deeply' }] }]);
  expect(peer.request).toHaveBeenCalledWith('model/list', { limit: 100, includeHidden: false, cursor: 'next-models' });
  await service.input(server.id, 'native', 'Use another model', undefined, 'model-two', 'high');
  expect(peer.request).toHaveBeenLastCalledWith('turn/start', { threadId: 'native', input: [{ type: 'text', text: 'Use another model' }], model: 'model-two', effort: 'high' });
  await service.input(server.id, 'native', 'Think harder', undefined, undefined, 'high');
  expect(peer.request).toHaveBeenLastCalledWith('turn/start', { threadId: 'native', input: [{ type: 'text', text: 'Think harder' }], effort: 'high' });
  peer.request.mockClear();
  await expect(service.input(server.id, 'native', 'Steer', 'turn', 'model-two')).rejects.toThrow('between turns');
  await expect(service.input(server.id, 'native', 'Steer', 'turn', undefined, 'high')).rejects.toThrow('between turns');
  expect(peer.request).not.toHaveBeenCalled();
  expect(sessionFromThread({ ...native, model: 'model-two' }).model).toBe('model-two');
  expect(sessionFromThread({ ...native, reasoningEffort: 'high' }).effort).toBe('high');
});

it('renames through native metadata without starting a turn and reflects other clients', async () => {
  await service.refresh(server.id);
  peer.request.mockClear();
  await service.rename(server.id, 'native', 'Fix login');
  expect(peer.request.mock.calls).toEqual([['thread/name/set', { threadId: 'native', name: 'Fix login' }]]);
  expect(service.monitor().servers[0].sessions[0].name).toBe('Fix login');
  peer.emit('event', { method: 'thread/name/updated', params: { threadId: 'native', threadName: 'From terminal' } });
  expect(service.monitor().servers[0].sessions[0].name).toBe('From terminal');
  peer.request.mockRejectedValueOnce(new Error('Connection lost'));
  await expect(service.rename(server.id, 'native', 'Unconfirmed')).rejects.toThrow('Connection lost');
  expect(service.monitor().servers[0].sessions[0].name).toBe('From terminal');
});

it('arbitrates browser answers and clears decisions resolved by another native client', async () => {
  await service.refresh(server.id);
  peer.emit('event', { id: 1, method: 'item/commandExecution/requestApproval', params: { threadId: 'native', turnId: 'turn', command: 'make test', availableDecisions: ['accept', 'decline'] } });
  expect((await service.detail(server.id, 'native')).requests).toMatchObject([{ id: '1', kind: 'approval' }]);
  await expect(service.answer(server.id, 'native', '1', { decision: 'acceptForSession' })).rejects.toThrow('offered');
  const results = await Promise.allSettled([
    service.answer(server.id, 'native', '1', { decision: 'accept' }),
    service.answer(server.id, 'native', '1', { decision: 'decline' }),
  ]);
  expect(results.map((r) => r.status)).toEqual(['fulfilled', 'rejected']);
  expect(peer.send).toHaveBeenCalledTimes(1);
  peer.emit('event', { method: 'serverRequest/resolved', params: { threadId: 'native', requestId: 1 } });
  expect((await service.detail(server.id, 'native')).requests).toEqual([]);
});

it('retains unknown snapshots after a disconnect and never replays user input', async () => {
  await service.refresh(server.id);
  await service.input(server.id, 'native', 'Once');
  peer.emit('disconnected');
  expect(service.monitor().servers[0]).toMatchObject({ state: 'error', sessions: [{ state: 'unknown' }] });
  await service.refresh(server.id);
  expect(peer.request.mock.calls.filter(([m]) => m === 'turn/start')).toHaveLength(1);
  expect(service.monitor().servers[0].state).toBe('connected');
});

it('shows waiting state, caps tool output, and omits reasoning from messages', () => {
  expect(sessionFromThread({ ...native, status: { type: 'active', activeFlags: ['waitingOnApproval'] } }).state).toBe('waiting');
  expect(sessionFromThread({ ...native, status: { type: 'active', activeFlags: ['waitingOnApproval'] } }).attentionReason).toBe('Waiting for approval');
  expect(sessionFromThread({ ...native, status: { type: 'active', activeFlags: ['waitingOnUserInput'] } }).attentionReason).toBe('Waiting for your answer');
  expect(sessionFromThread({ ...native, status: { type: 'systemError' } }).attentionReason).toBe('Session error');
  expect(itemFromCodex({ type: 'reasoning', id: 'hidden', content: ['private'] })).toBeNull();
  expect(itemFromCodex({ type: 'commandExecution', id: 'tool', command: 'test', aggregatedOutput: 'x'.repeat(100_000) })?.text).toHaveLength(32_000);
});

it('shows native turn failures instead of leaving an unexplained empty response', async () => {
  const request = peer.request.getMockImplementation()!;
  peer.request.mockImplementation(async (method: string) => method === 'thread/turns/list'
    ? { data: [{ id: 'failed-turn', status: 'failed', error: { message: 'Provider unavailable' } }] }
    : request(method));
  expect(await service.detail(server.id, 'native')).toMatchObject({ turnId: null,
    items: [{ text: 'Working' }, { kind: 'notice', text: 'Turn failed: Provider unavailable' }] });
});

it('caches project metadata and keeps sessions visible when directory lookup fails', async () => {
  peer.projectPaths.mockResolvedValue(['/repo-root']);
  await service.refresh(server.id); await service.refresh(server.id);
  expect(peer.projectPaths).toHaveBeenCalledTimes(1);
  expect(service.monitor().servers[0].sessions[0].projectPath).toBe('/repo-root');
  service.sync([{ ...server, name: 'Changed connection' }]);
  peer.projectPaths.mockRejectedValue(new Error('Git unavailable'));
  await service.refresh(server.id);
  expect(service.monitor().servers[0]).toMatchObject({ state: 'connected', sessions: [{ projectPath: '/repo' }] });
});

it('does not report stale running status when SSH disconnects during project lookup', async () => {
  await service.refresh(server.id);
  peer.request.mockResolvedValueOnce({ data: [{ ...native, cwd: '/new-directory' }], nextCursor: null });
  peer.projectPaths.mockImplementation(async () => { peer.emit('disconnected'); throw new Error('SSH closed'); });
  await service.refresh(server.id);
  expect(service.monitor().servers[0]).toMatchObject({ state: 'error', sessions: [{ cwd: '/repo', state: 'unknown' }] });
});
