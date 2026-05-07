import { WebSocketServer, WebSocket } from 'ws';
import type { Server as HttpServer } from 'http';
import { SSHManager, type ServerConfig } from './ssh-manager.js';
import type { ParsedMessage, CLIProvider, OutputParser } from './providers/types.js';
import type { ProviderRegistry } from './providers/registry.js';
import type { Database, Workspace, WorkspacePrState, WorkspaceStatus } from './db.js';
import { buildWorkspaceInspector } from './workspace-inspector.js';
import { extractUrls, type RepoScriptName } from './repo-scripts.js';
import { normalizeWorkspaceAction, workspaceActionUpdate } from './workspace-actions.js';
import { shouldAutoStartInteractiveSession } from './session-start-policy.js';

/**
 * Single source of truth for workspace-scoped message types — these may omit
 * `serverId` (workspace CRUD operates above the server level). When adding a
 * new workspace message type, add it here AND to the `ClientMessage.type`
 * union below; the runtime guard derives from this list, so forgetting one
 * place no longer silently rejects the new message with "serverId required".
 */
const WORKSPACE_MSG_TYPES = [
  'list-workspaces', 'create-workspace', 'delete-workspace', 'update-workspace',
  'set-workspace-status', 'pin-workspace', 'archive-workspace', 'restore-workspace',
  'start-workspace-task', 'list-workspace-branches', 'fetch-workspace-inspector',
  'run-workspace-script', 'run-workspace-action',
] as const;
type WorkspaceMsgType = typeof WORKSPACE_MSG_TYPES[number];

interface ClientMessage {
  type:
    | 'connect' | 'input' | 'interrupt' | 'disconnect'
    | 'create-session' | 'delete-session'
    | 'fetch-git-info' | 'list-branches' | 'switch-branch'
    | 'exec' | 'sync-transcript'
    | 'list-claude-sessions' | 'list-cli-sessions'
    | 'load-more' | 'switch-provider' | 'reset-conversation' | 'resume-cli-session'
    | 'fetch-git-status' | 'fetch-git-diff' | 'fetch-pr-info' | 'git-commit' | 'git-create-pr'
    | 'revert-to-checkpoint' | 'list-checkpoints'
    | WorkspaceMsgType;
  serverId?: string;       // workspace messages may not have a serverId
  sessionId?: string;
  sessionName?: string;
  workingDir?: string;
  text?: string;
  branch?: string;
  command?: string;
  claudeSessionId?: string;
  beforeTimestamp?: number;
  provider?: string;
  message?: string;
  files?: string[];
  title?: string;
  body?: string;
  diffArgs?: string;
  checkpointId?: string;

  // workspace messages
  workspaceId?: string;
  repoPath?: string;
  workspaceName?: string;
  autoOpenLastSession?: boolean;
  workspaceStatus?: WorkspaceStatus;
  goal?: string | null;
  pinned?: boolean;
  prUrl?: string | null;
  prState?: WorkspacePrState;
  branchMode?: string;
  branchName?: string;
  worktreeMode?: string;
  worktreePath?: string;
  scriptName?: string;
  action?: string;
}

interface ServerMessage {
  type:
    | 'message' | 'status' | 'history' | 'history-prepend' | 'sessions'
    | 'git-info' | 'branches' | 'sync-result'
    | 'claude-sessions' | 'cli-sessions'
    | 'git-status' | 'git-diff' | 'pr-info' | 'git-commit-result' | 'git-create-pr-result'
    | 'checkpoints' | 'checkpoint-reverted'
    | 'workspace-list' | 'workspace-update' | 'workspace-deleted' | 'session-update'
    | 'workspace-branches' | 'workspace-inspector' | 'workspace-run-result' | 'workspace-action-result'
    | 'workspace-task-started' | 'workspace-error';
  serverId?: string;
  sessionId?: string | null;
  [key: string]: any;
}

export interface WorkspaceWithAggregates extends Workspace {
  totalSessionCount: number;
  lastActivityAt: number | null;
  activeSessionCount: number;
  dirtyFileCount: number | null;
}

async function buildWorkspaceWithAggregates(
  ws: Workspace, db: Database, sshManager: SSHManager,
): Promise<WorkspaceWithAggregates> {
  const agg = db.aggregateWorkspace(ws.id);
  // Count active SSH channels for sessions in this workspace.
  const sessions = db.listSessions(ws.serverId).filter((s) => s.workspaceId === ws.id);
  let activeSessionCount = 0;
  for (const s of sessions) {
    if (sshManager.hasActiveChannel(ws.serverId, s.id)) activeSessionCount += 1;
  }
  // Cheap dirty count: only attempt when SSH is already connected to avoid
  // forcing a connect on every list-workspaces. Counts non-empty porcelain lines.
  let dirtyFileCount: number | null = null;
  if (sshManager.isConnected(ws.serverId)) {
    try {
      const raw = await sshManager.fetchGitStatus(ws.serverId, workspaceCheckoutPath(db, ws));
      dirtyFileCount = raw.split('\n').filter((l) => l.length > 0).length;
    } catch {
      dirtyFileCount = null;
    }
  }
  return { ...ws, ...agg, activeSessionCount, dirtyFileCount };
}

/** Look up the CLIProvider for a session, falling back to default. */
function getProvider(db: Database, registry: ProviderRegistry, sessionId: string): CLIProvider {
  const session = db.getSession(sessionId);
  const providerName = session?.provider ?? 'claude';
  const provider = registry.get(providerName);
  if (!provider) throw new Error(`Unknown provider: ${providerName}`);
  return provider;
}

function workspaceCheckoutPath(db: Database, workspace: Workspace): string {
  const primary = workspace.primarySessionId ? db.getSession(workspace.primarySessionId) : undefined;
  if (primary?.workingDir) return primary.workingDir;

  const latestSession = db
    .listSessions(workspace.serverId)
    .find((session) => session.workspaceId === workspace.id && session.workingDir);
  return latestSession?.workingDir ?? workspace.repoPath;
}

function titleFromGoal(goal: string): string {
  const firstLine = goal.trim().split('\n').find((line) => line.trim().length > 0)?.trim() ?? 'Workspace task';
  return firstLine.length > 60 ? `${firstLine.slice(0, 57)}...` : firstLine;
}

function workspaceBranchMode(value?: string): 'current' | 'existing' | 'create' {
  return value === 'existing' || value === 'create' ? value : 'current';
}

function workspaceWorktreeMode(value?: string): 'main' | 'isolated' | 'existing' {
  return value === 'isolated' || value === 'existing' ? value : 'main';
}

