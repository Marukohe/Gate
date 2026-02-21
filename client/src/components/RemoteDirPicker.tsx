import { useState, useEffect, useCallback } from 'react';
import { Folder, FolderOpen, ArrowUp, Loader2, AlertCircle } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';

export interface BrowseResult {
  path: string;
  directories: string[];
}

interface RemoteDirPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (path: string) => void;
  /** Called when user navigates; returns resolved path + subdirectories. */
  fetchDirs: (path: string) => Promise<BrowseResult>;
  initialPath?: string;
}

export function RemoteDirPicker({ open, onOpenChange, onSelect, fetchDirs, initialPath = '' }: RemoteDirPickerProps) {
  const [currentPath, setCurrentPath] = useState(initialPath);
  const [inputPath, setInputPath] = useState(initialPath);
  const [directories, setDirectories] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const navigate = useCallback(async (path: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await fetchDirs(path);
      setCurrentPath(result.path);
      setInputPath(result.path);
      setDirectories(result.directories);
    } catch (err: any) {
      setError(err.message || 'Failed to list directory');
    } finally {
      setLoading(false);
    }
  }, [fetchDirs]);

  useEffect(() => {
    if (open) {
      setError(null);
      navigate(initialPath || '');
    }
  }, [open, initialPath, navigate]);

  const handleGoUp = () => {
    const parent = currentPath.replace(/\/[^/]+\/?$/, '') || '/';
    navigate(parent);
  };

  const handlePathSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputPath.trim()) navigate(inputPath.trim());
  };

  const handleSelect = () => {
    onSelect(currentPath);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Select Directory</DialogTitle>
        </DialogHeader>

        <form onSubmit={handlePathSubmit} className="flex gap-2">
          <Input
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            placeholder="/home/user/project"
            className="flex-1 font-mono text-sm"
          />
          <Button type="submit" variant="outline" size="sm" disabled={loading}>
            Go
          </Button>
        </form>

        <ScrollArea className="h-64 rounded-md border">
          {loading ? (
            <div className="flex h-full items-center justify-center p-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="flex flex-col items-center gap-2 p-8 text-sm text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span>{error}</span>
            </div>
          ) : (
            <div className="p-1">
              {currentPath !== '/' && (
                <button
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                  onClick={handleGoUp}
                >
                  <ArrowUp className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">..</span>
                </button>
              )}
              {directories.length === 0 && !loading && (
                <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                  No subdirectories
                </div>
              )}
              {directories.map((dir) => (
                <button
                  key={dir}
                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm hover:bg-muted"
                  onClick={() => navigate(`${currentPath}/${dir}`)}
                >
                  <Folder className="h-4 w-4 text-muted-foreground" />
                  <span>{dir}</span>
                </button>
              ))}
            </div>
          )}
        </ScrollArea>

        <div className="flex items-center gap-2 rounded-md bg-muted px-3 py-2 text-xs font-mono text-muted-foreground">
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{currentPath}</span>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button onClick={handleSelect} disabled={loading}>Select</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
