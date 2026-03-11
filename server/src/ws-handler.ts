import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import { SSHManager, type ServerConfig } from './ssh-manager.js';
import type { ParsedMessage, CLIProvider, OutputParser } from './providers/types.js';
import type { ProviderRegistry } from './providers/registry.js';
import type { Database } from './db.js';

interface ClientMessage {
  type: 'connect' | 'input' | 'disconnect' | 'create-session' | 'delete-session' | 'fetch-git-info' | 'list-branches' | 'switch-branch' | 'exec' | 'sync-transcript' | 'list-claude-sessions' | 'load-more' | 'switch-provider';
  serverId: string;
  sessionId?: string;
  sessionName?: string;
  workingDir?: string;
  text?: string;
  branch?: string;
  command?: string;
  claudeSessionId?: string;
  beforeTimestamp?: number;
  provider?: string;
}

interface ServerMessage {
  type: 'message' | 'status' | 'history' | 'history-prepend' | 'sessions' | 'git-info' | 'branches' | 'sync-result' | 'claude-sessions';
  serverId: string;
  sessionId?: string | null;
  [key: string]: any;
}

/** Look up the CLIProvider for a session, falling back to default. */
function getProvider(db: Database, registry: ProviderRegistry, sessionId: string): CLIProvider {
  const session = db.getSession(sessionId);
  const providerName = session?.provider ?? 'claude';
  const provider = registry.get(providerName);
  if (!provider) throw new Error(`Unknown provider: ${providerName}`);
  return provider;
}

