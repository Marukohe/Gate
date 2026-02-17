import { useEffect, useRef, useCallback } from 'react';
import { useServerStore } from '../stores/server-store';
import { useChatStore } from '../stores/chat-store';

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
  addMessage: null as null | ReturnType<typeof useChatStore.getState>['addMessage'],
  setConnectionStatus: null as null | ReturnType<typeof useServerStore.getState>['setConnectionStatus'],
  setHistory: null as null | ReturnType<typeof useChatStore.getState>['setHistory'],
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
        storeRefs.addMessage?.(data.serverId, {
          id: crypto.randomUUID(),
          ...data.message,
        });
        break;
      case 'status':
        storeRefs.setConnectionStatus?.(data.serverId, data.status);
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

  // Keep refs current so WebSocket handlers always use latest store functions
  storeRefs.addMessage = addMessage;
  storeRefs.setConnectionStatus = setConnectionStatus;
  storeRefs.setHistory = setHistory;

  useEffect(() => {
    if (initialized) return;
    initialized = true;
    setupSocket();

    return () => {
      if (reconnectTimer) clearTimeout(reconnectTimer);
    };
  }, []);

  const connectToServer = useCallback((serverId: string, tmuxSession?: string) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    storeRefs.setConnectionStatus?.(serverId, 'connecting');
    ws.send(JSON.stringify({ type: 'connect', serverId, tmuxSession }));
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
