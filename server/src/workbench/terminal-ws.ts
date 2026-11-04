import type { Server } from 'node:http';
import type { ClientChannel } from 'ssh2';
import { WebSocket, WebSocketServer } from 'ws';
import type { Database } from '../db.js';
import type { ExecutionService } from './execution.js';

export function setupTerminalWebSocket(server: Server, db: Database, execution: ExecutionService) {
  const wss = new WebSocketServer({ noServer: true, maxPayload: 40_000 });
  const alive = new WeakSet<WebSocket>();
  const heartbeat = setInterval(() => {
    for (const client of wss.clients) {
      if (!alive.has(client)) { client.terminate(); continue; }
      alive.delete(client); client.ping();
    }
  }, 15_000);
  heartbeat.unref();
  const groups = new Map<string, { controller: WebSocket | null; clients: Set<WebSocket> }>();
  const send = (client: WebSocket, value: unknown) => {
    if (client.readyState !== WebSocket.OPEN) return;
    if (client.bufferedAmount > 2 * 1024 * 1024) { client.close(1013, 'Terminal viewer is too slow'); return; }
    client.send(JSON.stringify(value));
  };
  server.on('upgrade', (request, socket, head) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (pathname === '/ws') return;
    if (pathname !== '/ws/terminal') { socket.destroy(); return; }
    wss.handleUpgrade(request, socket, head, (client) => wss.emit('connection', client, request));
  });
  wss.on('connection', (client, request) => {
    alive.add(client);
    client.on('pong', () => alive.add(client));
    const url = new URL(request.url!, 'http://localhost');
    const runId = url.searchParams.get('runId') ?? '';
    const after = Number(url.searchParams.get('after') ?? 0);
    const run = db.workbench.run(runId);
    const saved = db.workbench.execution(runId);
    if (!run || run.kind !== 'terminal' || !saved?.launch || !Number.isSafeInteger(after) || after < 0) {
      send(client, { type: 'connection-error', message: 'Terminal is not ready or does not exist' });
      client.close(1013); return;
    }
    const group = groups.get(runId) ?? { controller: null, clients: new Set<WebSocket>() };
    groups.set(runId, group);
    group.clients.add(client);
    const writable = () => ['starting', 'running', 'waiting'].includes(db.workbench.run(runId)?.state ?? '');
    if (!group.controller && writable()) group.controller = client;
    const roles = () => { for (const peer of group.clients) send(peer, { type: 'control', writable: peer === group.controller && writable(),
      available: !group.controller && writable() }); };
    roles();
    let channel: ClientChannel | undefined;
    let closed = false;
    let buffer = '';
    client.on('error', () => {});
    client.on('close', () => {
      closed = true;
      channel?.end(); channel?.close();
      group.clients.delete(client);
      if (group.controller === client) group.controller = null;
      if (!group.clients.size) groups.delete(runId); else roles();
    });
    client.on('message', (data) => {
      let value;
      try {
        value = JSON.parse(data.toString());
        if (value.type === 'claim') {
          if (group.controller && group.controller !== client) throw new Error('Another browser controls this terminal');
          if (!writable()) throw new Error('Terminal is not running');
          group.controller = client; roles(); return;
        }
        if (group.controller !== client || !writable()) throw new Error('This terminal attachment is read-only');
        if (!channel?.writable || channel.writableLength > 128 * 1024) throw new Error('Terminal connection is not ready for input');
        if (typeof value.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(value.id)) throw new Error('Invalid input identity');
        const message = value.message;
        if (message?.type === 'resize') {
          if (!Number.isInteger(message.cols) || message.cols < 2 || message.cols > 500 ||
            !Number.isInteger(message.rows) || message.rows < 2 || message.rows > 200) throw new Error('Invalid terminal size');
        } else if (message?.type !== 'input' || typeof message.data !== 'string' ||
          message.data.length > 24000 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(message.data)) {
          throw new Error('Invalid terminal input');
        }
        channel.write(JSON.stringify({ id: value.id, message }) + '\n');
      } catch (error) { send(client, { type: 'input-error', id: value?.id, message: (error as Error).message }); }
    });
    void execution.remote.terminalStream(saved.settings, runId, after).then((stream) => {
      channel = stream;
      if (closed) { stream.end(); stream.close(); return; }
      stream.setEncoding('utf8');
      stream.on('data', (data: string) => {
        buffer += data;
        if (buffer.length > 2 * 1024 * 1024) { client.close(1013, 'Terminal frame too large'); return; }
        let newline;
        while ((newline = buffer.indexOf('\n')) >= 0) {
          const line = buffer.slice(0, newline); buffer = buffer.slice(newline + 1);
          try { send(client, JSON.parse(line)); } catch { client.close(1011, 'Invalid terminal frame'); }
        }
      });
      stream.stderr.resume();
      stream.on('error', () => client.close(1011, 'Terminal transport interrupted'));
      stream.on('close', () => { if (!closed) client.close(1012, 'Terminal transport closed'); });
    }).catch((error) => {
      send(client, { type: 'connection-error', message: error.message }); client.close(1013);
    });
  });
  return () => { clearInterval(heartbeat); for (const client of wss.clients) client.close(1001); wss.close(); };
}