function workspaceScriptName(value?: string): RepoScriptName | null {
  return value === 'setup' || value === 'run' || value === 'test' ? value : null;
}

export function setupWebSocket(httpServer: HttpServer, db: Database, registry: ProviderRegistry): SSHManager {
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
            // Also refresh git status for the changes panel
            sshManager.fetchGitStatus(serverId, s.workingDir).then((raw) => {
              broadcast(wss, { type: 'git-status', serverId, sessionId, raw });
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
        // Workspace CRUD messages may omit serverId; everything else requires it.
        // Derive the check from WORKSPACE_MSG_TYPES so the list lives in one place.
        if (!(WORKSPACE_MSG_TYPES as readonly string[]).includes(msg.type) && !msg.serverId) {
          ws.send(JSON.stringify({ type: 'status', status: 'error', error: 'serverId required' }));
          return;
        }
        // Local alias narrows `serverId` to `string` for all non-workspace cases without
        // having to update every existing handler. Workspace cases that need it should
        // re-check `msg.serverId` explicitly (see `create-workspace`).
        const serverId = msg.serverId as string;
        switch (msg.type) {
          case 'connect': {
            const server = db.getServer(serverId);
            if (!server) {
              ws.send(JSON.stringify({ type: 'status', serverId: serverId, status: 'error', error: 'Server not found' }));
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

            // Send chat history to this client, respecting chatStartedAt boundary
            let messages, totalCount;
            if (session.chatStartedAt) {
              messages = db.getMessagesAfter(session.id, session.chatStartedAt);
              totalCount = db.getMessageCountAfter(session.id, session.chatStartedAt);
            } else {
              messages = db.getMessages(session.id);
              totalCount = db.getMessageCount(session.id);
            }
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
                // Opening an existing historical chat should not create a new empty
                // CLI turn. The input handler starts a fresh process on demand.
                if (shouldAutoStartInteractiveSession(db, session)) {
                  const cmd = provider.buildCommand({
                    resumeSessionId: session.cliSessionId ?? session.claudeSessionId ?? undefined,
                    workingDir: session.workingDir ?? undefined,
                  });
                  await sshManager.startCLI(server.id, sessionId, cmd);
                }
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

            // Lazy workspace migration: probe git once per session and link
            // it to a workspace. Skip if already linked or already probed.
            if (session.workingDir && session.workspaceId === null && session.workspaceProbedAt === null) {
              try {
                const probe = await sshManager.probeGitRepo(server.id, session.workingDir);
                if (probe) {
                  const linkedWs = db.upsertWorkspaceByPath({
                    serverId: server.id,
                    repoPath: probe.canonicalPath,
                    remoteUrl: probe.remoteUrl,
                    defaultBranch: probe.defaultBranch,
                    name: probe.canonicalPath.split('/').filter(Boolean).pop() || 'workspace',
                  });
                  db.setSessionWorkspace(session.id, linkedWs.id);
                  const enriched = await buildWorkspaceWithAggregates(linkedWs, db, sshManager);
                  broadcast(wss, { type: 'workspace-update', workspace: enriched });
                  const refreshed = db.getSession(session.id);
                  if (refreshed) broadcast(wss, { type: 'session-update', session: refreshed });
                }
              } catch {
                /* probe failure is non-fatal */
              }
              // Mark probed regardless of outcome so we don't retry on every connect.
              // Once workspaceId is set, this is harmless; once it's null, this prevents
              // re-probing non-git working dirs.
              db.markSessionProbed(session.id);
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

            // Auto-checkpoint: snapshot git state before sending to CLI
            {
              const cpSession = db.getSession(msg.sessionId);
              if (cpSession?.workingDir && sshManager.isConnected(serverId)) {
                const cpTimestamp = Date.now();
                const tagName = `gate-cp-${msg.sessionId.slice(0, 8)}-${cpTimestamp}`;
                sshManager.createCheckpoint(serverId, cpSession.workingDir, tagName).then(({ branch, commitSha }) => {
                  db.saveCheckpoint(msg.sessionId!, cpTimestamp, tagName, branch, commitSha);
                }).catch(() => { /* checkpoint is best-effort */ });
              }
            }

            const inputCaps = inputProvider.getCapabilities();
            if (inputCaps.supportsStdin && sshManager.hasActiveChannel(serverId, msg.sessionId)) {
              // Interactive provider with running CLI: write to stdin
              sshManager.sendInput(serverId, msg.sessionId, inputProvider.formatInput(msg.text));
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
              if (!sshManager.isConnected(serverId)) {
                const server = db.getServer(serverId);
                if (server) {
                  await sshManager.connect({
                    id: server.id, host: server.host, port: server.port,
                    username: server.username, authType: server.authType as 'password' | 'privateKey',
                    password: server.password ?? undefined, privateKeyPath: server.privateKeyPath ?? undefined,
                  });
                }
              }

              await sshManager.startCLI(serverId, msg.sessionId, cmd);

              // Interactive providers need the first message sent after the process starts.
              if (inputCaps.supportsStdin) {
                // Small delay for CLI to initialize before writing stdin
                setTimeout(() => {
                  try {
                    sshManager.sendInput(serverId, msg.sessionId!, inputProvider.formatInput(msg.text!));
                  } catch { /* channel may have closed */ }
                }, 500);
              }
            }
            break;
          }

          case 'interrupt': {
            if (!msg.sessionId) return;
            if (sshManager.hasActiveChannel(serverId, msg.sessionId)) {
              // Escape key to exit any interactive prompt, then SIGINT (Ctrl+C) to stop generation
              sshManager.writeRaw(serverId, msg.sessionId, '\x1b');
              sshManager.writeRaw(serverId, msg.sessionId, '\x03');
              // Second Ctrl+C after a short delay to handle cases where the first one is buffered
              setTimeout(() => {
                try { sshManager.writeRaw(serverId, msg.sessionId!, '\x03'); } catch { /* ignore */ }
              }, 150);
            }
            break;
          }

          case 'list-workspaces': {
            const workspaces = db.listWorkspaces();
            const enriched = await Promise.all(workspaces.map((w) => buildWorkspaceWithAggregates(w, db, sshManager)));
            ws.send(JSON.stringify({ type: 'workspace-list', workspaces: enriched }));
            break;
          }

          case 'create-workspace': {
            if (!serverId || !msg.repoPath) {
              ws.send(JSON.stringify({ type: 'workspace-error', error: 'serverId and repoPath required' }));
              break;
            }
            try {
              await sshManager.ensureConnected(serverId);
            } catch (err: any) {
              ws.send(JSON.stringify({ type: 'workspace-error', error: `SSH connect failed: ${err.message}` }));
              break;
            }
            const probe = await sshManager.probeGitRepo(serverId, msg.repoPath);
            if (!probe) {
              ws.send(JSON.stringify({ type: 'workspace-error', error: `Path is not a git repository: ${msg.repoPath}` }));
              break;
            }
            const workspace = db.upsertWorkspaceByPath({
              serverId: serverId,
              repoPath: probe.canonicalPath,
              remoteUrl: probe.remoteUrl,
              defaultBranch: probe.defaultBranch,
              name: msg.workspaceName?.trim() || probe.canonicalPath.split('/').filter(Boolean).pop() || 'workspace',
            });
            const enriched = await buildWorkspaceWithAggregates(workspace, db, sshManager);
            broadcast(wss, { type: 'workspace-update', workspace: enriched });
            break;
          }

          case 'delete-workspace': {
            if (!msg.workspaceId) break;
            const workspace = db.getWorkspace(msg.workspaceId);
            if (!workspace) break;
            // Stop any active channels for sessions in this workspace.
            // Mirror the delete-session cleanup: flush parser before deleting
            // so any final buffered message isn't lost, and clear the
            // perMessageSessions entry to prevent leaks for Codex-style sessions.
            const wsSessions = db.listSessions(workspace.serverId, { includeHidden: true }).filter((s) => s.workspaceId === workspace.id);
            for (const s of wsSessions) {
              if (sshManager.hasActiveChannel(workspace.serverId, s.id)) sshManager.stopSession(workspace.serverId, s.id);
              const parser = parsers.get(s.id);
              if (parser) {
                parser.flush();
                parsers.delete(s.id);
              }
              perMessageSessions.delete(s.id);
            }
            db.deleteWorkspace(msg.workspaceId);
            broadcast(wss, { type: 'workspace-deleted', workspaceId: msg.workspaceId, removedSessionIds: wsSessions.map((s) => s.id) });
            break;
          }

          case 'update-workspace': {
            if (!msg.workspaceId) break;
            db.updateWorkspace(msg.workspaceId, {
              name: msg.workspaceName,
              autoOpenLastSession: msg.autoOpenLastSession,
              status: msg.workspaceStatus,
              goal: msg.goal,
              prUrl: msg.prUrl,
              prState: msg.prState,
            });
            const updated = db.getWorkspace(msg.workspaceId);
            if (updated) {
              const enriched = await buildWorkspaceWithAggregates(updated, db, sshManager);
              broadcast(wss, { type: 'workspace-update', workspace: enriched });
            }
            break;
          }

          case 'set-workspace-status': {
            if (!msg.workspaceId || !msg.workspaceStatus) break;
            db.updateWorkspace(msg.workspaceId, { status: msg.workspaceStatus });
            const updated = db.getWorkspace(msg.workspaceId);
            if (updated) {
              const enriched = await buildWorkspaceWithAggregates(updated, db, sshManager);
              broadcast(wss, { type: 'workspace-update', workspace: enriched });
            }
            break;
          }

          case 'pin-workspace': {
            if (!msg.workspaceId || msg.pinned === undefined) break;
            db.updateWorkspace(msg.workspaceId, { pinnedAt: msg.pinned ? Date.now() : null });
            const updated = db.getWorkspace(msg.workspaceId);
            if (updated) {
              const enriched = await buildWorkspaceWithAggregates(updated, db, sshManager);
              broadcast(wss, { type: 'workspace-update', workspace: enriched });
            }
            break;
          }

          case 'archive-workspace': {
            if (!msg.workspaceId) break;
            db.archiveWorkspace(msg.workspaceId);
            const updated = db.getWorkspace(msg.workspaceId);
            if (updated) {
              const enriched = await buildWorkspaceWithAggregates(updated, db, sshManager);
              broadcast(wss, { type: 'workspace-update', workspace: enriched });
            }
            break;
          }

          case 'restore-workspace': {
            if (!msg.workspaceId) break;
            db.restoreWorkspace(msg.workspaceId);
            const updated = db.getWorkspace(msg.workspaceId);
            if (updated) {
              const enriched = await buildWorkspaceWithAggregates(updated, db, sshManager);
              broadcast(wss, { type: 'workspace-update', workspace: enriched });
            }
            break;
          }

          case 'list-workspace-branches': {
            if (!msg.workspaceId) break;
            const workspace = db.getWorkspace(msg.workspaceId);
            if (!workspace) {
              ws.send(JSON.stringify({ type: 'workspace-error', error: 'Workspace not found' }));
              break;
            }
            const configServer = db.getServer(workspace.serverId);
            if (!configServer) {
              ws.send(JSON.stringify({ type: 'workspace-error', error: 'Server not found' }));
              break;
            }
            try {
              if (!sshManager.isConnected(workspace.serverId)) {
                await sshManager.connect({
                  id: configServer.id,
                  host: configServer.host,
                  port: configServer.port,
                  username: configServer.username,
                  authType: configServer.authType as 'password' | 'privateKey',
                  password: configServer.password ?? undefined,
                  privateKeyPath: configServer.privateKeyPath ?? undefined,
                });
              } else {
                await sshManager.ensureConnected(workspace.serverId);
              }
              const branches = await sshManager.listBranches(workspace.serverId, workspaceCheckoutPath(db, workspace));
              ws.send(JSON.stringify({
                type: 'workspace-branches',
                serverId: workspace.serverId,
                workspaceId: workspace.id,
                ...branches,
              }));
            } catch (err: any) {
              ws.send(JSON.stringify({
                type: 'workspace-error',
                serverId: workspace.serverId,
                error: `Branch list failed: ${err.message}`,
              }));
            }
            break;
          }

          case 'fetch-workspace-inspector': {
            if (!msg.workspaceId) break;
            const inspector = buildWorkspaceInspector(db, msg.workspaceId);
            if (!inspector) {
              ws.send(JSON.stringify({ type: 'workspace-error', error: 'Workspace not found' }));
              break;
            }
            if (sshManager.isConnected(inspector.serverId)) {
              try {
                inspector.scripts = await sshManager.readRepoScripts(
                  inspector.serverId,
                  workspaceCheckoutPath(db, inspector.workspace),
                );
              } catch {
                inspector.scripts = {};
              }
            }
            ws.send(JSON.stringify({ type: 'workspace-inspector', ...inspector }));
            break;
          }

          case 'run-workspace-script': {
            if (!msg.workspaceId) break;
            const scriptName = workspaceScriptName(msg.scriptName);
            if (!scriptName) {
              ws.send(JSON.stringify({ type: 'workspace-error', error: 'Unknown workspace script' }));
              break;
            }
            const workspace = db.getWorkspace(msg.workspaceId);
            if (!workspace) {
              ws.send(JSON.stringify({ type: 'workspace-error', error: 'Workspace not found' }));
              break;
            }
            const configServer = db.getServer(workspace.serverId);
            if (!configServer) {
              ws.send(JSON.stringify({ type: 'workspace-error', error: 'Server not found' }));
              break;
            }

            try {
              if (!sshManager.isConnected(workspace.serverId)) {
                await sshManager.connect({
                  id: configServer.id,
                  host: configServer.host,
                  port: configServer.port,
                  username: configServer.username,
                  authType: configServer.authType as 'password' | 'privateKey',
                  password: configServer.password ?? undefined,
                  privateKeyPath: configServer.privateKeyPath ?? undefined,
                });
              } else {
                await sshManager.ensureConnected(workspace.serverId);
              }
              const checkoutPath = workspaceCheckoutPath(db, workspace);
              const scripts = await sshManager.readRepoScripts(workspace.serverId, checkoutPath);
              const command = scripts[scriptName];
              if (!command) {
                ws.send(JSON.stringify({ type: 'workspace-error', error: `Script not configured: ${scriptName}` }));
                break;
              }
              broadcast(wss, {
                type: 'workspace-run-result',
                workspaceId: workspace.id,
                scriptName,
                status: 'running',
                output: '',
                urls: [],
              });
              const output = await sshManager.runRepoScript(workspace.serverId, checkoutPath, command);
              broadcast(wss, {
                type: 'workspace-run-result',
                workspaceId: workspace.id,
                scriptName,
                status: 'done',
                output,
                urls: extractUrls(output),
              });
            } catch (err: any) {
              broadcast(wss, {
                type: 'workspace-run-result',
                workspaceId: workspace.id,
                scriptName,
                status: 'error',
                output: '',
                urls: [],
                error: err.message,
              });
            }
            break;
          }

          case 'run-workspace-action': {
            if (!msg.workspaceId) break;
            const action = normalizeWorkspaceAction(msg.action);
            if (!action) {
              ws.send(JSON.stringify({ type: 'workspace-error', error: 'Unknown workspace action' }));
              break;
            }
            const workspace = db.getWorkspace(msg.workspaceId);
            if (!workspace) {
              ws.send(JSON.stringify({ type: 'workspace-error', error: 'Workspace not found' }));
              break;
            }

            if (action.startsWith('mark-')) {
              db.updateWorkspace(workspace.id, workspaceActionUpdate(action));
              const updated = db.getWorkspace(workspace.id);
              if (updated) {
                const enriched = await buildWorkspaceWithAggregates(updated, db, sshManager);
                broadcast(wss, { type: 'workspace-update', workspace: enriched });
              }
              broadcast(wss, { type: 'workspace-action-result', workspaceId: workspace.id, action, status: 'done' });
              break;
            }

            const configServer = db.getServer(workspace.serverId);
            if (!configServer) {
              ws.send(JSON.stringify({ type: 'workspace-error', error: 'Server not found' }));
              break;
            }
            const workingDir = workspaceCheckoutPath(db, workspace);

            try {
              if (!sshManager.isConnected(workspace.serverId)) {
                await sshManager.connect({
                  id: configServer.id,
                  host: configServer.host,
                  port: configServer.port,
                  username: configServer.username,
                  authType: configServer.authType as 'password' | 'privateKey',
                  password: configServer.password ?? undefined,
                  privateKeyPath: configServer.privateKeyPath ?? undefined,
                });
              } else {
                await sshManager.ensureConnected(workspace.serverId);
              }

              broadcast(wss, { type: 'workspace-action-result', workspaceId: workspace.id, action, status: 'running' });
              if (action === 'push') {
                const output = await sshManager.gitPush(workspace.serverId, workingDir);
                broadcast(wss, { type: 'workspace-action-result', workspaceId: workspace.id, action, status: 'done', output });
              } else if (action === 'create-pr') {
                const title = msg.title?.trim() || workspace.goal || workspace.name;
                const url = await sshManager.gitCreatePR(workspace.serverId, workingDir, title, msg.body ?? '');
                db.updateWorkspace(workspace.id, workspaceActionUpdate(action, { url }));
                const updated = db.getWorkspace(workspace.id);
                if (updated) {
                  const enriched = await buildWorkspaceWithAggregates(updated, db, sshManager);
                  broadcast(wss, { type: 'workspace-update', workspace: enriched });
                }
                broadcast(wss, { type: 'workspace-action-result', workspaceId: workspace.id, action, status: 'done', url });
              }
            } catch (err: any) {
              broadcast(wss, {
                type: 'workspace-action-result',
                workspaceId: workspace.id,
                action,
                status: 'error',
                error: err.message,
              });
            }
            break;
          }

          case 'start-workspace-task': {
            if (!msg.workspaceId || !msg.goal?.trim()) break;
            const workspace = db.getWorkspace(msg.workspaceId);
            if (!workspace) {
              ws.send(JSON.stringify({ type: 'workspace-error', error: 'Workspace not found' }));
              break;
            }
            const goal = msg.goal.trim();
            const providerName = msg.provider ?? 'claude';
            const provider = registry.get(providerName);
            if (!provider) {
              ws.send(JSON.stringify({ type: 'workspace-error', error: `Unknown provider: ${providerName}` }));
              break;
            }

            const configServer = db.getServer(workspace.serverId);
            if (!configServer) {
              ws.send(JSON.stringify({ type: 'workspace-error', error: 'Server not found' }));
              break;
            }

            const baseRepoPath = workspaceCheckoutPath(db, workspace);
            let workingDir = baseRepoPath;
            let startGitInfo: Awaited<ReturnType<SSHManager['fetchGitInfo']>> = null;
            try {
              if (!sshManager.isConnected(workspace.serverId)) {
                await sshManager.connect({
                  id: configServer.id,
                  host: configServer.host,
                  port: configServer.port,
                  username: configServer.username,
                  authType: configServer.authType as 'password' | 'privateKey',
                  password: configServer.password ?? undefined,
                  privateKeyPath: configServer.privateKeyPath ?? undefined,
                });
              } else {
                await sshManager.ensureConnected(workspace.serverId);
              }
              const prepared = await sshManager.prepareWorkspaceStart(workspace.serverId, baseRepoPath, {
                branchMode: workspaceBranchMode(msg.branchMode),
                branchName: msg.branchName,
                worktreeMode: workspaceWorktreeMode(msg.worktreeMode),
                worktreePath: msg.worktreePath,
              });
              workingDir = prepared.workingDir;
              startGitInfo = prepared.gitInfo;
            } catch (err: any) {
              ws.send(JSON.stringify({
                type: 'workspace-error',
                serverId: workspace.serverId,
                error: `Workspace checkout failed: ${err.message}`,
              }));
              break;
            }

            const session = db.createSession(
              workspace.serverId,
              titleFromGoal(goal),
              workingDir,
              providerName,
              { workspaceId: workspace.id },
            );
            db.setWorkspacePrimarySession(workspace.id, session.id);
            db.updateWorkspace(workspace.id, { goal, status: 'in-progress', primarySessionId: session.id });
            db.saveMessage({
              sessionId: session.id,
              type: 'user',
              content: goal,
              timestamp: Date.now(),
            });
            db.updateSessionActivity(session.id);

            const sessions = db.listSessions(workspace.serverId);
            broadcast(wss, { type: 'sessions', serverId: workspace.serverId, sessions });

            const updated = db.getWorkspace(workspace.id);
            let enriched: WorkspaceWithAggregates | null = null;
            if (updated) {
              enriched = await buildWorkspaceWithAggregates(updated, db, sshManager);
              broadcast(wss, { type: 'workspace-update', workspace: enriched });
            }
            if (startGitInfo) {
              broadcast(wss, { type: 'git-info', serverId: workspace.serverId, sessionId: session.id, ...startGitInfo });
            }

            try {
              const caps = provider.getCapabilities();
              const cmd = provider.buildCommand({
                workingDir,
                initialContext: caps.supportsStdin ? undefined : goal,
              });
              if (!caps.supportsStdin) perMessageSessions.add(session.id);
              await sshManager.startCLI(workspace.serverId, session.id, cmd);
              if (caps.supportsStdin) {
                setTimeout(() => {
                  try {
                    sshManager.sendInput(workspace.serverId, session.id, provider.formatInput(goal));
                  } catch { /* channel may have closed */ }
                }, 500);
              }

              ws.send(JSON.stringify({
                type: 'workspace-task-started',
                serverId: workspace.serverId,
                workspace: enriched ?? undefined,
                workspaceId: workspace.id,
                session,
              }));
            } catch (err: any) {
              broadcast(wss, {
                type: 'status',
                serverId: workspace.serverId,
                sessionId: session.id,
                status: 'error',
                error: err.message,
              });
              ws.send(JSON.stringify({
                type: 'workspace-error',
                serverId: workspace.serverId,
                sessionId: session.id,
                error: `Workspace task start failed: ${err.message}`,
              }));
            }
            break;
          }

          case 'disconnect': {
            if (msg.sessionId) {
              const parser = parsers.get(msg.sessionId);
              if (parser) parser.flush();
              parsers.delete(msg.sessionId);
              perMessageSessions.delete(msg.sessionId);
              sshManager.stopSession(serverId, msg.sessionId);
            } else {
              // Disconnect all sessions for this server
              const sessions = db.listSessions(serverId);
              for (const s of sessions) {
                const parser = parsers.get(s.id);
                if (parser) parser.flush();
                parsers.delete(s.id);
                perMessageSessions.delete(s.id);
              }
              await sshManager.disconnect(serverId);
            }
            break;
          }

          case 'create-session': {
            const name = msg.sessionName || 'New Session';
            const session = db.createSession(serverId, name, msg.workingDir || null, msg.provider);
            // Pre-fill CLI session ID if binding to an existing terminal session
            if (msg.claudeSessionId) {
              db.updateClaudeSessionId(session.id, msg.claudeSessionId);
              session.claudeSessionId = msg.claudeSessionId;
              session.cliSessionId = msg.claudeSessionId;
            }
            // Link to workspace immediately so the session appears under the correct
            // workspace in the sidebar rather than under the Loose footer until the
            // first connect triggers the lazy probe-and-link path.
            if (msg.workspaceId) {
              db.setSessionWorkspace(session.id, msg.workspaceId);
              session.workspaceId = msg.workspaceId;
            }
            const sessions = db.listSessions(serverId);
            broadcast(wss, { type: 'sessions', serverId: serverId, sessions });
            // Also tell the sender which session was created
            ws.send(JSON.stringify({ type: 'session-created', serverId: serverId, session }));
            break;
          }

          case 'delete-session': {
            if (!msg.sessionId) return;
            // Stop the channel if running
            sshManager.stopSession(serverId, msg.sessionId);
            const parser = parsers.get(msg.sessionId);
            if (parser) parser.flush();
            parsers.delete(msg.sessionId);
            perMessageSessions.delete(msg.sessionId);
            // Delete from DB (cascade deletes messages)
            db.deleteSession(msg.sessionId);
            const sessions = db.listSessions(serverId);
            broadcast(wss, { type: 'sessions', serverId: serverId, sessions });
            break;
          }

          case 'fetch-git-info': {
            if (!msg.sessionId) return;
            const gitSession = db.getSession(msg.sessionId);
            if (!gitSession?.workingDir) return;
            if (!sshManager.isConnected(serverId)) return;
            const gitInfo = await sshManager.fetchGitInfo(serverId, gitSession.workingDir);
            if (gitInfo) {
              broadcast(wss, { type: 'git-info', serverId: serverId, sessionId: msg.sessionId, ...gitInfo });
            }
            break;
          }

          case 'list-branches': {
            if (!msg.sessionId) return;
            const brSession = db.getSession(msg.sessionId);
            if (!brSession?.workingDir) return;
            if (!sshManager.isConnected(serverId)) return;
            const branches = await sshManager.listBranches(serverId, brSession.workingDir);
            ws.send(JSON.stringify({ type: 'branches', serverId: serverId, sessionId: msg.sessionId, ...branches }));
            break;
          }

          case 'switch-branch': {
            if (!msg.sessionId || !msg.branch) return;
            const swSession = db.getSession(msg.sessionId);
            if (!swSession?.workingDir) return;
            if (!sshManager.isConnected(serverId)) return;
            const newInfo = await sshManager.switchBranch(serverId, swSession.workingDir, msg.branch);
            broadcast(wss, { type: 'git-info', serverId: serverId, sessionId: msg.sessionId, ...newInfo });
            break;
          }

          case 'exec': {
            if (!msg.sessionId || !msg.command) return;
            if (!sshManager.isConnected(serverId)) {
              ws.send(JSON.stringify({ type: 'status', serverId: serverId, sessionId: msg.sessionId, status: 'error', error: 'Not connected to server' }));
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

            const { stdout, stderr, exitCode } = await sshManager.runCommand(serverId, execDir, msg.command);
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
            broadcast(wss, { type: 'message', serverId: serverId, sessionId: msg.sessionId, message: resultMessage });
            break;
          }

          case 'list-claude-sessions':
          case 'list-cli-sessions': {
            if (!msg.workingDir) return;
            const lsServer = db.getServer(serverId);
            if (!lsServer) {
              console.log('[list-cli-sessions] server not found:', serverId);
              ws.send(JSON.stringify({ type: 'cli-sessions', serverId: serverId, sessions: [] }));
              return;
            }

            try {
              // Ensure SSH is connected (dialog may open before any session connects)
              if (!sshManager.isConnected(serverId)) {
                console.log('[list-cli-sessions] SSH not connected, auto-connecting...');
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
                ws.send(JSON.stringify({ type: 'cli-sessions', serverId: serverId, sessions: [] }));
                return;
              }

              const runCommand = async (command: string) => sshManager.runCommand(serverId, null, command);
              const remoteSessions = await lsProvider.listRemoteSessions(runCommand, msg.workingDir);
              const sessionIds = remoteSessions.map((s) => s.id);

              console.log('[list-cli-sessions] found %d sessions', sessionIds.length);
              ws.send(JSON.stringify({ type: 'cli-sessions', serverId: serverId, sessions: sessionIds }));
            } catch (err: any) {
              console.error('[list-cli-sessions] error:', err.message);
              ws.send(JSON.stringify({ type: 'cli-sessions', serverId: serverId, sessions: [] }));
            }
            break;
          }

          case 'sync-transcript': {
            if (!msg.sessionId) return;
            const syncSession = db.getSession(msg.sessionId);
            const syncCliSessionId = syncSession?.cliSessionId ?? syncSession?.claudeSessionId;
            if (!syncCliSessionId) {
              ws.send(JSON.stringify({ type: 'sync-result', serverId: serverId, sessionId: msg.sessionId, success: false, error: 'No CLI session ID found. Start a conversation first.' }));
              return;
            }
            if (!sshManager.isConnected(serverId)) {
              ws.send(JSON.stringify({ type: 'sync-result', serverId: serverId, sessionId: msg.sessionId, success: false, error: 'Not connected to server' }));
              return;
            }

            try {
              const syncProvider = getProvider(db, registry, msg.sessionId);
              const runCommand = async (command: string) => sshManager.runCommand(serverId, null, command);
              const transcriptMessages = await syncProvider.syncTranscript(runCommand, syncCliSessionId, syncSession?.workingDir ?? undefined);

              if (transcriptMessages.length === 0) {
                ws.send(JSON.stringify({ type: 'sync-result', serverId: serverId, sessionId: msg.sessionId, success: true, added: 0 }));
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

                // Expand chatStartedAt to include synced messages if they fall before the boundary
                if (syncSession?.chatStartedAt) {
                  const earliestSynced = Math.min(...newMessages.map((m) => m.timestamp));
                  if (earliestSynced < syncSession.chatStartedAt) {
                    db.updateChatStartedAt(msg.sessionId!, earliestSynced);
                  }
                }
              }

              // Send updated history respecting chatStartedAt
              const refreshedSession = db.getSession(msg.sessionId!);
              let allMessages;
              if (refreshedSession?.chatStartedAt) {
                allMessages = db.getMessagesAfter(msg.sessionId!, refreshedSession.chatStartedAt);
              } else {
                allMessages = db.getMessages(msg.sessionId!);
              }
              ws.send(JSON.stringify({ type: 'history', serverId: serverId, sessionId: msg.sessionId, messages: allMessages }));
              ws.send(JSON.stringify({ type: 'sync-result', serverId: serverId, sessionId: msg.sessionId, success: true, added: newMessages.length }));
            } catch (err: any) {
              ws.send(JSON.stringify({ type: 'sync-result', serverId: serverId, sessionId: msg.sessionId, success: false, error: err.message }));
            }
            break;
          }

          case 'load-more': {
            if (!msg.sessionId || !msg.beforeTimestamp) return;
            const olderMessages = db.getMessagesBefore(msg.sessionId, msg.beforeTimestamp);
            ws.send(JSON.stringify({
              type: 'history-prepend',
              serverId: serverId,
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
              ws.send(JSON.stringify({ type: 'status', serverId: serverId, sessionId: msg.sessionId, status: 'error', error: `Unknown provider: ${msg.provider}` }));
              return;
            }

            try {
              // Step 1: Request summary from current CLI (if connected)
              let summary = '';
              if (sshManager.hasActiveChannel(serverId, msg.sessionId)) {
                const summaryPrompt = currentProvider.requestSummary();
                sshManager.sendInput(serverId, msg.sessionId, currentProvider.formatInput(summaryPrompt));

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
              sshManager.stopSession(serverId, msg.sessionId);

              // Step 3: Update session provider in DB (saves current cliSessionId, restores target's)
              db.updateSessionProvider(msg.sessionId, msg.provider);
              broadcast(wss, {
                type: 'sessions',
                serverId: serverId,
                sessions: db.listSessions(serverId),
              });

              // Check if we can resume an existing session for the target provider
              const updatedSession = db.getSession(msg.sessionId);
              const resumeId = updatedSession?.cliSessionId ?? undefined;

              // Step 4: Insert system message showing what happened
              let switchContent = `Switched from ${currentProviderName} to ${msg.provider}.`;
              if (resumeId) {
                switchContent += ` Resuming existing ${msg.provider} session.`;
              }
              if (summary) {
                switchContent += `\n\nContext summary:\n\n${summary}`;
              } else {
                switchContent += ' No prior context to sync.';
              }
              const switchMsg = {
                sessionId: msg.sessionId,
                type: 'system' as const,
                content: switchContent,
                timestamp: Date.now(),
                provider: msg.provider,
              };
              db.saveMessage(switchMsg);
              broadcast(wss, { type: 'message', serverId: serverId, sessionId: msg.sessionId, message: switchMsg });

              // Step 5: Launch new CLI with context
              const spServer = db.getServer(serverId);
              if (!spServer) return;

              // Ensure SSH connected
              if (!sshManager.isConnected(serverId)) {
                const config: ServerConfig = {
                  id: spServer.id, host: spServer.host, port: spServer.port,
                  username: spServer.username, authType: spServer.authType as 'password' | 'privateKey',
                  password: spServer.password ?? undefined,
                  privateKeyPath: spServer.privateKeyPath ?? undefined,
                };
                await sshManager.connect(config);
              }

              const targetCaps = targetProvider.getCapabilities();
              if (targetCaps.supportsStdin) {
                // Interactive provider (e.g. Claude): launch once, keep running
                perMessageSessions.delete(msg.sessionId);
                const cmd = targetProvider.buildCommand({
                  resumeSessionId: resumeId,
                  workingDir: spSession.workingDir ?? undefined,
                  // Per-message providers need context in the command itself
                  initialContext: targetCaps.supportsStdin ? undefined : (summary || undefined),
                });
                await sshManager.startCLI(serverId, msg.sessionId, cmd);
                // Always send summary via stdin so the target provider gets cross-provider context
                if (summary) {
                  setTimeout(() => {
                    try {
                      sshManager.sendInput(
                        serverId,
                        msg.sessionId!,
                        targetProvider.formatInput(summary),
                      );
                    } catch {
                      /* channel may have closed */
                    }
                  }, 500);
                }
              } else {
                // Per-message provider (e.g. Codex): don't launch yet, context will be
                // passed via initialContext in buildCommand on next user input
                perMessageSessions.add(msg.sessionId);
              }

              broadcast(wss, { type: 'status', serverId: serverId, sessionId: msg.sessionId, status: 'connected' });
            } catch (err: any) {
              console.error('[switch-provider] error:', err.message);
              ws.send(JSON.stringify({ type: 'status', serverId: serverId, sessionId: msg.sessionId, status: 'error', error: err.message }));
            }
            break;
          }

          case 'reset-conversation': {
            if (!msg.sessionId) return;
            const rcSession = db.getSession(msg.sessionId);
            if (!rcSession) return;

            try {
              // Stop current CLI
              const rcParser = parsers.get(msg.sessionId);
              if (rcParser) { rcParser.flush(); parsers.delete(msg.sessionId); }
              sshManager.stopSession(serverId, msg.sessionId);

              // Clear CLI session ID so next launch won't --resume
              db.clearCliSessionId(msg.sessionId);

              // Set chat boundary — messages before this are hidden
              const rcNow = Date.now();
              db.updateChatStartedAt(msg.sessionId, rcNow);

              // Insert system message
              const rcMsg = {
                sessionId: msg.sessionId,
                type: 'system' as const,
                content: 'Started a new conversation.',
                timestamp: rcNow,
                provider: rcSession.provider,
              };
              db.saveMessage(rcMsg);

              // Send clean slate to frontend
              broadcast(wss, { type: 'history', serverId: serverId, sessionId: msg.sessionId, messages: [], hasMore: false });

              // Re-launch CLI without resume
              const rcServer = db.getServer(serverId);
              if (!rcServer) return;

              if (!sshManager.isConnected(serverId)) {
                const config: ServerConfig = {
                  id: rcServer.id, host: rcServer.host, port: rcServer.port,
                  username: rcServer.username, authType: rcServer.authType as 'password' | 'privateKey',
                  password: rcServer.password ?? undefined, privateKeyPath: rcServer.privateKeyPath ?? undefined,
                };
                await sshManager.connect(config);
              }

              const rcProvider = getProvider(db, registry, msg.sessionId);
              const rcCaps = rcProvider.getCapabilities();

              if (rcCaps.supportsStdin) {
                perMessageSessions.delete(msg.sessionId);
                const cmd = rcProvider.buildCommand({
                  workingDir: rcSession.workingDir ?? undefined,
                });
                await sshManager.startCLI(serverId, msg.sessionId, cmd);
              } else {
                perMessageSessions.add(msg.sessionId);
              }

              broadcast(wss, { type: 'status', serverId: serverId, sessionId: msg.sessionId, status: 'connected' });
            } catch (err: any) {
              console.error('[reset-conversation] error:', err.message);
              ws.send(JSON.stringify({ type: 'status', serverId: serverId, sessionId: msg.sessionId, status: 'error', error: err.message }));
            }
            break;
          }

          case 'resume-cli-session': {
            if (!msg.sessionId || !msg.claudeSessionId) return;
            const rsSession = db.getSession(msg.sessionId);
            if (!rsSession) return;

            try {
              // Stop current CLI
              const rsParser = parsers.get(msg.sessionId);
              if (rsParser) { rsParser.flush(); parsers.delete(msg.sessionId); }
              sshManager.stopSession(serverId, msg.sessionId);

              // Update cliSessionId to the selected one
              db.updateCliSessionId(msg.sessionId, msg.claudeSessionId);
              db.updateClaudeSessionId(msg.sessionId, msg.claudeSessionId);

              // Auto-sync transcript from the resumed CLI session
              let syncedMessages: ParsedMessage[] = [];
              try {
                const rsProvider = getProvider(db, registry, msg.sessionId);
                const runCommand = async (command: string) => sshManager.runCommand(serverId, null, command);
                syncedMessages = await rsProvider.syncTranscript(runCommand, msg.claudeSessionId, rsSession.workingDir ?? undefined);
              } catch { /* sync is best-effort */ }

              // Set chatStartedAt to the earliest synced message, or now if none
              const rsNow = Date.now();
              let chatBoundary = rsNow;
              if (syncedMessages.length > 0) {
                chatBoundary = Math.min(...syncedMessages.map((m) => m.timestamp));
              }
              db.updateChatStartedAt(msg.sessionId, chatBoundary);

              // Save synced messages (dedup against existing)
              if (syncedMessages.length > 0) {
                const existing = db.getMessages(msg.sessionId, 10000);
                const signatures = new Set<string>();
                for (const m of existing) {
                  signatures.add(msgSignature(m.type, m.content));
                }
                const newMsgs = syncedMessages.filter(
                  (m) => !signatures.has(msgSignature(m.type, m.content)),
                );
                if (newMsgs.length > 0) {
                  db.saveMessages(newMsgs.map((m) => ({
                    sessionId: msg.sessionId!,
                    type: m.type,
                    content: m.content,
                    toolName: m.toolName,
                    toolDetail: m.toolDetail,
                    timestamp: m.timestamp,
                  })));
                }
              }

              // Insert system message
              const rsMsg = {
                sessionId: msg.sessionId,
                type: 'system' as const,
                content: `Resumed CLI session: ${msg.claudeSessionId}`,
                timestamp: rsNow,
                provider: rsSession.provider,
              };
              db.saveMessage(rsMsg);

              // Send history with synced messages
              const rsMessages = db.getMessagesAfter(msg.sessionId, chatBoundary);
              const rsTotalCount = db.getMessageCountAfter(msg.sessionId, chatBoundary);
              broadcast(wss, { type: 'history', serverId: serverId, sessionId: msg.sessionId, messages: rsMessages, hasMore: rsTotalCount > rsMessages.length });

              // Re-launch CLI with --resume
              const rsServer = db.getServer(serverId);
              if (!rsServer) return;

              if (!sshManager.isConnected(serverId)) {
                const config: ServerConfig = {
                  id: rsServer.id, host: rsServer.host, port: rsServer.port,
                  username: rsServer.username, authType: rsServer.authType as 'password' | 'privateKey',
                  password: rsServer.password ?? undefined, privateKeyPath: rsServer.privateKeyPath ?? undefined,
                };
                await sshManager.connect(config);
              }

              const rsProvider = getProvider(db, registry, msg.sessionId);
              const rsCaps = rsProvider.getCapabilities();

              if (rsCaps.supportsStdin) {
                perMessageSessions.delete(msg.sessionId);
                const cmd = rsProvider.buildCommand({
                  resumeSessionId: msg.claudeSessionId,
                  workingDir: rsSession.workingDir ?? undefined,
                });
                await sshManager.startCLI(serverId, msg.sessionId, cmd);
              } else {
                perMessageSessions.add(msg.sessionId);
              }

              broadcast(wss, { type: 'status', serverId: serverId, sessionId: msg.sessionId, status: 'connected' });
            } catch (err: any) {
              console.error('[resume-cli-session] error:', err.message);
              ws.send(JSON.stringify({ type: 'status', serverId: serverId, sessionId: msg.sessionId, status: 'error', error: err.message }));
            }
            break;
          }

          case 'fetch-git-status': {
            if (!msg.sessionId) return;
            const gsSession = db.getSession(msg.sessionId);
            if (!gsSession?.workingDir) return;
            if (!sshManager.isConnected(serverId)) return;
            const raw = await sshManager.fetchGitStatus(serverId, gsSession.workingDir);
            ws.send(JSON.stringify({ type: 'git-status', serverId: serverId, sessionId: msg.sessionId, raw }));
            break;
          }

          case 'fetch-git-diff': {
            if (!msg.sessionId) return;
            const gdSession = db.getSession(msg.sessionId);
            if (!gdSession?.workingDir) return;
            if (!sshManager.isConnected(serverId)) return;
            const diff = await sshManager.fetchGitDiff(serverId, gdSession.workingDir, msg.diffArgs ?? '');
            ws.send(JSON.stringify({ type: 'git-diff', serverId: serverId, sessionId: msg.sessionId, diff }));
            break;
          }

          case 'fetch-pr-info': {
            if (!msg.sessionId) return;
            const prSession = db.getSession(msg.sessionId);
            if (!prSession?.workingDir) return;
            if (!sshManager.isConnected(serverId)) return;
            const prJson = await sshManager.fetchPRInfo(serverId, prSession.workingDir);
            ws.send(JSON.stringify({ type: 'pr-info', serverId: serverId, sessionId: msg.sessionId, data: prJson }));
            break;
          }

          case 'git-commit': {
            if (!msg.sessionId || !msg.message) return;
            const gcSession = db.getSession(msg.sessionId);
            if (!gcSession?.workingDir) return;
            if (!sshManager.isConnected(serverId)) return;
            try {
              const result = await sshManager.gitCommit(serverId, gcSession.workingDir, msg.message, msg.files);
              ws.send(JSON.stringify({ type: 'git-commit-result', serverId: serverId, sessionId: msg.sessionId, success: true, output: result }));
            } catch (err: any) {
              ws.send(JSON.stringify({ type: 'git-commit-result', serverId: serverId, sessionId: msg.sessionId, success: false, error: err.message }));
            }
            break;
          }

          case 'git-create-pr': {
            if (!msg.sessionId || !msg.title) return;
            const cpSession = db.getSession(msg.sessionId);
            if (!cpSession?.workingDir) return;
            if (!sshManager.isConnected(serverId)) return;
            try {
              const url = await sshManager.gitCreatePR(serverId, cpSession.workingDir, msg.title, msg.body ?? '');
              ws.send(JSON.stringify({ type: 'git-create-pr-result', serverId: serverId, sessionId: msg.sessionId, success: true, url }));
            } catch (err: any) {
              ws.send(JSON.stringify({ type: 'git-create-pr-result', serverId: serverId, sessionId: msg.sessionId, success: false, error: err.message }));
            }
            break;
          }

          case 'revert-to-checkpoint': {
            if (!msg.sessionId || !msg.checkpointId) return;
            const rvSession = db.getSession(msg.sessionId);
            if (!rvSession?.workingDir) return;
            if (!sshManager.isConnected(serverId)) return;

            try {
              // Find the checkpoint
              const checkpoints = db.listCheckpoints(msg.sessionId);
              const checkpoint = checkpoints.find((cp) => cp.id === msg.checkpointId);
              if (!checkpoint) {
                ws.send(JSON.stringify({ type: 'status', serverId: serverId, sessionId: msg.sessionId, status: 'error', error: 'Checkpoint not found' }));
                return;
              }

              // Revert git state
              await sshManager.revertToCheckpoint(serverId, rvSession.workingDir, checkpoint.gitRef);

              // Delete checkpoints after this one
              db.deleteCheckpointsAfter(msg.sessionId, checkpoint.messageTimestamp);

              // Update chatStartedAt to show messages only up to this checkpoint
              db.updateChatStartedAt(msg.sessionId, checkpoint.messageTimestamp);

              // Reload history for client
              const messages = db.getMessagesAfter(msg.sessionId, checkpoint.messageTimestamp);
              broadcast(wss, { type: 'history', serverId: serverId, sessionId: msg.sessionId, messages, hasMore: true });
              broadcast(wss, { type: 'checkpoint-reverted', serverId: serverId, sessionId: msg.sessionId, checkpointId: msg.checkpointId });

              // Refresh git info
              const gitInfo = await sshManager.fetchGitInfo(serverId, rvSession.workingDir);
              if (gitInfo) broadcast(wss, { type: 'git-info', serverId: serverId, sessionId: msg.sessionId, ...gitInfo });

              // Refresh git status
              const raw = await sshManager.fetchGitStatus(serverId, rvSession.workingDir);
              broadcast(wss, { type: 'git-status', serverId: serverId, sessionId: msg.sessionId, raw });
            } catch (err: any) {
              ws.send(JSON.stringify({ type: 'status', serverId: serverId, sessionId: msg.sessionId, status: 'error', error: err.message }));
            }
            break;
          }

          case 'list-checkpoints': {
            if (!msg.sessionId) return;
            const checkpoints = db.listCheckpoints(msg.sessionId);
            ws.send(JSON.stringify({ type: 'checkpoints', serverId: serverId, sessionId: msg.sessionId, checkpoints }));
            break;
          }
        }
      } catch (err: any) {
        ws.send(JSON.stringify({ type: 'status', serverId: msg.serverId, sessionId: msg.sessionId, status: 'error', error: err.message }));
      }
    });
  });

  return sshManager;
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
