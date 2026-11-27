import { EventEmitter } from 'node:events';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { AgyService } from '../backend.js';
import type { AcpRpc } from '../connection.js';
import type { Server } from '../../../types.js';

const server: Server = { id: 'agy', name: 'AGY', tool: 'agy', host: 'localhost', port: 22, username: 'user', authType: 'password', createdAt: 1 };
const config = [
  { id: 'model', category: 'model', currentValue: 'vision', options: [{ value: 'vision', name: 'Vision' }] },
  { id: 'thought_level', category: 'thought_level', currentValue: 'high', options: [{ value: 'low', name: 'Low' }, { value: 'high', name: 'High' }] },
];
let peer: EventEmitter & { listDirectory: ReturnType<typeof vi.fn>; request: ReturnType<typeof vi.fn>; send: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn>;
  projectPaths: (paths: string[]) => Promise<string[]> };
let service: AgyService;
let resolvePrompt: (value: unknown) => void;
const emit = (update: object) => peer.emit('event', { method: 'session/update', params: { sessionId: 'native', update } });
beforeEach(() => {
  peer = Object.assign(new EventEmitter(), {
    capabilities: { promptCapabilities: { image: true } }, projectPaths: async (paths: string[]) => paths,
    listDirectory: vi.fn(async () => ({ entries: [], truncated: false })),
    readFile: vi.fn(async () => Buffer.from('remote')), shell: vi.fn(async () => ({ stdout: '/repo', exitCode: 0 })),
    send: vi.fn(async () => {}), close: vi.fn(),
    request: vi.fn(async (method: string, params: any) => {
      if (method === 'session/list') return { sessions: [{ sessionId: 'native', cwd: '/repo', title: 'Existing', updatedAt: '2026-11-25T00:00:00Z' }] };
      if (method === 'session/load') {
        for (let n = 0; n < 60; n++) emit({ sessionUpdate: n % 2 ? 'agent_message_chunk' : 'user_message_chunk', content: { type: 'text', text: `History ${n}` } });
        return { configOptions: structuredClone(config) };
      }
      if (method === 'session/prompt') return new Promise(resolve => { resolvePrompt = resolve; });
      if (method === 'session/set_config_option') return { configOptions: config.map(option => option.id === params.configId ? { ...option, currentValue: params.value } : option) };
      return {};
    }),
  });
  service = new AgyService(async () => peer as unknown as AcpRpc); service.sync([server]);
});
afterEach(() => service.close());

it('lists saved native sessions without running work, shares one load, and pages replayed history', async () => {
  await service.refresh(server.id);
  expect(service.monitor().servers[0]).toMatchObject({ tool: 'agy', state: 'connected', sessions: [{ state: 'saved' }] });
  expect(peer.request.mock.calls.map(([method]) => method)).toEqual(['session/list']);
  const [detail, models] = await Promise.all([service.detail(server.id, 'native'), service.models(server.id, 'native')]);
  expect(peer.request.mock.calls.filter(([method]) => method === 'session/load')).toHaveLength(1);
  expect(detail.items).toHaveLength(50); expect(detail.nextCursor).toBe('10');
  expect((await service.detail(server.id, 'native', '10')).items).toHaveLength(10);
  expect(detail.capabilities).toMatchObject({ steer: false, rename: false, images: true });
  expect(models).toMatchObject([{ id: 'vision', efforts: [{ id: 'low' }, { id: 'high' }] }]);
  expect(peer.request.mock.calls.some(([method]) => method === 'session/prompt')).toBe(false);
});

