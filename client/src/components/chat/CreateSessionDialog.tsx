import { useState, useEffect, useCallback } from 'react';
import { Folder } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { RemoteDirPicker, type BrowseResult } from '@/components/RemoteDirPicker';

interface CreateSessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (name: string, workingDir: string | null) => void;
  defaultName: string;
  defaultWorkingDir?: string;
  serverId: string;
}

export function CreateSessionDialog({ open, onOpenChange, onSubmit, defaultName, defaultWorkingDir, serverId }: CreateSessionDialogProps) {
  const [name, setName] = useState(defaultName);
  const [workingDir, setWorkingDir] = useState(defaultWorkingDir ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setWorkingDir(defaultWorkingDir ?? '');
    }
  }, [open, defaultName, defaultWorkingDir]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim() || defaultName;
    onSubmit(trimmedName, workingDir.trim() || null);
    setName('');
    setWorkingDir('');
    onOpenChange(false);
  };

  const fetchDirs = useCallback(async (path: string): Promise<BrowseResult> => {
    const res = await fetch(`/api/servers/${serverId}/browse`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Browse failed');
    }
    return res.json();
  }, [serverId]);

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Session</DialogTitle>
            <DialogDescription>Create a new Claude session.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Name</span>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={defaultName}
                autoFocus
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Working directory</span>
              <div className="flex gap-2">
                <Input
                  value={workingDir}
                  onChange={(e) => setWorkingDir(e.target.value)}
                  placeholder="Optional — defaults to home directory"
                  className="flex-1"
                  readOnly
                />
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  onClick={() => setPickerOpen(true)}
                  title="Browse remote directories"
                >
                  <Folder className="h-4 w-4" />
                </Button>
              </div>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit">Create</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <RemoteDirPicker
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onSelect={setWorkingDir}
        fetchDirs={fetchDirs}
        initialPath={workingDir || defaultWorkingDir || ''}
      />
    </>
  );
}
