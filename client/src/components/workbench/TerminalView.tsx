import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { Button } from '@/components/ui/button';

export default function TerminalView({ runId, onDetach }: { runId: string; onDetach: () => void }) {
  const container = useRef<HTMLDivElement>(null);
  const control = useRef<(type: 'claim' | 'input', text?: string) => void>(() => {});
  const [status, setStatus] = useState('Connecting');
  const [writable, setWritable] = useState(false);
  const [available, setAvailable] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    const terminal = new Terminal({ cursorBlink: true, convertEol: false, scrollback: 5000, disableStdin: true,
      fontSize: 13, theme: { background: '#111827', foreground: '#e5e7eb' } });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(container.current!);
    let socket: WebSocket;
    let timer: ReturnType<typeof setTimeout>;
    let disposed = false;
    let ready = false;
    let writer = false;
    let ended = false;
    let confirmedExit = false;
    let cursor = 0;
    let lastSize = '';
    const pending = new Set<string>();
    const encode = (data: Uint8Array) => btoa(Array.from(data, (byte) => String.fromCharCode(byte)).join(''));
    const send = (message: object, track = false) => {
      if (!ready || !writer || ended || socket?.readyState !== WebSocket.OPEN) return;
      const id = crypto.randomUUID();
      if (track) pending.add(id);
      socket.send(JSON.stringify({ id, message }));
    };
    const input = (text: string) => {
      const bytes = new TextEncoder().encode(text);
      for (let index = 0; index < bytes.length; index += 12000) send({ type: 'input', data: encode(bytes.slice(index, index + 12000)) }, true);
    };
    const size = () => {
      if (!ready || !writer || ended) return;
      fit.fit();
      const cols = Math.min(500, Math.max(2, terminal.cols));
      const rows = Math.min(200, Math.max(2, terminal.rows));
      const key = `${cols}:${rows}`;
      if (key !== lastSize) { lastSize = key; send({ type: 'resize', cols, rows }); }
    };
    control.current = (type, text) => {
      if (type === 'claim' && socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type }));
      else if (type === 'input') { input(text!); terminal.focus(); }
    };
    const data = terminal.onData(input);
    const binary = terminal.onBinary((value) => send({ type: 'input',
      data: encode(Uint8Array.from(value, (char) => char.charCodeAt(0))) }, true));
    const observer = new ResizeObserver(size);
    observer.observe(container.current!);
    function connect() {
      if (disposed) return;
      ready = false; writer = false; lastSize = ''; setWritable(false); setAvailable(false);
      terminal.options.disableStdin = true;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws/terminal?runId=${encodeURIComponent(runId)}&after=${cursor}`);
      socket.onmessage = (event) => {
        const message = JSON.parse(event.data);
        if (message.type === 'events') {
          for (const item of message.events) {
            if (item.seq <= cursor) continue;
            if (item.seq !== cursor + 1) { setError('Terminal replay has an event gap. Detach and attach again.'); socket.close(); return; }
            if (item.type === 'protocol') {
              if (item.data.type === 'terminal-output') terminal.write(Uint8Array.from(atob(item.data.data), (char) => char.charCodeAt(0)));
              if (item.data.type === 'terminal-resize') terminal.resize(item.data.cols, item.data.rows);
              if (item.data.type === 'terminal-exit') confirmedExit = true;
            }
            cursor = item.seq;
          }
        } else if (message.type === 'control') {
          writer = message.writable; setAvailable(message.available);
          setWritable(writer && ready && !ended);
          terminal.options.disableStdin = !writer || !ready || ended;
          size();
        } else if (message.type === 'ready') {
          ready = true; ended = ['exited', 'lost'].includes(message.state);
          setStatus(ended ? message.state === 'lost' || !confirmedExit ? 'Ownership unconfirmed' : 'Terminal exited' : 'Connected');
          setWritable(writer && !ended); terminal.options.disableStdin = !writer || ended;
          size(); if (writer && !ended) terminal.focus();
        } else if (message.type === 'ack') pending.delete(message.id);
        else if (message.type === 'input-error' || message.type === 'connection-error') {
          pending.delete(message.id); setError(message.message);
        }
      };
      socket.onclose = () => {
        if (disposed) return;
        ready = false; setWritable(false); terminal.options.disableStdin = true;
        if (pending.size) setError('Connection lost; some input may have been delivered. It will not be resent.');
        pending.clear();
        if (!ended) { setStatus('Reconnecting'); timer = setTimeout(connect, 1500); }
      };
    }
    connect();
    return () => {
      disposed = true; clearTimeout(timer); socket?.close(); observer.disconnect(); data.dispose(); binary.dispose(); terminal.dispose();
    };
  }, [runId]);
  return <div className="mt-3 space-y-3">
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span>{status} · {writable ? 'You control input' : 'Read-only attachment'}</span>
      {available && <Button size="sm" variant="outline" onClick={() => control.current('claim')}>Control terminal</Button>}
      <Button size="sm" variant="outline" onClick={onDetach}>Detach terminal</Button>
    </div>
    {error && <p role="status" className="break-words text-xs text-amber-600">{error}</p>}
    <div ref={container} role="region" aria-label="Interactive terminal" className="h-80 overflow-x-auto rounded bg-gray-900 p-2" />
    <div className="flex flex-wrap gap-2">{[['Ctrl-C', '\x03'], ['Esc', '\x1b'], ['Tab', '\t'], ['↑', '\x1b[A'], ['↓', '\x1b[B']].map(([label, text]) =>
      <Button key={label} size="sm" variant="outline" disabled={!writable} onClick={() => control.current('input', text)}>{label}</Button>)}</div>
    <p className="text-xs text-muted-foreground">Detaching or closing this page leaves the terminal running. One browser controls input at a time.
      Input is not resent after connection loss. Use Stop run to terminate the terminal.</p>
  </div>;
}
