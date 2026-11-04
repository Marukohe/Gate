import { useEffect, useRef } from 'react';
import type { ServerEvent } from '../../../server/src/types';

export function useEvents(handler: (event: ServerEvent) => void) {
  const latest = useRef(handler);
  useEffect(() => { latest.current = handler; });
  useEffect(() => {
    let closed = false;
    let socket: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    function connect() {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
      socket.onopen = () => latest.current({ serverId: '', type: 'changed' });
      socket.onmessage = (event) => { try { latest.current(JSON.parse(event.data)); } catch { /* Ignore malformed events. */ } };
      socket.onclose = () => {
        if (closed) return;
        latest.current({ serverId: '', type: 'disconnected' });
        timer = setTimeout(connect, 1500);
      };
      socket.onerror = () => socket.close();
    }
    connect();
    return () => { closed = true; clearTimeout(timer); socket.close(); };
  }, []);
}
