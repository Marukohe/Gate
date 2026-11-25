import { useEffect, useState, type FormEvent } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { Server } from '@/stores/server-store';
import { api } from '@/lib/api';
import type { ToolDefinition } from '../../../../server/src/types';

export function ServerDialog({ open, onOpenChange, editServer, onSaved }: {
  open: boolean; onOpenChange: (value: boolean) => void; editServer: Server | null; onSaved: () => void;
}) {
  const [auth, setAuth] = useState('privateKey');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [tool, setTool] = useState('codex');
  const [executable, setExecutable] = useState('codex');
  useEffect(() => {
    if (!open) return;
    setAuth(editServer?.authType ?? 'privateKey'); setError(''); setTool(editServer?.tool || 'codex');
    setExecutable(editServer?.executablePath || editServer?.codexPath || 'codex');
    const controller = new AbortController();
    void api<{ tools: ToolDefinition[] }>('/tools', { signal: controller.signal }).then((data) => setTools(data.tools))
      .catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); });
    return () => controller.abort();
  }, [open, editServer]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(`/servers${editServer ? `/${editServer.id}` : ''}`, { method: editServer ? 'PUT' : 'POST', body: JSON.stringify({ ...body, authType: auth, tool, executablePath: executable }) });
      onSaved(); onOpenChange(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!editServer || !confirm(`Remove ${editServer.name} from Gate?`)) return;
    setBusy(true);
    try { await api(`/servers/${editServer.id}`, { method: 'DELETE' }); onSaved(); onOpenChange(false); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
    <DialogHeader><DialogTitle>{editServer ? 'Edit server' : 'Add server'}</DialogTitle>
      <DialogDescription>Choose a tool and the SSH account where it runs.</DialogDescription></DialogHeader>
    <form key={editServer?.id ?? 'new'} onSubmit={save} className="space-y-4">
      <label className="block space-y-1 text-sm">Tool<select aria-label="Tool" value={tool} disabled={!!editServer || busy || !tools.length}
        className="h-9 w-full rounded-md border bg-background px-3 disabled:opacity-60"
        onChange={(event) => { setTool(event.target.value); setExecutable(tools.find((tool) => tool.id === event.target.value)?.executable || ''); }}>
        {tools.map((tool) => <option key={tool.id} value={tool.id}>{tool.name}</option>)}</select>
        <span className="text-xs text-muted-foreground">{tools.find((item) => item.id === tool)?.description}</span></label>
      <label className="block space-y-1 text-sm">Name<Input name="name" required defaultValue={editServer?.name} placeholder="Development" /></label>
      <div className="flex gap-3">
        <label className="min-w-0 flex-1 space-y-1 text-sm">Host<Input name="host" required defaultValue={editServer?.host} placeholder="192.168.1.10" /></label>
        <label className="w-20 space-y-1 text-sm">Port<Input name="port" type="number" min="1" max="65535" required defaultValue={editServer?.port ?? 22} /></label>
      </div>
      <label className="block space-y-1 text-sm">Username<Input name="username" required defaultValue={editServer?.username} /></label>
      <label className="block space-y-1 text-sm">Authentication<select aria-label="Authentication" className="h-9 w-full rounded-md border bg-background px-3"
        value={auth} onChange={(e) => setAuth(e.target.value)}><option value="privateKey">SSH key</option><option value="password">Password</option></select></label>
      {auth === 'privateKey' ? <label className="block space-y-1 text-sm">Key path on Gate's machine<Input name="privateKeyPath" required
        defaultValue={editServer?.privateKeyPath} placeholder="~/.ssh/id_ed25519" /></label>
        : <label className="block space-y-1 text-sm">Password<Input name="password" type="password" autoComplete="new-password"
          required={!editServer?.hasPassword} placeholder={editServer?.hasPassword ? 'Leave empty to keep saved password' : ''} /></label>}
      <label className="block space-y-1 text-sm">Default working directory<Input name="defaultWorkingDir" defaultValue={editServer?.defaultWorkingDir} placeholder="/home/me/project" /></label>
      <label className="block space-y-1 text-sm">Tool executable<Input name="executablePath" aria-label="Tool executable" aria-describedby="executable-help" required value={executable} onChange={(event) => setExecutable(event.target.value)} />
        <span id="executable-help" className="text-xs text-muted-foreground">Use an absolute path if the tool is not on the SSH login PATH.</span></label>
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      <div className="flex justify-between gap-3">
        {editServer && <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove()}>Remove server</Button>}
        <Button className="ml-auto" disabled={busy || !tools.length}>{busy ? 'Saving…' : 'Save server'}</Button>
      </div>
    </form>
  </DialogContent></Dialog>;
}
