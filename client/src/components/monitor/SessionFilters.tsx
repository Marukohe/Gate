import { useEffect, useState, type FormEvent } from 'react';
import { ArchiveRestore } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import type { VisibilityOptions } from '../../../../server/src/types';

export function SessionFilters({ serverId, serverName, onClose, onChanged }: {
  serverId: string; serverName: string; onClose: () => void; onChanged: () => void;
}) {
  const base = `/servers/${encodeURIComponent(serverId)}`;
  const [settings, setSettings] = useState<VisibilityOptions | null>(null);
  const [directories, setDirectories] = useState<string[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api<VisibilityOptions>(`${base}/visibility`, { signal: controller.signal }).then((value) => {
      if (!controller.signal.aborted) { setSettings(value); setDirectories(value.excludedDirectories); }
    }).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [base]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api(`${base}/visibility`, { method: 'PUT', body: JSON.stringify({
        excludedDirectories: directories,
      }) });
      onChanged(); onClose();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function restore(id: string) {
    setBusy(true); setError('');
    try {
      await api(`${base}/sessions/${encodeURIComponent(id)}/archive`, { method: 'DELETE' });
      setSettings((previous) => previous ? { ...previous, archivedSessions: previous.archivedSessions.filter((s) => s.id !== id) } : previous);
      onChanged();
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
      <DialogHeader><DialogTitle>Session filters</DialogTitle><DialogDescription>{serverName} · Saved for everyone using this Gate.</DialogDescription></DialogHeader>
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      {!settings && !error && <p className="text-sm text-muted-foreground">Loading filters…</p>}
      {settings && <>
        <form onSubmit={save} className="space-y-4">
          <fieldset className="min-w-0 space-y-3">
            <legend className="text-sm font-medium">Choose directories to hide</legend>
            <Input aria-label="Search directories" placeholder="Find a directory…" value={query} onChange={(e) => setQuery(e.target.value)} />
            <p className="text-xs text-muted-foreground">Checked directories and their subdirectories are hidden.</p>
            <div className="max-h-64 overflow-y-auto rounded-lg border">
              {settings.directories.filter((path) => path.toLowerCase().includes(query.trim().toLowerCase())).map((path) => {
                const parent = directories.find((directory) => path !== directory && path.startsWith(directory === '/' ? '/' : `${directory}/`));
                return <label key={path} className="flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 hover:bg-accent">
                  <input type="checkbox" aria-label={`Hide ${path}`} checked={directories.includes(path) || !!parent} disabled={busy || !!parent}
                    className="size-4 shrink-0 accent-primary" onChange={(e) => setDirectories((previous) =>
                      e.target.checked ? [...previous, path] : previous.filter((directory) => directory !== path))} />
                  <span className="min-w-0 flex-1 break-all text-xs" title={parent ? `Included by ${parent}` : path}>{path}
                    {parent && <span className="ml-2 text-muted-foreground">(included by parent)</span>}
                  </span>
                </label>;
              })}
              {!settings.directories.some((path) => path.toLowerCase().includes(query.trim().toLowerCase())) &&
                <p className="px-3 py-4 text-xs text-muted-foreground">{query ? 'No matching directories.' : 'No session directories discovered yet.'}</p>}
            </div>
          </fieldset>
          <Button className="w-full" disabled={busy}>{busy ? 'Saving…' : 'Save filters'}</Button>
        </form>
        <details className="border-t pt-3">
          <summary className="cursor-pointer text-sm">Archived sessions ({settings.archivedSessions.length})</summary>
          <p className="mt-2 text-xs text-muted-foreground">Hidden only in Gate. Codex sessions keep running. Restore takes effect immediately; directory filters still apply.</p>
          <div className="mt-3 max-h-64 overflow-y-auto">
            {settings.archivedSessions.map((session) => <div key={session.id} className="flex items-center gap-3 py-2">
              <span className="min-w-0 flex-1 truncate text-sm" title={session.cwd}>{session.name}</span>
              <Button type="button" variant="ghost" size="icon-sm" disabled={busy} aria-label={`Restore ${session.name}`}
                title="Restore to Gate" onClick={() => void restore(session.id)}><ArchiveRestore /></Button>
            </div>)}
            {!settings.archivedSessions.length && <p className="text-xs text-muted-foreground">No archived sessions.</p>}
          </div>
        </details>
      </>}
    </DialogContent>
  </Dialog>;
}
