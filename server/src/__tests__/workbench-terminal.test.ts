import { expect, it, vi } from 'vitest';
import { createDb } from '../db.js';
import { RemoteRuntime } from '../workbench/remote.js';

it('uses private-lifecycle Codex terminals and rejects clients without that capability', async () => {
  const db = createDb(':memory:');
  const remote = new RemoteRuntime(db);
  const settings = { serverId: 'machine', nodePath: '/node', directory: '/runtime', claudePath: '/claude', codexPath: '/codex' };
  vi.spyOn(remote, 'install').mockResolvedValue(settings);
  vi.spyOn(remote, 'request').mockResolvedValue({ capabilities: { redactedInput: true } });
  const shell = vi.spyOn(remote, 'shell').mockImplementation(async (_id, command) => command.includes('--help') ? '--no-daemon' : '');
  try {
    const launch = await remote.terminal(settings, '/repo', 'codex');
    expect(JSON.parse(launch.initialInput).args).toEqual(['--no-daemon']);
    shell.mockResolvedValue('Older client');
    await expect(remote.terminal(settings, '/repo', 'codex')).rejects.toThrow(/require --no-daemon/);
  } finally { vi.restoreAllMocks(); await remote.disconnect(); db.close(); }
});
