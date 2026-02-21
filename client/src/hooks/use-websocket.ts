import { useEffect, useCallback } from 'react';
import { useSessionStore } from '../stores/session-store';
import { useChatStore } from '../stores/chat-store';
import { usePlanModeStore } from '../stores/plan-mode-store';

let ws: WebSocket | null = null;
let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;

function resetBackoff() {
  reconnectDelay = 1000;
}

function nextBackoff(): number {
  const delay = reconnectDelay;
  reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  return delay;
}

// Refs for store callbacks, updated each render so closures are never stale
const storeRefs = {
  setConnectionStatus: null as null | ReturnType<typeof useSessionStore.getState>['setConnectionStatus'],
  setSessions: null as null | ReturnType<typeof useSessionStore.getState>['setSessions'],
  setActiveSession: null as null | ReturnType<typeof useSessionStore.getState>['setActiveSession'],
  removeSession: null as null | ReturnType<typeof useSessionStore.getState>['removeSession'],
  setGitInfo: null as null | ReturnType<typeof useSessionStore.getState>['setGitInfo'],
  setBranches: null as null | ReturnType<typeof useSessionStore.getState>['setBranches'],
  addMessage: null as null | ReturnType<typeof useChatStore.getState>['addMessage'],
  setHistory: null as null | ReturnType<typeof useChatStore.getState>['setHistory'],
  processPlanModeMessage: null as null | ReturnType<typeof usePlanModeStore.getState>['processMessage'],
};

function setupSocket() {
  if (ws && (ws.readyState === WebSocket.OPEN || ws.readyState === WebSocket.CONNECTING)) {
    return;
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(`${protocol}//${window.location.host}/ws`);
  ws = socket;

  socket.onopen = () => {
    resetBackoff();
  };

  socket.onmessage = (event) => {
    const data = JSON.parse(event.data);
    switch (data.type) {
      case 'message':
        if (data.sessionId) {
          storeRefs.addMessage?.(data.sessionId, data.message);
          storeRefs.processPlanModeMessage?.(data.sessionId, data.message);
        }
        break;
      case 'status':
        if (data.sessionId) {
          storeRefs.setConnectionStatus?.(data.sessionId, data.status, data.error);
        }
        break;
      case 'history':
        if (data.sessionId) {
          storeRefs.setHistory?.(data.sessionId, data.messages);
        }
        break;
      case 'sessions':
        storeRefs.setSessions?.(data.serverId, data.sessions);
        break;
      case 'session-created':
        // Don't addSession — the 'sessions' broadcast already updated the full list.
        // Just auto-select the newly created session.
        storeRefs.setActiveSession?.(data.serverId, data.session.id);
        break;
      case 'git-info':
        if (data.sessionId) {
          storeRefs.setGitInfo?.(data.sessionId, { branch: data.branch, worktree: data.worktree });
        }
        break;
      case 'branches':
        if (data.sessionId) {
          storeRefs.setBranches?.(data.sessionId, { current: data.current, local: data.local, remote: data.remote });
        }
        break;
    }
  };

  socket.onerror = () => {
    // onclose will handle reconnect
  };

  socket.onclose = () => {
    ws = null;
    if (reconnectTimer) clearTimeout(reconnectTimer);
    const delay = nextBackoff();
    reconnectTimer = setTimeout(setupSocket, delay);
  };
}

let initialized = false;

export function useWebSocket() {
  const setConnectionStatus = useSessionStore((s) => s.setConnectionStatus);
  const setSessions = useSessionStore((s) => s.setSessions);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const setGitInfo = useSessionStore((s) => s.setGitInfo);
  const setBranches = useSessionStore((s) => s.setBranches);
  const addMessage = useChatStore((s) => s.addMessage);
  const setHistory = useChatStore((s) => s.setHistory);
  const processPlanModeMessage = usePlanModeStore((s) => s.processMessage);

  // Keep refs current so WebSocket handlers always use latest store functions
  storeRefs.setConnectionStatus = setConnectionStatus;
  storeRefs.setSessions = setSessions;
  storeRefs.setActiveSession = setActiveSession;
  storeRefs.removeSession = removeSession;
  storeRefs.setGitInfo = setGitInfo;
  storeRefs.setBranches = setBranches;
  storeRefs.addMessage = addMessage;
  storeRefs.setHistory = setHistory;
  storeRefs.processPlanModeMessage = processPlanModeMessage;

  useEffect(() => {
    if (initialized) return;
    initialized = true;
    setupSocket();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  const connectToSession = useCallback((serverId: string, sessionId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    storeRefs.setConnectionStatus?.(sessionId, 'connecting');
    ws.send(JSON.stringify({ type: 'connect', serverId, sessionId }));
  }, []);

  const sendInput = useCallback((serverId: string, sessionId: string, text: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'input', serverId, sessionId, text }));
  }, []);

  const disconnectSession = useCallback((serverId: string, sessionId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'disconnect', serverId, sessionId }));
  }, []);

  const createSession = useCallback((serverId: string, name: string, workingDir?: string | null) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'create-session', serverId, sessionName: name, workingDir: workingDir || undefined }));
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
    storeRefs.removeSession?.(serverId, sessionId);
  }, []);

  const execCommand = useCallback((serverId: string, sessionId: string, command: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'exec', serverId, sessionId, command }));
  }, []);

  return { connectToSession, sendInput, disconnectSession, createSession, deleteSession, fetchGitInfo, listBranches, switchBranch, execCommand };
}
