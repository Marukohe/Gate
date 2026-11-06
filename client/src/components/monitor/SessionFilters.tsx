import { useEffect, useState, type FormEvent } from 'react';
import { ArchiveRestore } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { api } from '@/lib/api';
import type { VisibilitySettings } from '../../../../server/src/types';

export function SessionFilters({ serverId, serverName, onClose, onChanged }: {
  serverId: string; serverName: string; onClose: () => void; onChanged: () => void;
}) {
  const base = `/servers/${encodeURIComponent(serverId)}`;
  const [settings, setSettings] = useState<VisibilitySettings | null>(null);
  const [directories, setDirectories] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    void api<VisibilitySettings>(`${base}/visibility`, { signal: controller.signal }).then((value) => {
      if (!controller.signal.aborted) { setSettings(value); setDirectories(value.excludedDirectories.join('\n')); }
    }).catch((e) => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [base]);
  async function save(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError('');
    try {
      await api(`${base}/visibility`, { method: 'PUT', body: JSON.stringify({
        excludedDirectories: directories.split('\n').map((line) => line.trim()).filter(Boolean),
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
          <label className="block space-y-2 text-sm">Excluded directories
            <Textarea aria-label="Excluded directories" value={directories} onChange={(e) => setDirectories(e.target.value)} rows={4} disabled={busy}
              placeholder={'/home/me/scratch\n/tmp'} />
          </label>
          <p className="text-xs text-muted-foreground">One absolute path per line. Hides sessions in that directory and its subdirectories.</p>
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
