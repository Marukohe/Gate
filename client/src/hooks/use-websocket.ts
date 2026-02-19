import { useEffect, useCallback } from 'react';
import { useServerStore } from '../stores/server-store';
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
  setConnectionStatus: null as null | ReturnType<typeof useServerStore.getState>['setConnectionStatus'],
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
        // Individual message from stream-json parser — append
        storeRefs.addMessage?.(data.serverId, data.message);
        storeRefs.processPlanModeMessage?.(data.serverId, data.message);
        break;
      case 'status':
        storeRefs.setConnectionStatus?.(data.serverId, data.status, data.error);
        break;
      case 'history':
        storeRefs.setHistory?.(data.serverId, data.messages);
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
  const setConnectionStatus = useServerStore((s) => s.setConnectionStatus);
  const addMessage = useChatStore((s) => s.addMessage);
  const setHistory = useChatStore((s) => s.setHistory);
  const processPlanModeMessage = usePlanModeStore((s) => s.processMessage);

  // Keep refs current so WebSocket handlers always use latest store functions
  storeRefs.setConnectionStatus = setConnectionStatus;
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

  const connectToServer = useCallback((serverId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    storeRefs.setConnectionStatus?.(serverId, 'connecting');
    ws.send(JSON.stringify({ type: 'connect', serverId }));
  }, []);

  const sendInput = useCallback((serverId: string, text: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'input', serverId, text }));
  }, []);

  const disconnectFromServer = useCallback((serverId: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'disconnect', serverId }));
  }, []);

  return { connectToServer, sendInput, disconnectFromServer };
}
