import { useState, useEffect, useCallback } from 'react';
import { Folder } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { RemoteDirPicker, type BrowseResult } from '@/components/RemoteDirPicker';
import { useServerStore, type Server } from '@/stores/server-store';

interface ServerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** When set, dialog switches to edit mode for this server. */
  editServer?: Server | null;
}

export function ServerDialog({ open, onOpenChange, editServer }: ServerDialogProps) {
  const addServer = useServerStore((s) => s.addServer);
  const updateServer = useServerStore((s) => s.updateServer);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authType, setAuthType] = useState<'password' | 'privateKey'>('password');
  const [password, setPassword] = useState('');
  const [privateKeyPath, setPrivateKeyPath] = useState('');
  const [defaultWorkingDir, setDefaultWorkingDir] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const isEdit = !!editServer;

  // Pre-fill form when editing
  useEffect(() => {
    if (open && editServer) {
      setName(editServer.name);
      setHost(editServer.host);
      setPort(String(editServer.port));
      setUsername(editServer.username);
      setAuthType(editServer.authType);
      setPassword(editServer.password ?? '');
      setPrivateKeyPath(editServer.privateKeyPath ?? '');
      setDefaultWorkingDir(editServer.defaultWorkingDir ?? '');
    } else if (open && !editServer) {
      resetForm();
    }
  }, [open, editServer]);

  const canBrowse = !!host && !!username;

  const handleSubmit = async () => {
    const payload = {
      name, host, port: parseInt(port), username, authType,
      ...(authType === 'password' ? { password } : { privateKeyPath }),
      ...(defaultWorkingDir.trim() ? { defaultWorkingDir: defaultWorkingDir.trim() } : { defaultWorkingDir: null }),
    };

    if (isEdit) {
      const res = await fetch(`/api/servers/${editServer!.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const server = await res.json();
        updateServer(server);
        onOpenChange(false);
      }
    } else {
      const res = await fetch('/api/servers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (res.ok) {
        const server = await res.json();
        addServer(server);
        onOpenChange(false);
        resetForm();
      }
    }
  };

  const resetForm = () => {
    setName(''); setHost(''); setPort('22'); setUsername('');
    setPassword(''); setPrivateKeyPath(''); setDefaultWorkingDir('');
  };

  const fetchDirsForSaved = useCallback(async (path: string): Promise<BrowseResult> => {
    const res = await fetch(`/api/servers/${editServer!.id}/browse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Browse failed');
    }
    return res.json();
  }, [editServer]);

  const fetchDirsAdHoc = useCallback(async (path: string): Promise<BrowseResult> => {
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

  const fetchDirs = isEdit ? fetchDirsForSaved : fetchDirsAdHoc;

  const createDirForSaved = useCallback(async (parentPath: string, dirName: string): Promise<string> => {
    const res = await fetch(`/api/servers/${editServer!.id}/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentPath, name: dirName }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to create folder');
    }
    const data = await res.json();
    return data.path;
  }, [editServer]);

  const createDirAdHoc = useCallback(async (parentPath: string, dirName: string): Promise<string> => {
    const res = await fetch('/api/mkdir', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        host, port: parseInt(port), username, authType,
        ...(authType === 'password' ? { password } : { privateKeyPath }),
        parentPath, name: dirName,
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to create folder');
    }
    const data = await res.json();
    return data.path;
  }, [host, port, username, authType, password, privateKeyPath]);

  const createDir = isEdit ? createDirForSaved : createDirAdHoc;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{isEdit ? 'Edit Server' : 'Add Server'}</DialogTitle>
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
            <Button onClick={handleSubmit} disabled={!name || !host || !username}>
              {isEdit ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <RemoteDirPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={setDefaultWorkingDir}
        fetchDirs={fetchDirs}
        createDir={createDir}
        initialPath={defaultWorkingDir || ''}
      />
    </>
  );
}
