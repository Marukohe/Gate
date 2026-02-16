import { useEffect, useRef, useCallback } from 'react';
import { useServerStore } from '../stores/server-store';
import { useChatStore } from '../stores/chat-store';

let ws: WebSocket | null = null;

function getOrCreateWs(): WebSocket {
  if (ws && ws.readyState === WebSocket.OPEN) return ws;

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  ws = new WebSocket(`${protocol}//${window.location.host}/ws`);
  return ws;
}

export function useWebSocket() {
  const setConnectionStatus = useServerStore((s) => s.setConnectionStatus);
  const addMessage = useChatStore((s) => s.addMessage);
  const setHistory = useChatStore((s) => s.setHistory);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const socket = getOrCreateWs();
    wsRef.current = socket;

    socket.onmessage = (event) => {
      const data = JSON.parse(event.data);

      switch (data.type) {
        case 'message':
          addMessage(data.serverId, {
            id: crypto.randomUUID(),
            ...data.message,
          });
          break;
        case 'status':
          setConnectionStatus(data.serverId, data.status);
          break;
        case 'history':
          setHistory(data.serverId, data.messages);
          break;
      }
    };

    socket.onclose = () => {
      ws = null;
      // Reconnect after 3 seconds
      setTimeout(() => {
        if (wsRef.current === socket) {
          wsRef.current = getOrCreateWs();
        }
      }, 3000);
    };

    return () => {
      // Don't close on unmount — keep the connection alive
    };
  }, [addMessage, setConnectionStatus, setHistory]);

  const connectToServer = useCallback((serverId: string, tmuxSession?: string) => {
    const socket = getOrCreateWs();
    setConnectionStatus(serverId, 'connecting');
    socket.send(JSON.stringify({ type: 'connect', serverId, tmuxSession }));
  }, [setConnectionStatus]);

  const sendInput = useCallback((serverId: string, text: string) => {
    const socket = getOrCreateWs();
    socket.send(JSON.stringify({ type: 'input', serverId, text }));
  }, []);

  const disconnectFromServer = useCallback((serverId: string) => {
    const socket = getOrCreateWs();
    socket.send(JSON.stringify({ type: 'disconnect', serverId }));
  }, []);

  return { connectToServer, sendInput, disconnectFromServer };
}
