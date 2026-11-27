import { useState, type FormEvent } from 'react';
import { ChevronRight, Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { api } from '@/lib/api';
import type { GatewayStatus } from '../../../../server/src/types';

export function GatewayDialog({ gateways, onClose, onSaved }: {
  gateways: GatewayStatus[]; onClose: () => void; onSaved: (removed?: string) => void;
}) {
  const [form, setForm] = useState<GatewayStatus | 'new' | null>(gateways.length ? null : 'new');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const existing = form && form !== 'new' ? form : null;
  const route = existing ? `/gateways/${existing.id}` : '/gateways';

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const body = Object.fromEntries(new FormData(event.currentTarget));
    setBusy(true); setError('');
    try {
      await api(route, { method: existing ? 'PUT' : 'POST', body: JSON.stringify(body) });
      onSaved(); onClose();
    } catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  async function remove() {
    if (!existing || !window.confirm(`Disconnect ${existing.name} from this panel?`)) return;
    setBusy(true); setError('');
    try { await api(route, { method: 'DELETE' }); onSaved(existing.id); onClose(); }
    catch (error) { setError((error as Error).message); }
    finally { setBusy(false); }
  }

  return <Dialog open onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
      <DialogHeader>
        <DialogTitle>{existing ? 'Edit Gate' : form ? 'Add Gate' : 'Gateways'}</DialogTitle>
        <DialogDescription>{form ? 'Connect another Gate to this panel.' : 'Connected Gate services.'}</DialogDescription>
      </DialogHeader>
      {form ? <form onSubmit={save} key={existing?.id ?? 'new'} className="space-y-4">
        <label className="block space-y-1 text-sm">Name<Input name="name" maxLength={80} placeholder="Office" defaultValue={existing?.name} required /></label>
        <label className="block space-y-1 text-sm">Gate address<Input name="url" type="url" placeholder="https://gate.example.com" defaultValue={existing?.url} required /></label>
        <label className="block space-y-1 text-sm">Access token<Input name="token" type="password" autoComplete="new-password" maxLength={512}
          placeholder={existing ? 'Leave blank to keep the saved token' : undefined} required={!existing} /></label>
        {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center justify-end gap-2">
          {existing && <Button type="button" variant="ghost" className="mr-auto text-destructive" onClick={() => void remove()} disabled={busy}>Disconnect</Button>}
          {gateways.length > 0 && <Button type="button" variant="ghost" onClick={() => { setForm(null); setError(''); }} disabled={busy}>Back</Button>}
          <Button disabled={busy}>{busy ? 'Connecting…' : existing ? 'Save Gate' : 'Connect Gate'}</Button>
        </div>
      </form> : <>
        <div className="space-y-1">{gateways.map((gateway) => <button type="button" key={gateway.id}
          className="flex w-full items-center gap-2 rounded-lg border px-3 py-2.5 text-left hover:bg-accent"
          onClick={() => setForm(gateway)}>
          <div className="min-w-0 flex-1"><span className="block truncate text-sm font-medium">{gateway.name}</span>
            <span className={`block truncate text-xs ${gateway.error ? 'text-destructive' : 'text-muted-foreground'}`}>{gateway.error ?? gateway.url}</span>
          </div><ChevronRight className="size-4 shrink-0 text-muted-foreground" />
        </button>)}</div>
        <Button onClick={() => setForm('new')}><Plus />Add Gate</Button>
      </>}
    </DialogContent>
  </Dialog>;
}
