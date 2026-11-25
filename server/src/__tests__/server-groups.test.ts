import { expect, it } from 'vitest';
import { groupServers } from '../../../client/src/lib/server-groups.js';
import { groupProjects } from '../../../client/src/lib/project-groups.js';
import { otherSessions } from '../../../client/src/lib/attention.js';
import type { MonitorServer } from '../types.js';

function connection(id: string, tool: string, overrides: Partial<MonitorServer> = {}): MonitorServer {
  return { id, name: id, host: 'dev.local', port: 22, username: 'alex', tool, toolName: tool, createdAt: 1,
    state: 'connected', hasMore: false, sessions: [{ id: 'same-native-id', name: 'Work', cwd: '/repo', projectPath: '/repo',
      state: 'running', canInput: true, preview: '', updatedAt: 1 }], ...overrides };
}

it('groups by host and SSH port across tools/accounts, preserving each session owner and a stable name', () => {
  const codex = connection('Development', 'Codex');
  const agy = connection('Other name', 'Antigravity', { host: 'DEV.local', createdAt: 2 });
  const root = connection('Admin', 'Codex', { username: 'root', createdAt: 3 });
  const forwarded = connection('Another endpoint', 'Codex', { port: 2222 });
  const groups = groupServers([agy, forwarded, root, codex]);
  const group = groups.find((g) => g.port === 22)!;
  expect(groups).toHaveLength(2); expect(group.name).toBe('Development');
  expect(group.sessions.map((s) => [s.connectionId, s.id, s.toolName, s.username])).toEqual([
    ['Development', 'same-native-id', 'Codex', 'alex'], ['Other name', 'same-native-id', 'Antigravity', 'alex'], ['Admin', 'same-native-id', 'Codex', 'root'],
  ]);
  const projects = groupProjects(group.sessions);
  expect(projects).toHaveLength(1); expect(projects[0].sessions).toHaveLength(3);
  expect(projects[0].sessions[1].connectionId).toBe('Other name');
  expect(codex.sessions[0]).not.toHaveProperty('connectionId');
  expect(groupServers([codex, root, forwarded, agy]).find((g) => g.port === 22)?.name).toBe(group.name);
});

it('keeps failed tools from contributing live status while the other tool remains available', () => {
  const codex = connection('Development', 'Codex');
  const agy = connection('AGY', 'Antigravity', { createdAt: 2, state: 'error', error: 'Disconnected' });
  const group = groupServers([codex, agy])[0];
  expect(group.sessions.map((s) => s.state)).toEqual(['running', 'unknown']);
  expect(otherSessions([codex, agy], null)).toMatchObject([{ serverId: codex.id, serverName: 'Development', toolName: 'Codex' }]);
  expect(agy.sessions[0].state).toBe('running');
});

it('labels attention sessions with the grouped server name and excludes only the exact current connection', () => {
  const codex = connection('Development', 'Codex');
  const agy = connection('AGY', 'Antigravity', { createdAt: 2 });
  expect(otherSessions([agy, codex], { serverId: codex.id, threadId: 'same-native-id' })).toMatchObject([
    { serverId: agy.id, threadId: 'same-native-id', serverName: 'Development', toolName: 'Antigravity' },
  ]);
});
