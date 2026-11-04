import { useEffect, useState } from 'react';
import { ArrowUpRight, MessageSquare, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useServerStore } from '@/stores/server-store';
import { useSessionStore, type Session } from '@/stores/session-store';
import { selectClass } from './ProjectForm';

export function SessionsList({ onOpen, onCreate }: {
  onOpen: (serverId: string, sessionId: string) => void; onCreate: (serverId: string) => void;
}) {
  const servers = useServerStore((state) => state.servers);
  const sessions = useSessionStore((state) => state.sessions);
  const setSessions = useSessionStore((state) => state.setSessions);
  const [query, setQuery] = useState('');
  const [machine, setMachine] = useState('');
  const [error, setError] = useState('');
  const serverIds = servers.map((server) => server.id).join(',');
  const [loadedFor, setLoadedFor] = useState<string | null>(null);
  const loading = loadedFor !== serverIds;
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void Promise.all(servers.map(async (server) => {
      const response = await fetch(`/api/servers/${server.id}/sessions`, { signal: controller.signal });
      if (!response.ok) throw new Error(`Could not load sessions on ${server.name}.`);
      const items: Session[] = await response.json();
      if (!controller.signal.aborted) setSessions(server.id, items);
    })).then(() => { if (!controller.signal.aborted) setError(''); }).catch((err) => { if (!controller.signal.aborted) setError(err.message); })
      .finally(() => { if (!controller.signal.aborted) setLoadedFor(serverIds); });
    return () => controller.abort();
  }, [servers, serverIds, setSessions, retry]);
  const items = servers.flatMap((server) => (sessions[server.id] ?? []).map((session) => ({ session, server })))
    .filter(({ session, server }) => !session.isHidden && (!machine || machine === server.id) &&
      `${session.name} ${session.workingDir ?? ''} ${server.name}`.toLowerCase().includes(query.toLowerCase()))
    .sort((a, b) => b.session.lastActiveAt - a.session.lastActiveAt);
  return <>
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div><h1 className="page-title">Sessions</h1><p className="page-description">Your saved conversations, all in one place.</p></div>
      <Button disabled={!servers.length} onClick={() => onCreate(machine || servers[0].id)}><Plus />New session</Button>
    </div>
    <div className="flex flex-wrap gap-2">
      <Input className="w-full sm:w-72" aria-label="Search sessions" placeholder="Search conversations…" value={query}
        onChange={(event) => setQuery(event.target.value)} />
      <select className={selectClass} aria-label="Session machine" value={machine} onChange={(event) => setMachine(event.target.value)}>
        <option value="">All machines</option>{servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}
      </select>
    </div>
    {error && <div role="alert" className="flex items-center gap-3 text-sm text-destructive">{error}
      <Button variant="outline" size="sm" onClick={() => { setLoadedFor(null); setError(''); setRetry(retry + 1); }}>Retry</Button></div>}
    <div className="work-list">{items.map(({ session, server }) => <button key={session.id}
      className="work-row" onClick={() => onOpen(server.id, session.id)}>
      <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{session.name}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{server.name} · {session.provider} · {session.workingDir}</p></div>
      <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
    </button>)}</div>
    {!items.length && <p className="py-10 text-center text-sm text-muted-foreground">
      {loading ? 'Loading conversations…' : 'No conversations to show.'}</p>}
  </>;
}
