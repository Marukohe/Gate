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
  const { fetchGitDiff } = useWebSocket();

  useEffect(() => {
    if (activeServerId && activeSessionId) {
      fetchGitDiff(activeServerId, activeSessionId);
    }
  }, [activeServerId, activeSessionId, fetchGitDiff]);

  if (rawDiff === undefined) {
    return (
      <div className="flex h-full items-center justify-center">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const files = parseDiff(rawDiff);

  if (files.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
        No changes detected
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto px-4">
      <div className="mx-auto max-w-4xl space-y-3 py-4">
        {files.map((file) => (
          <DiffFile key={file.path} file={file} />
        ))}
      </div>
    </div>
  );
}
