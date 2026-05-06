import { useEffect, useCallback } from 'react';
import { toast } from 'sonner';
import { useSessionStore } from '../stores/session-store';
import { useServerStore } from '../stores/server-store';
import { useChatStore } from '../stores/chat-store';
import { usePlanModeStore } from '../stores/plan-mode-store';
import { useUIStore } from '../stores/ui-store';
import { useGitStore, parseGitStatusPorcelain } from '../stores/git-store';
import { useWorkspaceStore, type WorkspacePrState, type WorkspaceStatus } from '../stores/workspace-store';
import { triggerTaskNotification } from '../lib/notification';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;
// Must exceed server's 30s ping interval to avoid false positives
const HEARTBEAT_TIMEOUT = 45_000;

// Queued connect request — sent when WS opens
let pendingConnect: { serverId: string; sessionId: string } | null = null;

// One-shot callback for cli-sessions / claude-sessions response
let cliSessionsCallback: ((sessions: string[]) => void) | null = null;

function resetBackoff() {
  reconnectDelay = 1000;
}

function nextBackoff(): number {
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  return delay;
}

// Access store functions directly via getState() — Zustand functions are stable
// references, so there's no need for storeRefs or hook-based subscriptions.
function stores() {
  return {
    session: useSessionStore.getState(),
    chat: useChatStore.getState(),
    planMode: usePlanModeStore.getState(),
    git: useGitStore.getState(),
    workspace: useWorkspaceStore.getState(),
  };
}

// Track the last session/server we sent a connect for so we don't spam the server.
// Reset on server switch to avoid skipping the first connect on a new server.
let lastConnectedSession: string | null = null;
let lastConnectedServer: string | null = null;

function getActiveTarget(): { serverId: string; sessionId: string } | null {
  const serverId = useServerStore.getState().activeServerId;
  if (!serverId) return null;
  const sessionId = useSessionStore.getState().activeSessionId[serverId];
  if (!sessionId) return null;
  return { serverId, sessionId };
}

function sendConnect(socket: WebSocket, serverId: string, sessionId: string) {
  // Only skip if already fully connected — allow re-sending if stuck in 'connecting'
  const status = useSessionStore.getState().connectionStatus[sessionId];
  if (sessionId === lastConnectedSession && status === 'connected') return;
  lastConnectedSession = sessionId;
  stores().session.setConnectionStatus(sessionId, 'connecting');
  socket.send(JSON.stringify({ type: 'connect', serverId, sessionId }));
  socket.send(JSON.stringify({ type: 'fetch-git-info', serverId, sessionId }));
}

function setupSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  ws = socket;

  // Reset heartbeat timer on any incoming data (messages, pong frames trigger onmessage too)
  function resetHeartbeat() {
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    heartbeatTimer = setTimeout(() => {
      // No data received within timeout — connection is likely dead
      socket.close();
    }, HEARTBEAT_TIMEOUT);
  }

  socket.onopen = () => {
    resetBackoff();
    resetHeartbeat();
    // Fetch workspaces on every open (initial connect + reconnects) so the
    // Command Center populates immediately rather than waiting for the next
    // 30s polling tick from App.tsx.
    socket.send(JSON.stringify({ type: 'list-workspaces' }));
    // Re-bind the current active session after reconnects, even if no new UI
    // interaction occurred while the socket was down.
    const target = pendingConnect ?? getActiveTarget();
    if (target) {
      pendingConnect = null;
      sendConnect(socket, target.serverId, target.sessionId);
    }
  };

  socket.onmessage = (event) => {
    resetHeartbeat();
    const data = JSON.parse(event.data);
    const { session, chat, planMode, git } = stores();
    switch (data.type) {
      case 'message':
        if (data.sessionId) {
          chat.addMessage(data.sessionId, data.message);
          planMode.processMessage(data.serverId, data.sessionId, data.message);
          // Derive agent status from incoming message type
          if (data.message.type === 'user') {
            session.setAgentStatus(data.sessionId, { state: 'thinking' });
          } else if (data.message.type === 'tool_call') {
            session.setAgentStatus(data.sessionId, { state: 'tool_call', toolName: data.message.toolName ?? 'unknown' });
          } else if (data.message.type === 'assistant') {
            session.setAgentStatus(data.sessionId, { state: 'idle' });
          } else if (data.message.type === 'system' && data.message.subType === 'result') {
            session.setAgentStatus(data.sessionId, { state: 'idle' });
          }
          // Notify on task completion in background sessions
          if (data.message.type === 'system' && data.message.subType === 'result') {
            const activeServerId = useServerStore.getState().activeServerId;
            const activeSessionId = activeServerId ? useSessionStore.getState().activeSessionId[activeServerId] : null;
            const isBackground = data.sessionId !== activeSessionId || document.hidden;
            if (isBackground) {
              const server = useServerStore.getState().servers.find((s) => s.id === data.serverId);
              const sessions = useSessionStore.getState().sessions[data.serverId] ?? [];
              const sess = sessions.find((s) => s.id === data.sessionId);
              triggerTaskNotification(server?.name ?? data.serverId, sess?.name ?? data.sessionId);
            }
          }
        }
        break;
      case 'status':
        if (data.sessionId) {
          session.setConnectionStatus(data.sessionId, data.status, data.error);
          if (data.status === 'disconnected') {
            session.setAgentStatus(data.sessionId, { state: 'disconnected' });
          } else if (data.status === 'connecting') {
            session.setAgentStatus(data.sessionId, { state: 'connecting' });
          } else if (data.status === 'connected') {
            session.setAgentStatus(data.sessionId, { state: 'idle' });
          }
        }
        break;
      case 'history':
        if (data.sessionId) {
          chat.setHistory(data.sessionId, data.messages, data.hasMore ?? false);
        }
        break;
      case 'history-prepend':
        if (data.sessionId) {
          chat.prependMessages(data.sessionId, data.messages, data.hasMore ?? false);
        }
        break;
      case 'sessions':
        session.setSessions(data.serverId, data.sessions);
        break;
      case 'session-created':
        // Don't addSession — the 'sessions' broadcast already updated the full list.
        // Just auto-select the newly created session.
        session.setActiveSession(data.serverId, data.session.id);
        break;
      case 'git-info':
        if (data.sessionId) {
          session.setGitInfo(data.sessionId, { branch: data.branch, worktree: data.worktree });
        }
        break;
      case 'branches':
        if (data.sessionId) {
          session.setBranches(data.sessionId, { current: data.current, local: data.local, remote: data.remote });
        }
        break;
      case 'sync-result':
        if (data.sessionId) {
          const setSyncStatus = useUIStore.getState().setSyncStatus;
          if (data.success) {
            setSyncStatus(data.sessionId, { state: 'done', added: data.added ?? 0 });
          } else {
            setSyncStatus(data.sessionId, { state: 'error', error: data.error ?? 'Sync failed' });
          }
        }
        break;
      case 'cli-sessions':
      case 'claude-sessions':
        if (cliSessionsCallback) {
          cliSessionsCallback(data.sessions ?? []);
          cliSessionsCallback = null;
        }
        break;
      case 'git-status':
        if (data.sessionId) {
          git.setStatus(data.sessionId, parseGitStatusPorcelain(data.raw));
        }
        break;
      case 'git-diff':
        if (data.sessionId) {
          git.setDiff(data.sessionId, data.diff);
        }
        break;
      case 'pr-info':
        if (data.sessionId && data.data) {
          try {
            const info = JSON.parse(data.data);
            git.setPRInfo(data.sessionId, info.number ? info : null);
          } catch { git.setPRInfo(data.sessionId, null); }
        }
        break;
      case 'checkpoints':
        if (data.sessionId) {
          session.setCheckpoints(data.sessionId, data.checkpoints ?? []);
        }
        break;
      case 'workspace-list':
        useWorkspaceStore.getState().setWorkspaces(data.workspaces ?? []);
        break;
      case 'workspace-update':
        if (data.workspace) useWorkspaceStore.getState().upsertWorkspace(data.workspace);
        break;
      case 'workspace-branches':
        if (data.workspaceId) {
          useWorkspaceStore.getState().setBranches(data.workspaceId, {
            current: data.current ?? '',
            local: data.local ?? [],
            remote: data.remote ?? [],
          });
        }
        break;
      case 'workspace-inspector':
        if (data.workspaceId) {
          useWorkspaceStore.getState().setInspector({
            workspaceId: data.workspaceId,
            serverId: data.serverId,
            primarySession: data.primarySession ?? null,
            visibleSessions: data.visibleSessions ?? [],
            actionSessions: data.actionSessions ?? [],
            changes: data.changes ?? null,
            pr: data.pr ?? { url: null, state: 'none' },
            scripts: data.scripts ?? {},
            actionStatus: data.actionStatus ?? null,
          });
        }
        break;
      case 'workspace-task-started':
        if (data.workspace) useWorkspaceStore.getState().upsertWorkspace(data.workspace);
        if (data.session) {
          const sessionStore = useSessionStore.getState();
          const list = sessionStore.sessions[data.session.serverId] ?? [];
          if (!list.find((s) => s.id === data.session.id)) {
            sessionStore.addSession(data.session.serverId, data.session);
          }
          sessionStore.setActiveSession(data.session.serverId, data.session.id);
          window.dispatchEvent(new CustomEvent('gate:workspace-task-started', {
            detail: {
              serverId: data.session.serverId,
              sessionId: data.session.id,
              workspaceId: data.session.workspaceId,
            },
          }));
        }
        break;
      case 'workspace-deleted': {
        useWorkspaceStore.getState().removeWorkspace(data.workspaceId);
        // Drop any sessions returned in removedSessionIds from the session-store
        const removedIds: string[] = data.removedSessionIds ?? [];
        if (removedIds.length > 0) {
          const sessionStore = useSessionStore.getState();
          const all = sessionStore.sessions;
          for (const [serverId, list] of Object.entries(all)) {
            for (const s of list) {
              if (removedIds.includes(s.id)) sessionStore.removeSession(serverId, s.id);
            }
          }
        }
        break;
      }
      case 'session-update':
        // session-update carries the full Session row after probe-and-link
        if (data.session) {
          useSessionStore.getState().updateSession(data.session.serverId, data.session);
        }
        break;
      case 'workspace-error':
        toast.error(data.error ?? 'Workspace error');
        break;
    }
  };

  socket.onerror = () => {
    // onclose will handle reconnect
  };

  socket.onclose = () => {
    ws = null;
    if (heartbeatTimer) clearTimeout(heartbeatTimer);
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const activeTarget = getActiveTarget();
    if (activeTarget) {
      pendingConnect = activeTarget;
      stores().session.setConnectionStatus(activeTarget.sessionId, 'connecting');
      lastConnectedSession = null;
      lastConnectedServer = activeTarget.serverId;
    }
    const delay = nextBackoff();
    reconnectTimer = setTimeout(setupSocket, delay);
  };
}

