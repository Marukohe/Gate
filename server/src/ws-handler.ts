import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import { SSHManager, type ServerConfig } from './ssh-manager.js';
import { StreamJsonParser, type ParsedMessage } from './stream-json-parser.js';
import { parseTranscript } from './transcript-parser.js';
import type { Database } from './db.js';

interface ClientMessage {
  type: 'connect' | 'input' | 'disconnect' | 'create-session' | 'delete-session' | 'fetch-git-info' | 'list-branches' | 'switch-branch' | 'exec' | 'sync-transcript' | 'list-claude-sessions';
  serverId: string;
  sessionId?: string;
  sessionName?: string;
  workingDir?: string;
  text?: string;
  branch?: string;
  command?: string;
  claudeSessionId?: string;
}

interface ServerMessage {
  type: 'message' | 'status' | 'history' | 'sessions' | 'git-info' | 'branches' | 'sync-result' | 'claude-sessions';
  serverId: string;
  sessionId?: string | null;
  [key: string]: any;
}

export function setupWebSocket(httpServer: HttpServer, db: Database): void {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const sshManager = new SSHManager();
  const parsers = new Map<string, StreamJsonParser>(); // keyed by sessionId
  const connecting = new Set<string>(); // sessionIds currently being connected

  sshManager.on('status', (serverId: string, sessionId: string | null, status: string, error?: string) => {
    broadcast(wss, { type: 'status', serverId, sessionId, status, error });
  });

  sshManager.on('stderr', (serverId: string, sessionId: string, data: string) => {
    console.error(`[claude stderr][${serverId}:${sessionId}]`, data);
  });

  sshManager.on('data', (serverId: string, sessionId: string, data: string) => {
    // Raw stdout logged only at debug level to avoid flooding the terminal
    if (process.env.DEBUG) console.log(`[claude stdout][${serverId}:${sessionId}]`, data);

    // Auto-approve CLI prompts that bypass stream-json (e.g. plan mode exit).
    // These appear as non-JSON lines on stdout while Claude waits for raw "y" on stdin.
    for (const line of data.split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('{')) continue;
      if (/\?\s*$/.test(trimmed)) {
        sshManager.writeRaw(serverId, sessionId, 'y\n');
        break;
      }
    }

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

        // Refresh git info after Claude completes a turn (may have changed git state)
        if (message.type === 'system' && message.subType === 'result') {
          const s = db.getSession(sessionId);
          if (s?.workingDir && sshManager.isConnected(serverId)) {
            sshManager.fetchGitInfo(serverId, s.workingDir).then((info) => {
              if (info) broadcast(wss, { type: 'git-info', serverId, sessionId, ...info });
            }).catch(() => {});
          }
        }
      });
    }
    parser.feed(data);
  });

  wss.on('connection', (ws: WebSocket) => {
    ws.on('close', () => {
      // Parsers are keyed by sessionId (shared across clients), so no cleanup here.
      // This handler prevents silent disconnects and enables future per-client tracking.
    });

    ws.on('error', (err) => {
      console.error('[ws] client error:', err.message);
    });

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

            // Skip if this session is already being connected
            if (connecting.has(sessionId)) break;
            connecting.add(sessionId);

            try {
              // Ensure SSH connection is alive (ping check + auto-reconnect if stale)
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
              } else {
                await sshManager.ensureConnected(server.id);
              }

              // Resume previous Claude session if we have a session ID
              const resumeId = session.claudeSessionId ?? null;
              await sshManager.startClaude(server.id, sessionId, resumeId, session.workingDir);
              ws.send(JSON.stringify({ type: 'status', serverId: server.id, sessionId, status: 'connected' }));
            } finally {
              connecting.delete(sessionId);
            }

            // Async fetch git info if session has a workingDir
            if (session.workingDir) {
              sshManager.fetchGitInfo(server.id, session.workingDir).then((info) => {
                if (info) {
                  broadcast(wss, { type: 'git-info', serverId: server.id, sessionId, ...info });
                }
              }).catch(() => {});
            }
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
            const session = db.createSession(msg.serverId, name, msg.workingDir || null);
            // Pre-fill Claude session ID if binding to an existing terminal session
            if (msg.claudeSessionId) {
              db.updateClaudeSessionId(session.id, msg.claudeSessionId);
              session.claudeSessionId = msg.claudeSessionId;
            }
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

          case 'fetch-git-info': {
            if (!msg.sessionId) return;
            const gitSession = db.getSession(msg.sessionId);
            if (!gitSession?.workingDir) return;
            if (!sshManager.isConnected(msg.serverId)) return;
            const gitInfo = await sshManager.fetchGitInfo(msg.serverId, gitSession.workingDir);
            if (gitInfo) {
              broadcast(wss, { type: 'git-info', serverId: msg.serverId, sessionId: msg.sessionId, ...gitInfo });
            }
            break;
          }

          case 'list-branches': {
            if (!msg.sessionId) return;
            const brSession = db.getSession(msg.sessionId);
            if (!brSession?.workingDir) return;
            if (!sshManager.isConnected(msg.serverId)) return;
            const branches = await sshManager.listBranches(msg.serverId, brSession.workingDir);
            ws.send(JSON.stringify({ type: 'branches', serverId: msg.serverId, sessionId: msg.sessionId, ...branches }));
            break;
          }

          case 'switch-branch': {
            if (!msg.sessionId || !msg.branch) return;
            const swSession = db.getSession(msg.sessionId);
            if (!swSession?.workingDir) return;
            if (!sshManager.isConnected(msg.serverId)) return;
            const newInfo = await sshManager.switchBranch(msg.serverId, swSession.workingDir, msg.branch);
            broadcast(wss, { type: 'git-info', serverId: msg.serverId, sessionId: msg.sessionId, ...newInfo });
            break;
          }

          case 'exec': {
            if (!msg.sessionId || !msg.command) return;
            if (!sshManager.isConnected(msg.serverId)) {
              ws.send(JSON.stringify({ type: 'status', serverId: msg.serverId, sessionId: msg.sessionId, status: 'error', error: 'Not connected to server' }));
              return;
            }

            const execSession = db.getSession(msg.sessionId);
            const execDir = execSession?.workingDir ?? null;

            // Save the user !command to DB for history persistence
            db.saveMessage({
              sessionId: msg.sessionId,
              type: 'user',
              content: `!${msg.command}`,
              timestamp: Date.now(),
            });
            db.updateSessionActivity(msg.sessionId);

            const { stdout, stderr, exitCode } = await sshManager.runCommand(msg.serverId, execDir, msg.command);
            const output = (stdout + stderr).trimEnd();
            const resultContent = exitCode !== 0 ? `${output}\n[exit code: ${exitCode}]` : output;

            const resultMessage = {
              sessionId: msg.sessionId,
              type: 'tool_result' as const,
              content: resultContent || '(no output)',
              toolName: 'bash',
              toolDetail: msg.command,
              timestamp: Date.now(),
            };

            db.saveMessage(resultMessage);
            db.updateSessionActivity(msg.sessionId);
            broadcast(wss, { type: 'message', serverId: msg.serverId, sessionId: msg.sessionId, message: resultMessage });
            break;
          }

          case 'list-claude-sessions': {
            if (!msg.workingDir) return;
            const lsServer = db.getServer(msg.serverId);
            if (!lsServer) {
              console.log('[list-claude-sessions] server not found:', msg.serverId);
              ws.send(JSON.stringify({ type: 'claude-sessions', serverId: msg.serverId, sessions: [] }));
              return;
            }

            try {
              // Ensure SSH is connected (dialog may open before any session connects)
              if (!sshManager.isConnected(msg.serverId)) {
                console.log('[list-claude-sessions] SSH not connected, auto-connecting...');
                const config: ServerConfig = {
                  id: lsServer.id,
                  host: lsServer.host,
                  port: lsServer.port,
                  username: lsServer.username,
                  authType: lsServer.authType as 'password' | 'privateKey',
                  password: lsServer.password ?? undefined,
                  privateKeyPath: lsServer.privateKeyPath ?? undefined,
                };
                await sshManager.connect(config);
              }
              // Resolve path to absolute — expand ~ to $HOME for shell safety
              const dir = msg.workingDir.startsWith('~/') ? `$HOME/${msg.workingDir.slice(2)}` : msg.workingDir;
              const resolveCmd = `cd "${dir}" 2>/dev/null && pwd || echo "${dir}"`;
              const { stdout: resolved } = await sshManager.runCommand(msg.serverId, null, resolveCmd);
              const absPath = resolved.trim();
              const projectHash = absPath.replace(/[/_]/g, '-');

              // List JSONL transcript files sorted by mtime (newest first)
              const lsCmd = `ls -t ~/.claude/projects/${projectHash}/*.jsonl 2>/dev/null | head -10`;
              console.log('[list-claude-sessions] dir=%s hash=%s cmd=%s', msg.workingDir, projectHash, lsCmd);
              const { stdout: lsOutput } = await sshManager.runCommand(msg.serverId, null, lsCmd);

              const sessionIds = lsOutput.trim().split('\n')
                .filter(Boolean)
                .map((f) => {
                  const basename = f.split('/').pop() ?? '';
                  return basename.replace('.jsonl', '');
                })
                .filter(Boolean);

              console.log('[list-claude-sessions] found %d sessions', sessionIds.length);
              ws.send(JSON.stringify({ type: 'claude-sessions', serverId: msg.serverId, sessions: sessionIds }));
            } catch (err: any) {
              console.error('[list-claude-sessions] error:', err.message);
              ws.send(JSON.stringify({ type: 'claude-sessions', serverId: msg.serverId, sessions: [] }));
            }
            break;
          }

          case 'sync-transcript': {
            if (!msg.sessionId) return;
            const syncSession = db.getSession(msg.sessionId);
            if (!syncSession?.claudeSessionId) {
              ws.send(JSON.stringify({ type: 'sync-result', serverId: msg.serverId, sessionId: msg.sessionId, success: false, error: 'No Claude session ID found. Start a conversation first.' }));
              return;
            }
            if (!sshManager.isConnected(msg.serverId)) {
              ws.send(JSON.stringify({ type: 'sync-result', serverId: msg.serverId, sessionId: msg.sessionId, success: false, error: 'Not connected to server' }));
              return;
            }

            try {
              // Find and read the JSONL transcript file on the remote server
              const findCmd = `ls ~/.claude/projects/*/${syncSession.claudeSessionId}.jsonl 2>/dev/null | head -1`;
              const { stdout: filePath } = await sshManager.runCommand(msg.serverId, null, findCmd);
              const trimmedPath = filePath.trim();
              if (!trimmedPath) {
                ws.send(JSON.stringify({ type: 'sync-result', serverId: msg.serverId, sessionId: msg.sessionId, success: false, error: `Transcript file not found for session ${syncSession.claudeSessionId}` }));
                return;
              }

              const { stdout: jsonlContent } = await sshManager.runCommand(msg.serverId, null, `cat '${trimmedPath}'`);
              const transcriptMessages = parseTranscript(jsonlContent);

              if (transcriptMessages.length === 0) {
                ws.send(JSON.stringify({ type: 'sync-result', serverId: msg.serverId, sessionId: msg.sessionId, success: true, added: 0 }));
                return;
              }

              // Build signature set from existing DB messages for dedup
              const existing = db.getMessages(msg.sessionId, 10000);
              const signatures = new Set<string>();
              for (const m of existing) {
                signatures.add(msgSignature(m.type, m.content));
              }

              // Find new messages not already in DB
              const newMessages = transcriptMessages.filter(
                (m) => !signatures.has(msgSignature(m.type, m.content)),
              );

              if (newMessages.length > 0) {
                db.saveMessages(newMessages.map((m) => ({
                  sessionId: msg.sessionId!,
                  type: m.type,
                  content: m.content,
                  toolName: m.toolName,
                  toolDetail: m.toolDetail,
                  timestamp: m.timestamp,
                })));
              }

              // Send full updated history to this client
              const allMessages = db.getMessages(msg.sessionId!);
              ws.send(JSON.stringify({ type: 'history', serverId: msg.serverId, sessionId: msg.sessionId, messages: allMessages }));
              ws.send(JSON.stringify({ type: 'sync-result', serverId: msg.serverId, sessionId: msg.sessionId, success: true, added: newMessages.length }));
            } catch (err: any) {
              ws.send(JSON.stringify({ type: 'sync-result', serverId: msg.serverId, sessionId: msg.sessionId, success: false, error: err.message }));
            }
            break;
          }
        }
      } catch (err: any) {
        ws.send(JSON.stringify({ type: 'status', serverId: msg.serverId, sessionId: msg.sessionId, status: 'error', error: err.message }));
      }
    });
  });
}

/** Dedup signature: type + first 150 chars of content. */
function msgSignature(type: string, content: string): string {
  return `${type}|${content.slice(0, 150)}`;
}

function broadcast(wss: WebSocketServer, data: ServerMessage): void {
  const json = JSON.stringify(data);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(json);
    }
  }
}
