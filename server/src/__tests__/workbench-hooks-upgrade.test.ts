import { expect, it, vi } from 'vitest';
import { createDb } from '../db.js';
import { RemoteRuntime } from '../workbench/remote.js';

it('serializes hook upgrades with starts and never drains a runtime with active or lost runs', async () => {
  const db = createDb(':memory:');
  const remote = new RemoteRuntime(db);
  const settings = { serverId: 'machine', nodePath: '/node', claudePath: '/claude', codexPath: '/codex', directory: '/runtime' };
  const calls: string[] = [];
  let state = 'running';
  let releaseStart!: () => void;
  const starting = new Promise<void>((resolve) => { releaseStart = resolve; });
  vi.spyOn(remote, 'install').mockResolvedValue(settings);
  vi.spyOn(remote, 'prepare').mockResolvedValue('head');
  vi.spyOn(remote, 'shell').mockImplementation(async (_server, command) => command.includes('test -S') ? '' : '{}');
  vi.spyOn(remote as unknown as { sendRequest: (settings: unknown, request: { method: string }) => Promise<unknown> }, 'sendRequest')
    .mockImplementation(async (_settings, request) => {
      calls.push(request.method);
      if (request.method === 'start') { await starting; return {}; }
      if (request.method === 'ping') return { capabilities: {} };
      if (request.method === 'list') return [{ state }];
      return {};
    });
  try {
    const start = remote.request(settings, { method: 'start' });
    const install = remote.installHooks(settings, 'scope', '/repo', 'claude', true);
    await Promise.resolve(); await Promise.resolve();
    expect(calls).toEqual(['start']);
    releaseStart(); await start;
    await expect(install).rejects.toThrow(/Finish active runs/);
    expect(calls).not.toContain('shutdown');
    state = 'lost';
    await expect(remote.installHooks(settings, 'scope', '/repo', 'claude', true)).rejects.toThrow(/lost ownership/);
    expect(calls).not.toContain('shutdown');
    state = 'exited';
    await remote.installHooks(settings, 'scope', '/repo', 'claude', true);
    expect(calls).toContain('shutdown'); expect(calls.at(-1)).toBe('observe-configure');
  } finally { vi.restoreAllMocks(); db.close(); }
});