let initialized = false;

export function useWebSocket() {
  useEffect(() => {
    if (initialized) return;
    initialized = true;
    setupSocket();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  const connectToSession = useCallback((serverId: string, sessionId: string) => {
    // Clear stale guard when switching servers
    if (serverId !== lastConnectedServer) {
      lastConnectedSession = null;
      lastConnectedServer = serverId;
    }
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      // Queue — will be sent when WS opens
      pendingConnect = { serverId, sessionId };
      return;
    }
    sendConnect(ws, serverId, sessionId);
  }, []);

  const sendInput = useCallback((serverId: string, sessionId: string, text: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'input', serverId, sessionId, text }));
    stores().session.setAgentStatus(sessionId, { state: 'thinking' });
  }, []);

  const interruptSession = useCallback((serverId: string, sessionId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'interrupt', serverId, sessionId }));
    stores().session.setAgentStatus(sessionId, { state: 'idle' });
  }, []);

  const listWorkspaces = useCallback(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'list-workspaces' }));
  }, []);

  const createWorkspace = useCallback((serverId: string, repoPath: string, name?: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'create-workspace', serverId, repoPath, workspaceName: name }));
  }, []);

  const deleteWorkspace = useCallback((workspaceId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'delete-workspace', workspaceId }));
  }, []);

  const updateWorkspace = useCallback((workspaceId: string, updates: {
    name?: string;
    autoOpenLastSession?: boolean;
    status?: WorkspaceStatus;
    goal?: string | null;
    prUrl?: string | null;
    prState?: WorkspacePrState;
  }) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({
      type: 'update-workspace',
      workspaceId,
      workspaceName: updates.name,
      autoOpenLastSession: updates.autoOpenLastSession,
      workspaceStatus: updates.status,
      goal: updates.goal,
      prUrl: updates.prUrl,
      prState: updates.prState,
    }));
  }, []);

  const setWorkspaceStatus = useCallback((workspaceId: string, status: WorkspaceStatus) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'set-workspace-status', workspaceId, workspaceStatus: status }));
  }, []);

  const pinWorkspace = useCallback((workspaceId: string, pinned: boolean) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'pin-workspace', workspaceId, pinned }));
  }, []);

  const archiveWorkspace = useCallback((workspaceId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'archive-workspace', workspaceId }));
  }, []);

  const restoreWorkspace = useCallback((workspaceId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'restore-workspace', workspaceId }));
  }, []);

  const listWorkspaceBranches = useCallback((workspaceId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'list-workspace-branches', workspaceId }));
  }, []);

  const fetchWorkspaceInspector = useCallback((workspaceId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'fetch-workspace-inspector', workspaceId }));
  }, []);

  const startWorkspaceTask = useCallback((workspaceId: string, goal: string, options?: {
    provider?: string;
    branchMode?: string;
    branchName?: string;
    worktreeMode?: string;
    worktreePath?: string;
  }) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'start-workspace-task', workspaceId, goal, ...options }));
  }, []);

  const disconnectSession = useCallback((serverId: string, sessionId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'disconnect', serverId, sessionId }));
  }, []);

  const createSession = useCallback((serverId: string, name: string, workingDir?: string | null, claudeSessionId?: string | null, provider?: string, workspaceId?: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'create-session', serverId, sessionName: name, workingDir: workingDir || undefined, claudeSessionId: claudeSessionId || undefined, provider: provider || undefined, workspaceId }));
  }, []);

  const fetchGitInfo = useCallback((serverId: string, sessionId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'fetch-git-info', serverId, sessionId }));
  }, []);

  const listBranches = useCallback((serverId: string, sessionId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'list-branches', serverId, sessionId }));
  }, []);

  const switchBranch = useCallback((serverId: string, sessionId: string, branch: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'switch-branch', serverId, sessionId, branch }));
  }, []);

  const deleteSession = useCallback((serverId: string, sessionId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'delete-session', serverId, sessionId }));
    stores().session.removeSession(serverId, sessionId);
  }, []);

  const execCommand = useCallback((serverId: string, sessionId: string, command: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'exec', serverId, sessionId, command }));
  }, []);

  const syncTranscript = useCallback((serverId: string, sessionId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    useUIStore.getState().setSyncStatus(sessionId, { state: 'syncing' });
    ws.send(JSON.stringify({ type: 'sync-transcript', serverId, sessionId }));
  }, []);

  const switchProvider = useCallback((serverId: string, sessionId: string, provider: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'switch-provider', serverId, sessionId, provider }));
  }, []);

  const resetConversation = useCallback((serverId: string, sessionId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'reset-conversation', serverId, sessionId }));
  }, []);

  const fetchGitStatus = useCallback((serverId: string, sessionId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'fetch-git-status', serverId, sessionId }));
  }, []);

  const fetchGitDiff = useCallback((serverId: string, sessionId: string, diffArgs?: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'fetch-git-diff', serverId, sessionId, diffArgs }));
  }, []);

  const fetchPRInfo = useCallback((serverId: string, sessionId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'fetch-pr-info', serverId, sessionId }));
  }, []);

  const gitCommit = useCallback((serverId: string, sessionId: string, message: string, files?: string[]) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'git-commit', serverId, sessionId, message, files }));
  }, []);

  const gitCreatePR = useCallback((serverId: string, sessionId: string, title: string, body?: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'git-create-pr', serverId, sessionId, title, body }));
  }, []);

  const revertToCheckpoint = useCallback((serverId: string, sessionId: string, checkpointId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'revert-to-checkpoint', serverId, sessionId, checkpointId }));
  }, []);

  const listCheckpoints = useCallback((serverId: string, sessionId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'list-checkpoints', serverId, sessionId }));
  }, []);

  const resumeCliSession = useCallback((serverId: string, sessionId: string, cliSessionId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'resume-cli-session', serverId, sessionId, claudeSessionId: cliSessionId }));
  }, []);

  const listCliSessions = useCallback((serverId: string, workingDir: string, provider: string = 'claude'): Promise<string[]> => {
    return new Promise((resolve) => {
      if (!ws || ws.readyState !== WebSocket.OPEN) { resolve([]); return; }
      cliSessionsCallback = resolve;
      ws.send(JSON.stringify({ type: 'list-cli-sessions', serverId, workingDir, provider }));
      // Timeout fallback in case server never responds
      setTimeout(() => { if (cliSessionsCallback === resolve) { cliSessionsCallback = null; resolve([]); } }, 10000);
    });
  }, []);

  // Backward-compatible alias
  const listClaudeSessions = useCallback((serverId: string, workingDir: string): Promise<string[]> => {
    return listCliSessions(serverId, workingDir, 'claude');
  }, [listCliSessions]);

  const loadMoreMessages = useCallback((serverId: string, sessionId: string, beforeTimestamp: number) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'load-more', serverId, sessionId, beforeTimestamp }));
  }, []);

  return { connectToSession, sendInput, interruptSession, disconnectSession, createSession, deleteSession, fetchGitInfo, listBranches, switchBranch, execCommand, syncTranscript, listCliSessions, listClaudeSessions, switchProvider, resetConversation, resumeCliSession, loadMoreMessages, fetchGitStatus, fetchGitDiff, fetchPRInfo, gitCommit, gitCreatePR, revertToCheckpoint, listCheckpoints, listWorkspaces, createWorkspace, deleteWorkspace, updateWorkspace, setWorkspaceStatus, pinWorkspace, archiveWorkspace, restoreWorkspace, listWorkspaceBranches, fetchWorkspaceInspector, startWorkspaceTask };
}
