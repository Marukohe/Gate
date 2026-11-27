import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ChevronDown } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import type { Server } from '@/stores/server-store';
import { api } from '@/lib/api';
import type { MonitorServer, SshHost, ToolDefinition } from '../../../../server/src/types';
import { ToolConnectionSelect } from './ToolConnectionSelect';

export function ServerDialog({ open, onOpenChange, editServer, onSaved, connections = [], accounts = [], accountTools = [], onSelectConnection }: {
  open: boolean; onOpenChange: (value: boolean) => void; editServer: Server | null; onSaved: () => void;
  connections?: MonitorServer[]; accounts?: MonitorServer[]; accountTools?: Server[]; onSelectConnection?: (id: string) => void;
}) {
  const [auth, setAuth] = useState('privateKey');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState<ToolDefinition[]>([]);
  const [hosts, setHosts] = useState<string[]>([]);
  const [loadingHosts, setLoadingHosts] = useState(false);
  const [hostError, setHostError] = useState('');
  const [mode, setMode] = useState<'choose' | 'config' | 'manual'>('choose');
  const [alias, setAlias] = useState('');
  const [profile, setProfile] = useState<SshHost | null>(null);
  const [resolving, setResolving] = useState(false);
  const resolveController = useRef<AbortController | null>(null);
  const [fields, setFields] = useState({ name: '', host: '', port: '22', username: '', privateKeyPath: '' });
  const account = editServer?.tool === 'ssh';
  const accountChoices = [...accounts, ...connections];
  const currentOverride = (tool: ToolDefinition) => {
    const path = accountTools.find((server) => server.tool === tool.id)?.executablePath;
    return path && path !== tool.executable ? path : '';
  };
  const field = (name: keyof typeof fields, value: string) => setFields((current) => ({ ...current, [name]: value }));
  useEffect(() => {
    if (!open) return;
    setAuth(editServer?.authType ?? 'privateKey'); setError('');
    setFields({ name: editServer?.name || '', host: editServer?.host || '', port: String(editServer?.port ?? 22),
      username: editServer?.username || '', privateKeyPath: editServer?.privateKeyPath || '' });
    setMode(editServer ? 'manual' : 'choose'); setAlias(''); setProfile(null); setResolving(false);
    setHosts([]); setHostError(''); setLoadingHosts(!editServer);
    const controller = new AbortController();
    if (editServer?.tool === 'ssh') void api<{ tools: ToolDefinition[] }>('/tools', { signal: controller.signal }).then((data) => setTools(data.tools))
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
    const executables: Record<string, FormDataEntryValue> = {};
    for (const tool of tools) {
      const key = `executable-${tool.id}`;
      if (body[key] !== undefined && body[key] !== currentOverride(tool)) executables[tool.id] = body[key];
      delete body[key];
    }
    const url = !editServer ? '/ssh/accounts' : account ? `/ssh/accounts/${editServer.id}` : `/servers/${editServer.id}`;
    try {
      await api(url, { method: editServer ? 'PUT' : 'POST', body: JSON.stringify({ ...body, authType: auth, executables }) });
      onSaved(); onOpenChange(false);
    } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  }
  async function remove() {
    if (!editServer || !confirm(`Remove ${editServer.name} from Gate?`)) return;
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
      <DialogDescription>{editServer ? 'SSH connection settings.' : 'Connect over SSH to find your sessions.'}</DialogDescription></DialogHeader>
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
      {editServer && onSelectConnection && (accounts.length && accountChoices.length > 1
        ? <label className="block space-y-1 text-sm">SSH account<select value={editServer.id} disabled={busy}
          className="h-9 w-full rounded-md border bg-background px-3" onChange={(event) => onSelectConnection(event.target.value)}>
          {accountChoices.map((choice) => <option key={choice.id} value={choice.id}>{choice.username} · {choice.toolName ?? choice.name}</option>)}
        </select></label>
        : !accounts.length && connections.length > 1
          ? <ToolConnectionSelect connections={connections} value={editServer.id} onChange={onSelectConnection} disabled={busy} />
          : null)}
      <label className="block space-y-1 text-sm">Name<Input name="name" required value={fields.name} onChange={(e) => field('name', e.target.value)} placeholder="Development" /></label>
      {mode === 'manual' ? connectionFields : mode === 'config' && profile ? <details key={alias} open={!profile.identityFiles.length} className="rounded-lg border px-3 py-2">
        <summary className="cursor-pointer break-all text-sm text-muted-foreground">{fields.username}@{fields.host}:{fields.port}</summary>
        <div className="mt-3 space-y-4">{connectionFields}</div>
      </details> : null}
      {editServer && (account
        ? <details className="rounded-lg border px-3 py-2"><summary className="cursor-pointer text-sm">Tool paths</summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs text-muted-foreground">Set an absolute path only if a tool is missing from the SSH login PATH.</p>
            {tools.map((tool) => <label key={tool.id} className="block space-y-1 text-sm">{tool.name} executable
              <Input name={`executable-${tool.id}`} defaultValue={currentOverride(tool)} placeholder={tool.executable} />
            </label>)}
          </div>
        </details>
        : <label className="block space-y-1 text-sm">Tool executable
          <Input name="executablePath" required defaultValue={editServer.executablePath || editServer.codexPath || editServer.tool || 'codex'} />
        </label>)}
      {error && <p role="alert" className="break-words text-sm text-destructive">{error}</p>}
      <div className="flex justify-between gap-3">
        {editServer && <Button type="button" variant="ghost" disabled={busy} onClick={() => void remove()}>{!account && connections.length > 1 ? 'Remove tool' : 'Remove server'}</Button>}
        <Button className="ml-auto" disabled={busy || resolving || mode === 'choose' || mode === 'config' && !profile}>{busy ? (editServer && !account ? 'Saving…' : 'Checking SSH…') : 'Save server'}</Button>
      </div>
    </form>
  </DialogContent></Dialog>;
}
