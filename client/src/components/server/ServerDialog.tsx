import { useState, useCallback } from 'react';
import { Folder } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RemoteDirPicker, type BrowseResult } from '@/components/RemoteDirPicker';
import { useServerStore } from '@/stores/server-store';

interface ServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ServerDialog({ open, onOpenChange }: ServerDialogProps) {
  const addServer = useServerStore((s) => s.addServer);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authType, setAuthType] = useState<'password' | 'privateKey'>('password');
  const [password, setPassword] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [defaultWorkingDir, setDefaultWorkingDir] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const canBrowse = !!host && !!username;

  const handleSubmit = async () => {
    const res = await fetch('/api/servers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, host, port: parseInt(port), username, authType,
        ...(authType === 'password' ? { password } : { privateKeyPath }),
        ...(defaultWorkingDir.trim() ? { defaultWorkingDir: defaultWorkingDir.trim() } : {}),
      }),
    });
    if (res.ok) {
      const server = await res.json();
      addServer(server);
      onOpenChange(false);
      resetForm();
    }
  };

  const resetForm = () => {
    setName(''); setHost(''); setPort('22'); setUsername('');
    setPassword(''); setPrivateKeyPath(''); setDefaultWorkingDir('');
  };

  const fetchDirs = useCallback(async (path: string): Promise<BrowseResult> => {
    const res = await fetch('/api/browse', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host, port: parseInt(port), username, authType,
        ...(authType === 'password' ? { password } : { privateKeyPath }),
        path,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Browse failed');
    }
    return res.json();
  }, [host, port, username, authType, password, privateKeyPath]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Add Server</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <Input placeholder="Name (e.g. dev-server)" value={name} onChange={(e) => setName(e.target.value)} />
            <div className="flex gap-2">
              <Input placeholder="Host" className="flex-1" value={host} onChange={(e) => setHost(e.target.value)} />
              <Input placeholder="Port" className="w-20" value={port} onChange={(e) => setPort(e.target.value)} />
            </div>
            <Input placeholder="Username" value={username} onChange={(e) => setUsername(e.target.value)} />
            <Tabs value={authType} onValueChange={(v) => setAuthType(v as 'password' | 'privateKey')}>
              <TabsList className="w-full">
                <TabsTrigger value="password" className="flex-1">Password</TabsTrigger>
                <TabsTrigger value="privateKey" className="flex-1">Private Key</TabsTrigger>
              </TabsList>
              <TabsContent value="password">
                <Input type="password" placeholder="Password" value={password} onChange={(e) => setPassword(e.target.value)} />
              </TabsContent>
              <TabsContent value="privateKey">
                <Input placeholder="Key path (e.g. ~/.ssh/id_rsa)" value={privateKeyPath} onChange={(e) => setPrivateKeyPath(e.target.value)} />
              </TabsContent>
            </Tabs>
            <div className="flex gap-2">
              <Input
                placeholder="Default working directory (optional)"
                className="flex-1"
                value={defaultWorkingDir}
                onChange={(e) => setDefaultWorkingDir(e.target.value)}
                readOnly
              />
              <Button
                type="button"
                variant="outline"
                size="icon"
                disabled={!canBrowse}
                onClick={() => setPickerOpen(true)}
                title={canBrowse ? 'Browse remote directories' : 'Fill in host and username first'}
              >
                <Folder className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button onClick={handleSubmit} disabled={!name || !host || !username}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RemoteDirPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={setDefaultWorkingDir}
        fetchDirs={fetchDirs}
        initialPath={defaultWorkingDir || '~'}
      />
    </>
  );
}
