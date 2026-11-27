import { useEffect, useRef, useState } from 'react';
import { RotateCw, Square, X } from 'lucide-react';
import { FitAddon, Ghostty, Terminal } from 'ghostty-web';
import { Button } from '@/components/ui/button';

export type TerminalTarget = { key: string; serverId: string; threadId: string; cwd: string };

let emulator: Promise<Ghostty> | undefined;
function loadEmulator() {
  return emulator ??= Ghostty.load().catch((error: unknown) => {
    emulator = undefined;
    throw error;
  });
}

export default function TerminalPane({ target, open, onHide, onEnd }: {
  target: TerminalTarget; open: boolean; onHide: () => void; onEnd: () => void;
}) {
  const mount = useRef<HTMLDivElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<'connecting' | 'ready' | 'closed'>('connecting');
  const [message, setMessage] = useState('');
  const [cwd, setCwd] = useState(target.cwd);
  useEffect(() => {
    const element = mount.current!;
    let stopped = false;
    let ready = false;
    let terminal: Terminal | undefined;
    let socket: WebSocket | undefined;
    let observer: ResizeObserver | undefined;
    const close = (message: string) => {
      if (stopped) return;
      setState('closed');
      setMessage((previous) => previous || message);
    };
    void loadEmulator().then((ghostty) => {
      if (stopped) return;
      terminal = new Terminal({
        ghostty, fontSize: 13, fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace',
        cursorBlink: false, scrollback: 3000,
        theme: { background: '#16181d', foreground: '#e6e8ee', cursor: '#b6cfff', selectionBackground: '#435477' },
      });
      const fit = new FitAddon();
      terminal.loadAddon(fit);
      terminal.open(element);
      const resize = () => {
        // A folded pane reports zero dimensions. Keep the last PTY size until it is visible again.
        if (element.clientWidth && element.clientHeight) fit.fit();
      };
      resize();
      observer = new ResizeObserver(resize);
      observer.observe(element);
      const url = new URL('/ws/terminal', location.href);
      url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
      url.search = new URLSearchParams({ server: target.serverId, session: target.threadId,
        cols: String(terminal.cols), rows: String(terminal.rows) }).toString();
      socket = new WebSocket(url);
      socket.binaryType = 'arraybuffer';
      const sendSize = ({ cols, rows }: { cols: number; rows: number }) => {
        if (ready && socket?.readyState === WebSocket.OPEN) {
          socket.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      };
      terminal.onResize(sendSize);
      const encode = new TextEncoder();
      terminal.onData((input) => {
        if (!ready || socket?.readyState !== WebSocket.OPEN) return;
        const bytes = encode.encode(input);
        if (bytes.byteLength + socket.bufferedAmount > 1024 * 1024) {
          close('Terminal input exceeded the connection buffer.');
          socket.close();
          return;
        }
        for (let start = 0; start < bytes.length; start += 32768) socket.send(bytes.subarray(start, start + 32768));
      });
      socket.onmessage = ({ data }) => {
        if (stopped) return;
        if (data instanceof ArrayBuffer) {
          terminal?.write(new Uint8Array(data));
          return;
        }
        try {
          const update = JSON.parse(data);
          if (update.type === 'ready' && typeof update.cwd === 'string' && terminal) {
            ready = true;
            setCwd(update.cwd);
            setState('ready');
            sendSize(terminal);
          } else if (update.type === 'error' && typeof update.message === 'string') {
            close(update.message);
          }
        } catch { /* Terminal data always arrives in binary frames. */ }
      };
      socket.onerror = () => close('Could not connect to the terminal.');
      socket.onclose = ({ code, reason }) => {
        ready = false;
        close(code === 1000 ? 'Shell exited.' : reason || 'Terminal disconnected.');
      };
    }).catch((error: Error) => close(error.message));
    return () => {
      stopped = true;
      observer?.disconnect();
      socket?.close();
      terminal?.dispose();
    };
  }, [target, attempt]);

  return <section aria-label="Session terminal" role="complementary" className="terminal-sidebar" hidden={!open}>
    <div className="file-sidebar-header">
      <span className="shrink-0 text-sm font-medium">Terminal</span>
      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground" title={cwd} dir="rtl"><bdi dir="ltr">{cwd}</bdi></span>
      {state === 'closed'
        ? <Button size="icon-sm" variant="ghost" aria-label="New terminal" title="New terminal"
          onClick={() => { setState('connecting'); setMessage(''); setAttempt(attempt + 1); }}><RotateCw /></Button>
        : <Button size="icon-sm" variant="ghost" aria-label="End terminal" title="End terminal" onClick={onEnd}><Square /></Button>}
      <Button size="icon-sm" variant="ghost" aria-label="Close terminal" title="Hide terminal" onClick={onHide}><X /></Button>
    </div>
    {state !== 'ready' && <p role="status" className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">
      {state === 'connecting' ? 'Connecting…' : message}
    </p>}
    <div key={attempt} className="terminal-screen" ref={mount} aria-label="Terminal screen" />
  </section>;
}
