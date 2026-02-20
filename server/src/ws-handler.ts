import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import { SSHManager, type ServerConfig } from './ssh-manager.js';
import { StreamJsonParser, type ParsedMessage } from './stream-json-parser.js';
import type { Database } from './db.js';

interface ClientMessage {
  type: 'connect' | 'input' | 'disconnect' | 'create-session' | 'delete-session';
  serverId: string;
  sessionId?: string;
  sessionName?: string;
  text?: string;
}

interface ServerMessage {
  type: 'message' | 'status' | 'history' | 'sessions';
  serverId: string;
  sessionId?: string | null;
  [key: string]: any;
}

export function setupWebSocket(httpServer: HttpServer, db: Database): void {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const sshManager = new SSHManager();
  const parsers = new Map<string, StreamJsonParser>(); // keyed by sessionId

  sshManager.on('status', (serverId: string, sessionId: string | null, status: string, error?: string) => {
    broadcast(wss, { type: 'status', serverId, sessionId, status, error });
  });

  sshManager.on('stderr', (serverId: string, sessionId: string, data: string) => {
    console.error(`[claude stderr][${serverId}:${sessionId}]`, data);
  });

  sshManager.on('data', (serverId: string, sessionId: string, data: string) => {
    console.log(`[claude stdout][${serverId}:${sessionId}]`, data);
    let parser = parsers.get(sessionId);
    if (!parser) {
      parser = new StreamJsonParser();
      parsers.set(sessionId, parser);

      parser.on('message', (message: ParsedMessage) => {
        // Skip user text echoes — we already save them from the 'input' handler.
        if (message.type === 'user') return;

        broadcast(wss, { type: 'message', serverId, sessionId, message });

        // Persist to DB
        db.saveMessage({ sessionId, ...message });
        db.updateSessionActivity(sessionId);

        // Save Claude's session ID so we can --resume later
        if (message.type === 'system' && message.subType === 'init') {
          const sid = parser!.getSessionId();
          if (sid) {
            db.updateClaudeSessionId(sessionId, sid);
          }
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

            // Resolve sessionId — fallback to first session for backward compat
            let sessionId = msg.sessionId;
            if (!sessionId) {
              const sessions = db.listSessions(server.id);
              if (sessions.length > 0) {
                sessionId = sessions[0].id;
              } else {
                const newSession = db.createSession(server.id, 'Default');
                sessionId = newSession.id;
              }
            }

            const session = db.getSession(sessionId);
            if (!session) {
              ws.send(JSON.stringify({ type: 'status', serverId: server.id, sessionId, status: 'error', error: 'Session not found' }));
              return;
            }

            // Send chat history to this client
            const messages = db.getMessages(session.id);
            ws.send(JSON.stringify({ type: 'history', serverId: server.id, sessionId, messages }));

            // If Claude is still running for this session, reuse it
            if (sshManager.hasActiveChannel(server.id, sessionId)) {
              ws.send(JSON.stringify({ type: 'status', serverId: server.id, sessionId, status: 'connected' }));
              break;
            }

            // Ensure SSH connection exists
            const config: ServerConfig = {
              id: server.id,
              host: server.host,
              port: server.port,
              username: server.username,
              authType: server.authType as 'password' | 'privateKey',
              password: server.password ?? undefined,
              privateKeyPath: server.privateKeyPath ?? undefined,
            };

            if (!sshManager.isConnected(server.id)) {
              await sshManager.connect(config);
            }

            // Resume previous Claude session if we have a session ID
            const resumeId = session.claudeSessionId ?? null;
            await sshManager.startClaude(server.id, sessionId, resumeId);
            break;
          }

          case 'input': {
            if (!msg.text || !msg.sessionId) return;
            sshManager.sendInput(msg.serverId, msg.sessionId, msg.text);

            // Persist user message to DB
            db.saveMessage({
              sessionId: msg.sessionId,
              type: 'user',
              content: msg.text,
              timestamp: Date.now(),
            });
            db.updateSessionActivity(msg.sessionId);
            break;
          }

          case 'disconnect': {
            if (msg.sessionId) {
              const parser = parsers.get(msg.sessionId);
              if (parser) parser.flush();
              parsers.delete(msg.sessionId);
              sshManager.stopSession(msg.serverId, msg.sessionId);
            } else {
              // Disconnect all sessions for this server
              const sessions = db.listSessions(msg.serverId);
              for (const s of sessions) {
                const parser = parsers.get(s.id);
                if (parser) parser.flush();
                parsers.delete(s.id);
              }
              await sshManager.disconnect(msg.serverId);
            }
            break;
          }

          case 'create-session': {
            const name = msg.sessionName || 'New Session';
            const session = db.createSession(msg.serverId, name);
            const sessions = db.listSessions(msg.serverId);
            broadcast(wss, { type: 'sessions', serverId: msg.serverId, sessions });
            // Also tell the sender which session was created
            ws.send(JSON.stringify({ type: 'session-created', serverId: msg.serverId, session }));
            break;
          }

          case 'delete-session': {
            if (!msg.sessionId) return;
            // Stop the channel if running
            sshManager.stopSession(msg.serverId, msg.sessionId);
            const parser = parsers.get(msg.sessionId);
            if (parser) parser.flush();
            parsers.delete(msg.sessionId);
            // Delete from DB (cascade deletes messages)
            db.deleteSession(msg.sessionId);
            const sessions = db.listSessions(msg.serverId);
            broadcast(wss, { type: 'sessions', serverId: msg.serverId, sessions });
            break;
          }
        }
      } catch (err: any) {
        ws.send(JSON.stringify({ type: 'status', serverId: msg.serverId, sessionId: msg.sessionId, status: 'error', error: err.message }));
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
