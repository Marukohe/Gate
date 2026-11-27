import { Duplex } from 'node:stream';
import { expect, it, vi } from 'vitest';
import { AcpRpc } from '../connection.js';

it('correlates split NDJSON responses, handles permission requests, and never replays failed prompts', async () => {
  const writes: any[] = [];
  const stream = new Duplex({ read() {}, write(chunk, _encoding, done) { writes.push(JSON.parse(chunk.toString())); done(); } });
  const rpc = new AcpRpc(stream); const events = vi.fn(); rpc.on('event', events);
  const a = rpc.request('session/list'); const b = rpc.request('session/load');
  stream.push('{"jsonrpc":"2.0","id":"gate-2","result":{"loaded":');
  stream.push('true}}\n{"jsonrpc":"2.0","id":7,"method":"session/request_permission","params":{"sessionId":"s"}}\n');
  stream.push('{"jsonrpc":"2.0","id":"gate-1","result":{"sessions":[]}}\n');
  expect(await a).toEqual({ sessions: [] }); expect(await b).toEqual({ loaded: true });
  expect(events).toHaveBeenCalledWith(expect.objectContaining({ id: 7, method: 'session/request_permission' }));
  await rpc.send({ id: 7, result: { outcome: { outcome: 'selected', optionId: 'allow-once' } } });
  expect(writes.at(-1)).toMatchObject({ jsonrpc: '2.0', id: 7, result: { outcome: { optionId: 'allow-once' } } });
  const prompt = rpc.request('session/prompt', { sessionId: 's', prompt: [] }, 0);
  const rejected = expect(prompt).rejects.toThrow('connection lost'); stream.destroy(); await rejected;
  expect(writes.filter(message => message.method === 'session/prompt')).toHaveLength(1);
});

it('fails timed-out operations and closes a malformed stream without replay', async () => {
  let count = 0;
  const stream = new Duplex({ read() {}, write(_chunk, _encoding, done) { count++; done(); } });
  const rpc = new AcpRpc(stream);
  await expect(rpc.request('session/new', {}, 5)).rejects.toThrow('timed out');
  const pending = rpc.request('session/list'); const rejected = expect(pending).rejects.toThrow('Invalid JSON');
  stream.push('not-json\n'); await rejected;
  expect(count).toBe(2); await expect(rpc.request('session/list')).rejects.toThrow('disconnected');
});
