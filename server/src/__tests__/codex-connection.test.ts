import { afterEach, beforeEach, expect, it } from 'vitest';
import { once } from 'node:events';
import type { AddressInfo } from 'node:net';
import WebSocket, { WebSocketServer } from 'ws';
import { CodexRpc, quote } from '../codex-connection.js';

let server: WebSocketServer;
let peer: WebSocket;
let rpc: CodexRpc;
beforeEach(async () => {
  server = new WebSocketServer({ port: 0, host: '127.0.0.1' });
  await once(server, 'listening');
  const connected = once(server, 'connection');
  const socket = new WebSocket(`ws://127.0.0.1:${(server.address() as AddressInfo).port}`);
  rpc = new CodexRpc(socket, 200);
  [peer] = await connected;
  await once(socket, 'open');
});
afterEach(async () => { rpc.close(); for (const client of server.clients) client.terminate(); await new Promise<void>((r) => server.close(() => r())); });

it('correlates concurrent responses and forwards approvals instead of confusing them with responses', async () => {
  const requests: any[] = [];
  peer.on('message', (data) => {
    requests.push(JSON.parse(data.toString()));
    if (requests.length === 2) {
      peer.send(JSON.stringify({ id: 9, method: 'item/commandExecution/requestApproval', params: { threadId: 'native' } }));
      for (const request of [...requests].reverse()) peer.send(JSON.stringify({ id: request.id, result: request.method }));
    }
  });
  const event = once(rpc, 'event');
  expect(await Promise.all([rpc.request('thread/read'), rpc.request('thread/list')])).toEqual(['thread/read', 'thread/list']);
  expect((await event)[0]).toMatchObject({ id: 9, method: 'item/commandExecution/requestApproval' });
  const reply = once(peer, 'message');
  await rpc.send({ id: 9, result: { decision: 'decline' } });
  expect(JSON.parse((await reply)[0].toString())).toEqual({ id: 9, result: { decision: 'decline' } });
});

it('does not replay a turn after timeout or disconnection', async () => {
  const messages: unknown[] = [];
  peer.on('message', (data) => messages.push(JSON.parse(data.toString())));
  await expect(rpc.request('turn/start', { input: [{ type: 'text', text: 'Work' }] })).rejects.toThrow('timed out');
  const pending = rpc.request('turn/start');
  const rejected = expect(pending).rejects.toThrow('connection lost');
  peer.close(); await rejected;
  expect(messages).toHaveLength(2);
});

it('quotes executable paths without shell expansion', () => {
  expect(quote("/path with spaces/it's $(a)`b`/codex")).toBe("'/path with spaces/it'\\''s $(a)`b`/codex'");
});
