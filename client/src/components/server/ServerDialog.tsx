import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { Server } from '@/stores/server-store';
import { api } from '@/lib/api';
import type { MonitorServer, SshHost, ToolDefinition } from '../../../../server/src/types';
import { ToolConnectionSelect } from './ToolConnectionSelect';

export function ServerDialog({ open, onOpenChange, editServer, onSaved, connections = [], onSelectConnection }: {
  open: boolean; onOpenChange: (value: boolean) => void; editServer: Server | null; onSaved: () => void;
  connections?: MonitorServer[]; onSelectConnection?: (id: string) => void;
}) {
  const [auth, setAuth] = useState('privateKey');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [tool, setTool] = useState('codex');
  const [executable, setExecutable] = useState('codex');
  const [hosts, setHosts] = useState<string[]>([]);
  const [loadingHosts, setLoadingHosts] = useState(false);
  const [hostError, setHostError] = useState('');
  const [mode, setMode] = useState<'choose' | 'config' | 'manual'>('choose');
  const [alias, setAlias] = useState('');
  const [profile, setProfile] = useState<SshHost | null>(null);
  const [resolving, setResolving] = useState(false);
  const resolveController = useRef<AbortController | null>(null);
  const [fields, setFields] = useState({ name: '', host: '', port: '22', username: '', privateKeyPath: '' });
  const field = (name: keyof typeof fields, value: string) => setFields((current) => ({ ...current, [name]: value }));
  useEffect(() => {
    if (!open) return;
    setAuth(editServer?.authType ?? 'privateKey'); setError(''); setTool(editServer?.tool || 'codex');
    setExecutable(editServer?.executablePath || editServer?.codexPath || 'codex');
    setFields({ name: editServer?.name || '', host: editServer?.host || '', port: String(editServer?.port ?? 22),
      username: editServer?.username || '', privateKeyPath: editServer?.privateKeyPath || '' });
    setMode(editServer ? 'manual' : 'choose'); setAlias(''); setProfile(null); setResolving(false);
    setHosts([]); setHostError(''); setLoadingHosts(!editServer);
    const controller = new AbortController();
    void api<{ tools: ToolDefinition[] }>('/tools', { signal: controller.signal }).then((data) => setTools(data.tools))
      .catch((error: Error) => { if (!controller.signal.aborted) setError(error.message); });
    if (!editServer) void api<{ hosts: string[] }>('/ssh/hosts', { signal: controller.signal })
      .then((data) => { if (!controller.signal.aborted) { setHosts(data.hosts); if (!data.hosts.length) setMode('manual'); } })
      .catch(() => { if (!controller.signal.aborted) { setHostError('Could not read SSH hosts. You can enter the connection manually.'); setMode('manual'); } })
      .finally(() => { if (!controller.signal.aborted) setLoadingHosts(false); });
    return () => { controller.abort(); resolveController.current?.abort(); };
  }, [open, editServer]);
  async function chooseHost(value: string) {
    resolveController.current?.abort(); setHostError(''); setResolving(false); setProfile(null);
    if (value === '@manual') { setMode('manual'); return; }
    const controller = new AbortController(); resolveController.current = controller;
    setMode('config'); setAlias(value); setResolving(true);
    try {
      const host = await api<SshHost>(`/ssh/hosts/${encodeURIComponent(value)}`, { signal: controller.signal });
      if (controller.signal.aborted) return;
      setProfile(host); setAuth(host.identityFiles.length ? 'privateKey' : 'password');
      setFields((current) => ({ name: !current.name || current.name === alias ? value : current.name,
        host: host.host, port: String(host.port), username: host.username, privateKeyPath: host.identityFiles[0] || '' }));
    } catch (error) { if (!controller.signal.aborted) setHostError((error as Error).message); }
    finally { if (!controller.signal.aborted) setResolving(false); }
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const body = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api(`/servers${editServer ? `/${editServer.id}` : ''}`, { method: editServer ? 'PUT' : 'POST', body: JSON.stringify({ ...body, authType: auth, tool, executablePath: executable }) });
      onSaved(); onOpenChange(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!editServer || !confirm(connections.length > 1 ? `Remove ${tools.find((t) => t.id === tool)?.name || tool} from Gate?` : `Remove ${editServer.name} from Gate?`)) return;
    setBusy(true);
    try { await api(`/servers/${editServer.id}`, { method: 'DELETE' }); onSaved(); onOpenChange(false); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  const connectionFields = <>
    <div className="flex gap-3">
      <label className="min-w-0 flex-1 space-y-1 text-sm">Host<Input name="host" required value={fields.host} onChange={(e) => field('host', e.target.value)} placeholder="192.168.1.10" /></label>
      <label className="w-20 space-y-1 text-sm">Port<Input name="port" type="number" min="1" max="65535" required value={fields.port} onChange={(e) => field('port', e.target.value)} /></label>
    </div>
    <label className="block space-y-1 text-sm">Username<Input name="username" required value={fields.username} onChange={(e) => field('username', e.target.value)} /></label>
    <label className="block space-y-1 text-sm">Authentication<select aria-label="Authentication" className="h-9 w-full rounded-md border bg-background px-3"
      value={auth} onChange={(e) => setAuth(e.target.value)}><option value="privateKey">SSH key</option><option value="password">Password</option></select></label>
    {auth === 'privateKey' ? <label className="block space-y-1 text-sm">Key path on Gate's machine<Input name="privateKeyPath" required
      list="ssh-identity-files" value={fields.privateKeyPath} onChange={(e) => field('privateKeyPath', e.target.value)} placeholder="~/.ssh/id_ed25519" />
      <datalist id="ssh-identity-files">{profile?.identityFiles.map((file) => <option key={file} value={file} />)}</datalist></label>
      : <label className="block space-y-1 text-sm">Password<Input key={alias} name="password" type="password" autoComplete="new-password"
        required={!editServer?.hasPassword} placeholder={editServer?.hasPassword ? 'Leave empty to keep saved password' : ''} /></label>}
  </>;
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl">
    <DialogHeader><DialogTitle>{editServer ? 'Edit server' : 'Add server'}</DialogTitle>
      <DialogDescription>Choose a tool and the SSH account where it runs.</DialogDescription></DialogHeader>
    <form key={editServer?.id ?? 'new'} onSubmit={save} className="space-y-4">
      {!editServer && <div className="space-y-1 text-sm">
        <label htmlFor="ssh-host">SSH host</label>
        <div className="relative"><select id="ssh-host" value={mode === 'manual' ? '@manual' : alias} disabled={busy}
          className="h-10 w-full min-w-0 appearance-none rounded-md border bg-background pl-3 pr-9" onChange={(event) => void chooseHost(event.target.value)}>
          <option value="" disabled>{loadingHosts ? 'Reading SSH config…' : 'Choose an existing host…'}</option>
          {hosts.map((host) => <option key={host} value={host}>{host}</option>)}
          <option value="@manual">Enter manually…</option>
        </select><ChevronDown aria-hidden="true" className="pointer-events-none absolute right-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" /></div>
        <p className="text-xs text-muted-foreground">From ~/.ssh/config on the machine running Gate.</p>
        {resolving && <p role="status" className="text-xs text-muted-foreground">Reading connection settings…</p>}
        {hostError && <p role="alert" className="break-words text-xs text-destructive">{hostError}</p>}
      </div>}
      {editServer && connections.length > 1 && onSelectConnection ? <ToolConnectionSelect connections={connections} value={editServer.id} onChange={onSelectConnection} disabled={busy} />
        : <label className="block space-y-1 text-sm">Tool<select aria-label="Tool" value={tool} disabled={!!editServer || busy || !tools.length}
        className="h-9 w-full rounded-md border bg-background px-3 disabled:opacity-60"
        onChange={(event) => { setTool(event.target.value); setExecutable(tools.find((tool) => tool.id === event.target.value)?.executable || ''); }}>
        {tools.map((tool) => <option key={tool.id} value={tool.id}>{tool.name}</option>)}</select>
        <span className="text-xs text-muted-foreground">{tools.find((item) => item.id === tool)?.description}</span></label>}
      <label className="block space-y-1 text-sm">Name<Input name="name" required value={fields.name} onChange={(e) => field('name', e.target.value)} placeholder="Development" /></label>
      {mode === 'manual' ? connectionFields : mode === 'config' && profile ? <details key={alias} open={!profile.identityFiles.length} className="rounded-lg border px-3 py-2">
        <summary className="cursor-pointer break-all text-sm text-muted-foreground">{fields.username}@{fields.host}:{fields.port}</summary>
        <div className="mt-3 space-y-4">{connectionFields}</div>
      </details> : null}
      <label className="block space-y-1 text-sm">Default working directory<Input name="defaultWorkingDir" defaultValue={editServer?.defaultWorkingDir} placeholder="/home/me/project" /></label>
      <label className="block space-y-1 text-sm">Tool executable<Input name="executablePath" aria-label="Tool executable" aria-describedby="executable-help" required value={executable} onChange={(event) => setExecutable(event.target.value)} />
        <span id="executable-help" className="text-xs text-muted-foreground">Use an absolute path if the tool is not on the SSH login PATH.</span></label>
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      <div className="flex justify-between gap-3">
        {editServer && <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove()}>{connections.length > 1 ? 'Remove tool' : 'Remove server'}</Button>}
        <Button className="ml-auto" disabled={busy || !tools.length || resolving || mode === 'choose' || mode === 'config' && !profile}>{busy ? 'Saving…' : 'Save server'}</Button>
      </div>
    </form>
  </DialogContent></Dialog>;
}
