import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useGitStore } from '@/stores/git-store';
import { useServerStore } from '@/stores/server-store';
import { useSessionStore } from '@/stores/session-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { parseDiff } from './diff-parser';
import { DiffFile } from './DiffFile';

export function DiffView() {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeSessionId = useSessionStore((s) => activeServerId ? s.activeSessionId[activeServerId] : undefined);
  const rawDiff = useGitStore((s) => activeSessionId ? s.diff[activeSessionId] : undefined);
  const selectedFile = useGitStore((s) => activeSessionId ? s.selectedFile[activeSessionId] : null);
  const { fetchGitDiff } = useWebSocket();

  // Fetch full diff when switching sessions or when no specific file is selected
  useEffect(() => {
    if (activeServerId && activeSessionId && !selectedFile) {
      fetchGitDiff(activeServerId, activeSessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServerId, activeSessionId, selectedFile]);

  if (rawDiff === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const files = parseDiff(rawDiff);

  const clearSelection = () => {
    if (activeSessionId) {
      useGitStore.getState().setSelectedFile(activeSessionId, null);
      if (activeServerId) fetchGitDiff(activeServerId, activeSessionId);
    }
  };

  if (files.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-muted-foreground">
        <span>No changes detected</span>
        {selectedFile && (
          <button onClick={clearSelection} className="text-xs text-primary hover:underline">
            Show all changes
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4">
      <div className="mx-auto max-w-4xl space-y-3 py-4">
        {selectedFile && (
          <button onClick={clearSelection} className="text-xs text-primary hover:underline mb-1">
            Show all changes
          </button>
        )}
        {files.map((file) => (
          <DiffFile key={file.path} file={file} />
        ))}
      </div>
    </div>
  );
}