export function setupWebSocket(httpServer: HttpServer, db: Database, registry: ProviderRegistry): void {
  const wss = new WebSocketServer({ server: httpServer, path: '/ws' });
  const sshManager = new SSHManager();
  const parsers = new Map<string, OutputParser>(); // keyed by sessionId
  const connecting = new Set<string>(); // sessionIds currently being connected
  // Sessions using non-stdin providers (e.g. Codex): CLI is launched per-message,
  // so channel close is expected and should NOT broadcast 'disconnected'.
  const perMessageSessions = new Set<string>();

  sshManager.on('status', (serverId: string, sessionId: string | null, status: string, error?: string) => {
    if (status === 'disconnected' && sessionId && perMessageSessions.has(sessionId)) {
      return; // suppress — CLI exited normally after finishing its turn
    }
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
      const provider = getProvider(db, registry, sessionId);
      parser = provider.createParser();
      parsers.set(sessionId, parser);

      parser.on('message', (message: ParsedMessage) => {
        // Skip user text echoes — we already save them from the 'input' handler.
        if (message.type === 'user') return;

        broadcast(wss, { type: 'message', serverId, sessionId, message });

        // Persist to DB
        db.saveMessage({ sessionId, ...message });
        db.updateSessionActivity(sessionId);

        // Save CLI session ID so we can --resume later
        const cliSid = provider.extractSessionId(message);
        if (cliSid) {
          db.updateCliSessionId(sessionId, cliSid);
          // Also update legacy field for backward compat
          db.updateClaudeSessionId(sessionId, cliSid);
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

  // Periodically clean up parsers for sessions that no longer have active SSH channels.
  // Catches cases where clients disconnect without sending an explicit 'disconnect' message.
  const parserCleanupInterval = setInterval(() => {
    for (const [sessionId, parser] of parsers) {
      // Keep parser if any SSH connection still has an active channel for this session
      let hasChannel = false;
      // Check all servers — sessionId is globally unique
      for (const server of db.listServers()) {
        if (sshManager.hasActiveChannel(server.id, sessionId)) {
          hasChannel = true;
          break;
        }
      }
      if (!hasChannel) {
        parser.flush();
        parsers.delete(sessionId);
      }
    }
  }, 60_000);

  // WebSocket ping/pong keepalive — prevents idle disconnects from browsers/proxies
  const PING_INTERVAL = 30_000;
  const pingInterval = setInterval(() => {
    for (const client of wss.clients) {
      if ((client as any).isAlive === false) {
        client.terminate();
        continue;
      }
      (client as any).isAlive = false;
      client.ping();
    }
  }, PING_INTERVAL);

  // Clean up intervals when server shuts down
  wss.on('close', () => {
    clearInterval(parserCleanupInterval);
    clearInterval(pingInterval);
  });

  wss.on('connection', (ws: WebSocket) => {
    (ws as any).isAlive = true;
    ws.on('pong', () => { (ws as any).isAlive = true; });

    ws.on('close', () => {
      // Parsers are keyed by sessionId (shared across clients), so no per-client cleanup.
      // Stale parsers are cleaned up by the periodic interval above.
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

            // Send chat history to this client (last 100 messages)
            const messages = db.getMessages(session.id);
            const totalCount = db.getMessageCount(session.id);
            ws.send(JSON.stringify({ type: 'history', serverId: server.id, sessionId, messages, hasMore: totalCount > messages.length }));

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

              // Build CLI command via provider and launch
              const provider = getProvider(db, registry, sessionId);
              const caps = provider.getCapabilities();

              if (caps.supportsStdin) {
                // Interactive providers (e.g. Claude): launch once, keep running
                const cmd = provider.buildCommand({
                  resumeSessionId: session.cliSessionId ?? session.claudeSessionId ?? undefined,
                  workingDir: session.workingDir ?? undefined,
                });
                await sshManager.startCLI(server.id, sessionId, cmd);
              } else {
                // Per-message providers (e.g. Codex): don't launch yet,
                // CLI will be started on each 'input' message
                perMessageSessions.add(sessionId);
              }
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
            const inputProvider = getProvider(db, registry, msg.sessionId);

            // Persist user message to DB first
            db.saveMessage({
              sessionId: msg.sessionId,
              type: 'user',
              content: msg.text,
              timestamp: Date.now(),
            });
            db.updateSessionActivity(msg.sessionId);

            const inputCaps = inputProvider.getCapabilities();
            if (inputCaps.supportsStdin && sshManager.hasActiveChannel(msg.serverId, msg.sessionId)) {
              // Interactive provider with running CLI: write to stdin
              sshManager.sendInput(msg.serverId, msg.sessionId, inputProvider.formatInput(msg.text));
            } else {
              // Per-message provider (e.g. Codex) or dead channel: launch new CLI
              // Clean up previous parser so a fresh one is created for the new process
              const oldParser = parsers.get(msg.sessionId);
              if (oldParser) { oldParser.flush(); parsers.delete(msg.sessionId); }

              const inputSession = db.getSession(msg.sessionId);
              const resumeId = inputSession?.cliSessionId ?? inputSession?.claudeSessionId ?? undefined;
              const cmd = inputProvider.buildCommand({
                resumeSessionId: resumeId,
                workingDir: inputSession?.workingDir ?? undefined,
                // Non-stdin providers (e.g. Codex) must receive every turn as a CLI prompt.
                initialContext: inputCaps.supportsStdin ? undefined : msg.text,
              });

              perMessageSessions.add(msg.sessionId);

              // Ensure SSH is connected before launching
              if (!sshManager.isConnected(msg.serverId)) {
                const server = db.getServer(msg.serverId);
                if (server) {
                  await sshManager.connect({
                    id: server.id, host: server.host, port: server.port,
                    username: server.username, authType: server.authType as 'password' | 'privateKey',
                    password: server.password ?? undefined, privateKeyPath: server.privateKeyPath ?? undefined,
                  });
                }
              }

              await sshManager.startCLI(msg.serverId, msg.sessionId, cmd);

              // Interactive providers need the first message sent after the process starts.
              if (inputCaps.supportsStdin) {
                // Small delay for CLI to initialize before writing stdin
                setTimeout(() => {
                  try {
                    sshManager.sendInput(msg.serverId, msg.sessionId!, inputProvider.formatInput(msg.text!));
                  } catch { /* channel may have closed */ }
                }, 500);
              }
            }
            break;
          }

          case 'disconnect': {
            if (msg.sessionId) {
              const parser = parsers.get(msg.sessionId);
              if (parser) parser.flush();
              parsers.delete(msg.sessionId);
              perMessageSessions.delete(msg.sessionId);
              sshManager.stopSession(msg.serverId, msg.sessionId);
            } else {
              // Disconnect all sessions for this server
              const sessions = db.listSessions(msg.serverId);
              for (const s of sessions) {
                const parser = parsers.get(s.id);
                if (parser) parser.flush();
                parsers.delete(s.id);
                perMessageSessions.delete(s.id);
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
            perMessageSessions.delete(msg.sessionId);
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

              // Use provider to list remote sessions
              const providerName = msg.provider ?? 'claude';
              const lsProvider = registry.get(providerName);
              if (!lsProvider) {
                ws.send(JSON.stringify({ type: 'claude-sessions', serverId: msg.serverId, sessions: [] }));
                return;
              }

              const runCommand = async (command: string) => sshManager.runCommand(msg.serverId, null, command);
              const remoteSessions = await lsProvider.listRemoteSessions(runCommand, msg.workingDir);
              const sessionIds = remoteSessions.map((s) => s.id);

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
            const syncCliSessionId = syncSession?.cliSessionId ?? syncSession?.claudeSessionId;
            if (!syncCliSessionId) {
              ws.send(JSON.stringify({ type: 'sync-result', serverId: msg.serverId, sessionId: msg.sessionId, success: false, error: 'No CLI session ID found. Start a conversation first.' }));
              return;
            }
            if (!sshManager.isConnected(msg.serverId)) {
              ws.send(JSON.stringify({ type: 'sync-result', serverId: msg.serverId, sessionId: msg.sessionId, success: false, error: 'Not connected to server' }));
              return;
            }

            try {
              const syncProvider = getProvider(db, registry, msg.sessionId);
              const runCommand = async (command: string) => sshManager.runCommand(msg.serverId, null, command);
              const transcriptMessages = await syncProvider.syncTranscript(runCommand, syncCliSessionId, syncSession?.workingDir ?? undefined);

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

          case 'load-more': {
            if (!msg.sessionId || !msg.beforeTimestamp) return;
            const olderMessages = db.getMessagesBefore(msg.sessionId, msg.beforeTimestamp);
            ws.send(JSON.stringify({
              type: 'history-prepend',
              serverId: msg.serverId,
              sessionId: msg.sessionId,
              messages: olderMessages,
              hasMore: olderMessages.length >= 100,
            }));
            break;
          }

          case 'switch-provider': {
            if (!msg.sessionId || !msg.provider) return;
            const spSession = db.getSession(msg.sessionId);
            if (!spSession) return;

            const currentProviderName = spSession.provider ?? 'claude';
            const currentProvider = registry.get(currentProviderName);
            const targetProvider = registry.get(msg.provider);
            if (!currentProvider || !targetProvider) {
              ws.send(JSON.stringify({ type: 'status', serverId: msg.serverId, sessionId: msg.sessionId, status: 'error', error: `Unknown provider: ${msg.provider}` }));
              return;
            }

            try {
              // Step 1: Request summary from current CLI (if connected)
              let summary = '';
              if (sshManager.hasActiveChannel(msg.serverId, msg.sessionId)) {
                const summaryPrompt = currentProvider.requestSummary();
                sshManager.sendInput(msg.serverId, msg.sessionId, currentProvider.formatInput(summaryPrompt));

                // Wait for assistant response with timeout
                summary = await new Promise<string>((resolve) => {
                  const spParser = parsers.get(msg.sessionId!);
                  const timeout = setTimeout(() => resolve(''), 15_000);
                  const handler = (message: ParsedMessage) => {
                    if (message.type === 'assistant') {
                      clearTimeout(timeout);
                      spParser?.removeListener('message', handler);
                      resolve(message.content);
                    }
                  };
                  spParser?.on('message', handler);
                  if (!spParser) { clearTimeout(timeout); resolve(''); }
                });
              }

              // Fallback: use recent messages from DB
              if (!summary) {
                const recentMessages = db.getMessages(msg.sessionId, 20);
                summary = recentMessages
                  .filter((m) => m.type === 'assistant' || m.type === 'user')
                  .map((m) => `${m.type}: ${m.content}`)
                  .join('\n')
                  .slice(0, 2000);
              }

              // Step 2: Disconnect current CLI
              const spParser = parsers.get(msg.sessionId);
              if (spParser) { spParser.flush(); parsers.delete(msg.sessionId); }
              sshManager.stopSession(msg.serverId, msg.sessionId);

              // Step 3: Update session provider in DB
              db.updateSessionProvider(msg.sessionId, msg.provider);

              // Step 4: Insert system message about the switch
              const switchMsg = {
                sessionId: msg.sessionId,
                type: 'system' as const,
                content: `Switched from ${currentProviderName} to ${msg.provider}. Context synced.`,
                timestamp: Date.now(),
                provider: msg.provider,
              };
              db.saveMessage(switchMsg);
              broadcast(wss, { type: 'message', serverId: msg.serverId, sessionId: msg.sessionId, message: switchMsg });

              // Step 5: Launch new CLI with context
              const spServer = db.getServer(msg.serverId);
              if (!spServer) return;

              // Ensure SSH connected
              if (!sshManager.isConnected(msg.serverId)) {
                const config: ServerConfig = {
                  id: spServer.id, host: spServer.host, port: spServer.port,
                  username: spServer.username, authType: spServer.authType as 'password' | 'privateKey',
                  password: spServer.password ?? undefined,
                  privateKeyPath: spServer.privateKeyPath ?? undefined,
                };
                await sshManager.connect(config);
              }

              const cmd = targetProvider.buildCommand({
                workingDir: spSession.workingDir ?? undefined,
                initialContext: summary || undefined,
              });
              await sshManager.startCLI(msg.serverId, msg.sessionId, cmd);
              if (targetProvider.getCapabilities().supportsStdin && summary) {
                setTimeout(() => {
                  try {
                    sshManager.sendInput(
                      msg.serverId,
                      msg.sessionId!,
                      targetProvider.formatInput(summary),
                    );
                  } catch {
                    /* channel may have closed */
                  }
                }, 500);
              }

              broadcast(wss, { type: 'status', serverId: msg.serverId, sessionId: msg.sessionId, status: 'connected' });
            } catch (err: any) {
              console.error('[switch-provider] error:', err.message);
              ws.send(JSON.stringify({ type: 'status', serverId: msg.serverId, sessionId: msg.sessionId, status: 'error', error: err.message }));
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
