import type { ClientChannel } from 'ssh2';
import { WebSocket, type RawData } from 'ws';
import { connectSsh, quote } from '../ssh.js';
import type { Database } from '../db.js';
import type { AgentService } from '../agents/service.js';
import type { Gateways } from '../gateways.js';

const bufferLimit = 1024 * 1024;
const terminalMaximum = 500;

function size(cols: unknown, rows: unknown) {
  return typeof cols === 'number' && typeof rows === 'number' && Number.isInteger(cols) && Number.isInteger(rows) &&
    cols >= 2 && rows >= 2 && cols <= terminalMaximum && rows <= terminalMaximum ? { cols, rows } : undefined;
}

function send(socket: WebSocket, data: RawData | string, binary = false) {
  if (socket.readyState !== WebSocket.OPEN) return;
  if (socket.bufferedAmount > bufferLimit) { socket.terminate(); return; }
  socket.send(data, { binary });
}

function fail(socket: WebSocket, message: string) {
  send(socket, JSON.stringify({ type: 'error', message }));
  if (socket.readyState === WebSocket.OPEN) socket.close(1011, 'Terminal error');
}

function relay(socket: WebSocket, peer: WebSocket) {
  const close = () => peer.terminate();
  socket.once('close', close);
  peer.on('message', (data, binary) => send(socket, data, binary));
  socket.on('message', (data, binary) => send(peer, data, binary));
  peer.on('error', () => fail(socket, 'Could not connect to the remote Gate terminal.'));
  peer.on('close', (code, reason) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (code === 1000 || code === 1008 || code === 1011) socket.close(code, reason);
    else socket.close(1011, 'Remote Gate terminal disconnected');
  });
}

export async function openTerminal(socket: WebSocket, query: URLSearchParams, db: Database, agents: AgentService, gateways: Gateways) {
  const serverId = query.get('server');
  const sessionId = query.get('session');
  const dimensions = size(Number(query.get('cols')), Number(query.get('rows')));
  const stop = new AbortController();
  socket.once('close', () => stop.abort());
  try {
    if (!serverId || serverId.length > 260 || !sessionId || sessionId.length > 200 || !dimensions) {
      throw new Error('Invalid terminal request.');
    }
    const peer = gateways.terminal(serverId, query);
    if (peer) { relay(socket, peer); return; }

    const server = db.getServer(serverId);
    if (!server || server.tool === 'ssh') throw new Error('Server not found.');
    const cwd = await agents.workingDirectory(serverId, sessionId);
    if (!cwd.startsWith('/') || cwd.includes('\0')) throw new Error('Session working directory is unavailable.');
    if (stop.signal.aborted || socket.readyState !== WebSocket.OPEN) return;
    // The PTY owns a separate SSH connection so closing it cannot stop the AI backend.
    const ssh = await connectSsh(server, stop.signal);
    ssh.once('close', () => {
      if (socket.readyState === WebSocket.OPEN) socket.close(1011, 'SSH closed');
    });
    const command = `sh -c ${quote('cd -- ' + quote(cwd) + ' && exec "${SHELL:-/bin/sh}" -il')}`;
    const channel = await new Promise<ClientChannel>((resolve, reject) => {
      ssh.exec(command, { pty: { term: 'xterm-256color', ...dimensions } }, (error, stream) => error ? reject(error) : resolve(stream));
    });
    if (stop.signal.aborted || socket.readyState !== WebSocket.OPEN) { channel.close(); return; }
    send(socket, JSON.stringify({ type: 'ready', cwd }));
    channel.on('data', (data: Buffer) => send(socket, data, true));
    channel.stderr.on('data', (data: Buffer) => send(socket, data, true));
    channel.on('error', () => fail(socket, 'SSH terminal closed unexpectedly.'));
    channel.once('close', () => {
      if (socket.readyState === WebSocket.OPEN) socket.close(1000, 'Shell exited');
    });
    socket.on('message', (data, binary) => {
      if (binary) {
        if (channel.writableLength > bufferLimit) socket.terminate();
        else if (Buffer.isBuffer(data)) channel.write(data);
        return;
      }
      try {
        const update = JSON.parse(data.toString());
        const next = update?.type === 'resize' ? size(update.cols, update.rows) : undefined;
        if (next) channel.setWindow(next.rows, next.cols, 0, 0);
      } catch { /* Ignore malformed control messages. */ }
    });
  } catch (error) {
    fail(socket, (error as Error).message);
    stop.abort();
  }
}
