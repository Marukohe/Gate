import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import { SSHManager, type ServerConfig } from './ssh-manager.js';
import { StreamJsonParser, type ParsedMessage } from './stream-json-parser.js';
import type { Database } from './db.js';

interface ClientMessage {
  type: 'connect' | 'input' | 'disconnect';
  serverId: string;
  text?: string;
}

interface ServerMessage {
  type: 'message' | 'status' | 'history';
  serverId: string;
  [key: string]: any;
}

export function setupWebSocket(httpServer: HttpServer, db: Database): void {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const sshManager = new SSHManager();
  const parsers = new Map<string, StreamJsonParser>();

  sshManager.on('status', (serverId: string, status: string, error?: string) => {
    broadcast(wss, { type: 'status', serverId, status, error });
  });

  sshManager.on('stderr', (serverId: string, data: string) => {
    console.error(`[claude stderr][${serverId}]`, data);
  });

  sshManager.on('data', (serverId: string, data: string) => {
    console.log(`[claude stdout][${serverId}]`, data);
    let parser = parsers.get(serverId);
    if (!parser) {
      parser = new StreamJsonParser();
      parsers.set(serverId, parser);

      parser.on('message', (message: ParsedMessage) => {
        broadcast(wss, { type: 'message', serverId, message });

        // Persist to DB
        const sessions = db.listSessions(serverId);
        if (sessions.length > 0) {
          db.saveMessage({ sessionId: sessions[0].id, ...message });
          db.updateSessionActivity(sessions[0].id);
        }
      });
    }
    parser.feed(data);
  });

  wss.on('connection', (ws: WebSocket) => {
    ws.on('message', async (raw: Buffer) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        ws.send(JSON.stringify({ type: 'error', error: 'Invalid JSON' }));
        return;
      }

      try {
        switch (msg.type) {
          case 'connect': {
            const server = db.getServer(msg.serverId);
            if (!server) {
              ws.send(JSON.stringify({ type: 'status', serverId: msg.serverId, status: 'error', error: 'Server not found' }));
              return;
            }

            const config: ServerConfig = {
              id: server.id,
              host: server.host,
              port: server.port,
              username: server.username,
              authType: server.authType as 'password' | 'privateKey',
              password: server.password ?? undefined,
              privateKeyPath: server.privateKeyPath ?? undefined,
            };

            await sshManager.connect(config);
            await sshManager.startClaude(server.id);

            // Create or reuse session
            const sessionName = 'stream-json';
            const sessions = db.listSessions(server.id);
            const existing = sessions.find(s => s.tmuxSession === sessionName);
            if (!existing) {
              db.createSession(server.id, sessionName);
            }

            // Send history
            if (existing) {
              const messages = db.getMessages(existing.id);
              ws.send(JSON.stringify({ type: 'history', serverId: server.id, messages }));
            }
            break;
          }

          case 'input': {
            if (!msg.text) return;
            sshManager.sendInput(msg.serverId, msg.text);
            break;
          }

          case 'disconnect': {
            const parser = parsers.get(msg.serverId);
            if (parser) parser.flush();
            parsers.delete(msg.serverId);
            await sshManager.disconnect(msg.serverId);
            break;
          }
        }
      } catch (err: any) {
        ws.send(JSON.stringify({ type: 'status', serverId: msg.serverId, status: 'error', error: err.message }));
      }
    });
  });
}

function broadcast(wss: WebSocketServer, data: ServerMessage): void {
  const json = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}
