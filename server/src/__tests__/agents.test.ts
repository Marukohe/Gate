import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
import { AgentService } from '../agents/service.js';
import type { AgentBackend } from '../agents/backend.js';
import type { Server } from '../types.js';

it('routes connections and events by tool without mixing native session IDs or replaying input', async () => {
  const backend = (name: string) => Object.assign(new EventEmitter(), {
    sync: vi.fn(), close: vi.fn(), monitor: () => ({ servers: [{ id: name }] }),
    input: vi.fn(async () => ({ name })), detail: vi.fn(async () => ({ name })),
  });
  const codex = backend('one'); const another = backend('two');
  const service = new AgentService([
    { tool: { id: 'another', name: 'Another', executable: 'agent', description: '' }, createBackend: () => another as unknown as AgentBackend },
    { tool: { id: 'codex', name: 'Codex', executable: 'codex', description: '' }, createBackend: () => codex as unknown as AgentBackend },
  ], 'codex');
  const servers = [{ id: 'one' }, { id: 'two', tool: 'another' }] as Server[];
  service.sync(servers);
  expect(codex.sync).toHaveBeenCalledWith([servers[0]]);
  expect(another.sync).toHaveBeenCalledWith([servers[1]]);
  expect(service.monitor().servers.map((server) => server.id)).toEqual(['two', 'one']);
  expect(await service.input('two', 'same-native-id', 'Once')).toEqual({ name: 'two' });
  expect(codex.input).not.toHaveBeenCalled(); expect(another.input).toHaveBeenCalledOnce();
  const received = vi.fn(); service.on('event', received);
  another.emit('event', { serverId: 'two', threadId: 'same-native-id', type: 'changed' });
  codex.emit('event', { serverId: 'two', threadId: 'same-native-id', type: 'changed' });
  expect(received).toHaveBeenCalledOnce();
  service.sync([servers[0]]);
  expect(another.sync).toHaveBeenLastCalledWith([]);
  another.emit('event', { serverId: 'two', type: 'disconnected' });
  expect(received).toHaveBeenCalledOnce();
  expect(() => service.sync([{ id: 'missing', tool: 'missing' } as Server])).toThrow('Unsupported tool');
  expect(another.input).toHaveBeenCalledOnce();
  service.close(); expect(codex.close).toHaveBeenCalledOnce(); expect(another.close).toHaveBeenCalledOnce();
});
