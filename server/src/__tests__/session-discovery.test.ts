import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readdir, stat, writeFile, appendFile, rm } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { SFTPWrapper } from 'ssh2';
import { discoverCodexSessions, summarizeCodexSession } from '../providers/codex/discovery.js';
import { SessionDiscovery } from '../session-discovery.js';
import type { Server } from '../db.js';

const time = 1_700_000_000_000;
const record = (type: string, payload: object, at = time) => JSON.stringify({ type, payload, timestamp: new Date(at).toISOString() }) + '\n';
const meta = record('session_meta', { id: 'native', cwd: '/repo', source: 'cli' });
const complete = record('event_msg', { type: 'task_complete', last_agent_message: 'Done' }, time + 1);
const server: Server = { id: 'server', name: 'Development', host: 'localhost', port: 22, username: 'test',
  authType: 'password', password: 'secret', createdAt: 1 };

describe('Codex terminal discovery', () => {
  it('summarizes modern rollouts without exposing prompts, reasoning, or tool arguments', () => {
    const tail = record('response_item', { type: 'message', role: 'user', content: [{ text: 'private prompt' }] }) +
      record('response_item', { type: 'reasoning', text: 'private reasoning' }) +
      record('response_item', { type: 'function_call', name: 'exec_command', arguments: 'private arguments' });
    const session = summarizeCodexSession(meta, tail, time);
    expect(session).toMatchObject({ nativeSessionId: 'native', cwd: '/repo', source: 'external', observation: 'transcript',
      state: 'running', activity: 'Using exec_command' });
    expect(JSON.stringify(session)).not.toContain('private');
    expect(summarizeCodexSession(meta, tail + complete, time)).toMatchObject({ state: 'completed', activity: 'Done' });
    expect(summarizeCodexSession(meta, complete + record('event_msg', { type: 'task_started' }, time + 2), time)?.state).toBe('running');
    expect(summarizeCodexSession(meta, record('event_msg', { type: 'turn_aborted' }), time)?.state).toBe('stopped');
    expect(summarizeCodexSession(meta, record('event_msg', { type: 'error', message: 'Failed' }), time)?.state).toBe('failed');
  });

  it('handles older records and ignores malformed records and child agents', () => {
    const older = record('SessionMeta', { id: 'older', cwd: '/repo' });
    const response = record('ResponseItem', { type: 'agent_message', text: 'x'.repeat(1000) });
    expect(summarizeCodexSession(older, 'bad JSON\n' + response + '{"payload":', time)?.activity).toHaveLength(200);
    expect(summarizeCodexSession('bad JSON', complete, time)).toBeNull();
    expect(summarizeCodexSession(record('session_meta', { id: 'child', cwd: '/repo', source: { subagent: {} } }), complete, time)).toBeNull();
    expect(summarizeCodexSession(meta, '', time)?.state).toBe('unknown');
  });

  it('finds resumed old files, bounds reads, caches unchanged files, and tolerates partial writes', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'gate-discovery-'));
    try {
      const directory = path.join(root, 'sessions/2020/01/01');
      await mkdir(directory, { recursive: true });
      const file = path.join(directory, 'rollout-old.jsonl');
      await writeFile(file, meta + record('response_item', { type: 'function_call_output', output: 'x'.repeat(600_000) }) + complete + '{"type":');
      const reads: number[] = [];
      const sftp = {
        readdir: (dir: string, callback: (error: unknown, entries?: unknown[]) => void) => {
          void readdir(dir).then(async (names) => Promise.all(names.map(async (filename) => ({ filename, attrs: await stat(path.join(dir, filename)).then((s) =>
            ({ mode: s.mode, size: s.size, mtime: s.mtimeMs / 1000 })) })))).then((entries) => callback(null, entries), (error) => callback(error));
        },
        createReadStream: (file: string, options: { start: number; end: number }) => {
          reads.push(options.end - options.start + 1);
          return createReadStream(file, options);
        },
      } as unknown as SFTPWrapper;
      const cache = new Map();
      expect(await discoverCodexSessions(sftp, root, cache)).toMatchObject([{ nativeSessionId: 'native', state: 'completed' }]);
      expect(Math.max(...reads)).toBeLessThanOrEqual(256 * 1024);
      const count = reads.length;
      await discoverCodexSessions(sftp, root, cache);
      expect(reads).toHaveLength(count);
      await appendFile(file, '\n' + record('event_msg', { type: 'task_started' }, time + 2));
      expect(await discoverCodexSessions(sftp, root, cache)).toMatchObject([{ state: 'running' }]);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it('shares scans across browser polls and retains evidence through failure and recovery', async () => {
    let now = time;
    const session = summarizeCodexSession(meta, complete, time)!;
    const scan = vi.fn().mockResolvedValue([session]);
    const discovery = new SessionDiscovery(scan, () => now);
    const snapshot = () => discovery.snapshot([server]).get(server.id)!;
    const settle = async () => { await new Promise((resolve) => setImmediate(resolve)); };
    try {
      expect(snapshot().scanning).toBe(true);
      snapshot(); expect(scan).toHaveBeenCalledTimes(1);
      await settle();
      expect(snapshot()).toMatchObject({ scanning: false, checkedAt: time, sessions: [{ id: 'server:codex:native', serverId: 'server' }] });
      scan.mockRejectedValueOnce(new Error('SSH unavailable'));
      now += 15_000; snapshot(); await settle();
      expect(snapshot()).toMatchObject({ error: 'SSH unavailable', sessions: [{ nativeSessionId: 'native' }] });
      now += 15_000; snapshot(); await settle();
      expect(snapshot().error).toBeUndefined();
      expect(JSON.stringify(snapshot())).not.toContain('secret');
      discovery.snapshot([{ ...server, username: 'another-user' }]);
      expect(scan).toHaveBeenCalledTimes(4);
      expect(scan.mock.calls[0][2].aborted).toBe(true);
      expect(discovery.snapshot([]).size).toBe(0);
      expect(scan.mock.calls[3][2].aborted).toBe(true);
    } finally { discovery.close(); }
  });
});
