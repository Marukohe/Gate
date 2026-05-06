import { useState, useEffect, useCallback } from 'react';
import { Folder } from 'lucide-react';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RemoteDirPicker, type BrowseResult } from '@/components/RemoteDirPicker';
import { useServerStore } from '@/stores/server-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { toast } from 'sonner';

interface AddWorkspaceDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AddWorkspaceDialog({ open, onOpenChange }: AddWorkspaceDialogProps) {
  const servers = useServerStore((s) => s.servers);
  const [serverId, setServerId] = useState<string>('');
  const [repoPath, setRepoPath] = useState('');
  const [name, setName] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const { createWorkspace } = useWebSocket();

  useEffect(() => {
    if (open) {
      setServerId(servers[0]?.id ?? '');
      setRepoPath('');
      setName('');
    }
  }, [open, servers]);

  // Auto-fill name from basename of repoPath
  useEffect(() => {
    if (!name && repoPath) {
      const base = repoPath.split('/').filter(Boolean).pop();
      if (base) setName(base);
    }
  }, [repoPath, name]);

  const fetchDirs = useCallback(async (path: string): Promise<BrowseResult> => {
    if (!serverId) throw new Error('Pick a server first');
    const res = await fetch(`/api/servers/${serverId}/browse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) throw new Error('Browse failed');
    return res.json();
  }, [serverId]);

  const createDir = useCallback(async (parentPath: string, dirName: string): Promise<string> => {
    if (!serverId) throw new Error('Pick a server first');
    const res = await fetch(`/api/servers/${serverId}/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentPath, name: dirName }),
    });
    if (!res.ok) throw new Error('Failed to create folder');
    const data = await res.json();
    return data.path;
  }, [serverId]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverId || !repoPath.trim()) {
      toast.error('Server and repo path are required');
      return;
    }
    createWorkspace(serverId, repoPath.trim(), name.trim() || undefined);
    onOpenChange(false);
  };

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add workspace</DialogTitle>
            <DialogDescription>Pick a server and the root of a remote git repository.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Server</span>
              <select
                className="h-9 rounded-md border bg-background px-2 text-sm"
                value={serverId}
                onChange={(e) => setServerId(e.target.value)}
              >
                {servers.map((s) => (
                  <option key={s.id} value={s.id}>{s.name}</option>
                ))}
                {servers.length === 0 && <option value="">(no servers)</option>}
              </select>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Repository path</span>
              <div className="flex gap-2">
                <Input
                  value={repoPath}
                  onChange={(e) => setRepoPath(e.target.value)}
                  placeholder="/home/user/my-repo"
                  className="flex-1"
                  readOnly
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setPickerOpen(true)}
                  disabled={!serverId}
                >
                  <Folder className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Name</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="auto from path"
              />
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit">Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <RemoteDirPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={setRepoPath}
        fetchDirs={fetchDirs}
        createDir={createDir}
        initialPath={repoPath}
      />
    </>
  );
}
