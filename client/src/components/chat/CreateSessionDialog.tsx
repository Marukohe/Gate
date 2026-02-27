import { useState, useEffect, useCallback } from 'react';
import { Folder, Loader2 } from 'lucide-react';
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
  onSubmit: (name: string, workingDir: string | null, claudeSessionId?: string | null) => void;
  defaultName: string;
  defaultWorkingDir?: string;
  serverId: string;
  onListClaudeSessions?: (serverId: string, workingDir: string) => Promise<string[]>;
}

export function CreateSessionDialog({ open, onOpenChange, onSubmit, defaultName, defaultWorkingDir, serverId, onListClaudeSessions }: CreateSessionDialogProps) {
  const [name, setName] = useState(defaultName);
  const [workingDir, setWorkingDir] = useState(defaultWorkingDir ?? '');
  const [pickerOpen, setPickerOpen] = useState(false);
  const [claudeSessions, setClaudeSessions] = useState<string[]>([]);
  const [selectedClaudeSession, setSelectedClaudeSession] = useState<string | null>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);

  useEffect(() => {
    if (open) {
      setName(defaultName);
      setWorkingDir(defaultWorkingDir ?? '');
      setClaudeSessions([]);
      setSelectedClaudeSession(null);
    }
  }, [open, defaultName, defaultWorkingDir]);

  // Fetch Claude sessions when workingDir changes
  useEffect(() => {
    if (!open || !workingDir.trim() || !onListClaudeSessions) {
      setClaudeSessions([]);
      setSelectedClaudeSession(null);
      return;
    }
    let cancelled = false;
    setLoadingSessions(true);
    onListClaudeSessions(serverId, workingDir.trim()).then((sessions) => {
      if (!cancelled) {
        setClaudeSessions(sessions);
        setSelectedClaudeSession(null);
        setLoadingSessions(false);
      }
    }).catch(() => {
      if (!cancelled) { setClaudeSessions([]); setLoadingSessions(false); }
    });
    return () => { cancelled = true; };
  }, [open, workingDir, serverId, onListClaudeSessions]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedName = name.trim() || defaultName;
    onSubmit(trimmedName, workingDir.trim() || null, selectedClaudeSession);
    setName('');
    setWorkingDir('');
    setClaudeSessions([]);
    setSelectedClaudeSession(null);
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

  const createDir = useCallback(async (parentPath: string, name: string): Promise<string> => {
    const res = await fetch(`/api/servers/${serverId}/mkdir`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ parentPath, name }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || 'Failed to create folder');
    }
    const data = await res.json();
    return data.path;
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
            {(loadingSessions || claudeSessions.length > 0) && (
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-medium">Claude session</span>
                {loadingSessions ? (
                  <div className="flex items-center gap-2 text-xs text-muted-foreground py-1">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Loading sessions...
                  </div>
                ) : (
                  <div className="flex flex-col gap-1.5 max-h-40 overflow-y-auto rounded border p-1.5">
                    <button
                      type="button"
                      className={`shrink-0 text-left text-xs px-2 py-1.5 rounded ${selectedClaudeSession === null ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'}`}
                      onClick={() => setSelectedClaudeSession(null)}
                    >
                      New session
                    </button>
                    {claudeSessions.map((sid) => (
                      <button
                        key={sid}
                        type="button"
                        className={`shrink-0 text-left text-xs px-2 py-1.5 rounded font-mono overflow-hidden text-ellipsis whitespace-nowrap ${selectedClaudeSession === sid ? 'bg-primary text-primary-foreground' : 'bg-muted hover:bg-accent'}`}
                        onClick={() => setSelectedClaudeSession(sid)}
                        title={sid}
                      >
                        {sid}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
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
        createDir={createDir}
        initialPath={workingDir || defaultWorkingDir || ''}
      />
    </>
  );
}