it('streams one prompt, exposes native approval choices, and remains correct across monitor refreshes', async () => {
  await service.refresh(server.id);
  const started = await service.input(server.id, 'native', 'Work', undefined, 'vision', 'low') as { turnId: string };
  expect((await service.detail(server.id, 'native')).session.state).toBe('running');
  expect(peer.request).toHaveBeenCalledWith('session/set_config_option', { sessionId: 'native', configId: 'thought_level', value: 'low' });
  emit({ sessionUpdate: 'user_message_chunk', content: { type: 'text', text: 'Work' } });
  emit({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Hel' } });
  emit({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'lo' } });
  let detail = await service.detail(server.id, 'native');
  expect(detail.items.filter(item => item.text === 'Work')).toHaveLength(1);
  expect(detail.items.at(-1)?.text).toBe('Hello');
  peer.emit('event', { id: 5, method: 'session/request_permission', params: { sessionId: 'native', toolCall: { title: 'Run a command', rawInput: { command: 'pwd' } },
    options: [{ optionId: 'allow-once', name: 'Allow once', kind: 'allow_once' }, { optionId: 'reject-once', name: 'Reject', kind: 'reject_once' }] } });
  detail = await service.detail(server.id, 'native'); expect(detail.session.state).toBe('waiting');
  expect(detail.requests[0].choiceLabels).toEqual({ 'allow-once': 'Allow once', 'reject-once': 'Reject' });
  await expect(service.answer(server.id, 'native', '5', { decision: 'allow-always' })).rejects.toThrow('offered');
  await service.answer(server.id, 'native', '5', { decision: 'allow-once' });
  expect(peer.send).toHaveBeenCalledWith({ id: 5, result: { outcome: { outcome: 'selected', optionId: 'allow-once' } } });
  await expect(service.input(server.id, 'native', 'Again')).rejects.toThrow('running turn');
  await service.refresh(server.id);
  await service.interrupt(server.id, 'native', started.turnId);
  expect(peer.send).toHaveBeenCalledWith({ method: 'session/cancel', params: { sessionId: 'native' } });
  resolvePrompt({ stopReason: 'cancelled' }); await new Promise(resolve => setTimeout(resolve, 0));
  expect(await service.detail(server.id, 'native')).toMatchObject({ turnId: null, session: { state: 'idle' }, requests: [] });
  expect(peer.request.mock.calls.filter(([method]) => method === 'session/prompt')).toHaveLength(1);
});

it('passes images natively and drops stale approvals/history IDs on reconnect without replaying input', async () => {
  const image = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  await service.refresh(server.id); const previous = await service.detail(server.id, 'native');
  await service.input(server.id, 'native', '', undefined, undefined, undefined, [image]);
  expect(peer.request).toHaveBeenCalledWith('session/prompt', { sessionId: 'native', prompt: [{ type: 'image', mimeType: 'image/png', data: image.split(',')[1] }] }, 0);
  peer.emit('disconnected');
  expect(service.monitor().servers[0]).toMatchObject({ state: 'error', sessions: [{ state: 'unknown' }] });
  const next = await service.detail(server.id, 'native'); expect(next.historyVersion).not.toBe(previous.historyVersion);
  expect(next.requests).toEqual([]); expect(next.turnId).toBe(null); expect(next.session.state).toBe('saved');
  expect(peer.request.mock.calls.filter(([method]) => method === 'session/prompt')).toHaveLength(1);
});

it('keeps a new approval visible when repository metadata finishes after the permission request', async () => {
  await service.refresh(server.id); await service.input(server.id, 'native', 'Work');
  peer.request.mockImplementationOnce(async () => ({ sessions: [{ sessionId: 'native', cwd: '/another', title: 'Existing' }] }));
  let finishPaths: (paths: string[]) => void;
  let started: () => void;
  const metadataStarted = new Promise<void>(resolve => { started = resolve; });
  peer.projectPaths = () => new Promise(resolve => { finishPaths = resolve; started(); });
  const refreshing = service.refresh(server.id); await metadataStarted;
  peer.emit('event', { id: 8, method: 'session/request_permission', params: { sessionId: 'native',
    toolCall: { title: 'Edit file' }, options: [{ optionId: 'reject-once', name: 'Reject' }] } });
  finishPaths!(['/another']); await refreshing;
  expect(service.monitor().servers[0].sessions[0].state).toBe('waiting');
  expect((await service.detail(server.id, 'native')).requests[0].id).toBe('8');
  resolvePrompt({ stopReason: 'cancelled' }); await new Promise(resolve => setTimeout(resolve, 0));
});

it('preserves a failed prompt notice when native history has a newer timestamp but no assistant output', async () => {
  await service.refresh(server.id); await service.detail(server.id, 'native');
  peer.request.mockImplementationOnce(async () => { throw new Error('Model unavailable'); });
  await service.input(server.id, 'native', 'Work'); await new Promise(resolve => setTimeout(resolve, 0));
  peer.request.mockImplementationOnce(async () => ({ sessions: [{ sessionId: 'native', cwd: '/repo', updatedAt: '2099-01-01T00:00:00Z' }] }));
  await service.refresh(server.id);
  const detail = await service.detail(server.id, 'native');
  expect(detail.session.state).toBe('error'); expect(detail.items.at(-1)?.text).toContain('Model unavailable');
  expect(peer.request.mock.calls.filter(([method]) => method === 'session/load')).toHaveLength(1);
});

it('keeps completed live output when polling observes that turn in the saved session list', async () => {
  await service.refresh(server.id); await service.input(server.id, 'native', 'Work');
  const previous = await service.detail(server.id, 'native');
  emit({ sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'Completed result' } });
  const nativeUpdatedAt = new Date().toISOString();
  await new Promise(resolve => setTimeout(resolve, 5));
  resolvePrompt({ stopReason: 'end_turn' }); await new Promise(resolve => setTimeout(resolve, 0));
  peer.request.mockImplementationOnce(async () => ({ sessions: [{ sessionId: 'native', cwd: '/repo', updatedAt: nativeUpdatedAt }] }));
  await service.refresh(server.id);
  const detail = await service.detail(server.id, 'native');
  expect(detail.historyVersion).toBe(previous.historyVersion); expect(detail.items.at(-1)?.text).toBe('Completed result');
  expect(detail.session.state).toBe('idle');
  expect(peer.request.mock.calls.filter(([method]) => method === 'session/load')).toHaveLength(1);
});


it('browses saved session directories without loading history or starting a prompt', async () => {
  await service.refresh(server.id);
  expect(await service.directory(server.id, 'native', 'src')).toEqual({ cwd: '/repo', path: '/repo/src', entries: [], truncated: false });
  expect(peer.listDirectory).toHaveBeenCalledWith('/repo/src');
  expect(peer.request.mock.calls.map(([method]) => method)).toEqual(['session/list']);
});
