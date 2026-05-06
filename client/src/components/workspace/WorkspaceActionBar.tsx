import { useState } from 'react';
import { Check, Eye, GitPullRequest, Loader2, Rocket, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { CreatePRDialog } from '@/components/changes/CreatePRDialog';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useWebSocket } from '@/hooks/use-websocket';

interface WorkspaceActionBarProps {
  workspaceId: string;
  branch?: string | null;
}

export function WorkspaceActionBar({ workspaceId, branch }: WorkspaceActionBarProps) {
  const result = useWorkspaceStore((s) => s.actionResults[workspaceId]);
  const { runWorkspaceAction } = useWebSocket();
  const [prOpen, setPrOpen] = useState(false);
  const running = result?.status === 'running';

  return (
    <div className="border-b px-2 py-2">
      <div className="grid grid-cols-5 gap-1">
        <Button variant="outline" size="sm" disabled={running} onClick={() => runWorkspaceAction(workspaceId, 'push')} title="Push">
          {running && result?.action === 'push' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Rocket className="h-3.5 w-3.5" />}
        </Button>
        <Button variant="outline" size="sm" disabled={running} onClick={() => setPrOpen(true)} title="Create PR">
          {running && result?.action === 'create-pr' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitPullRequest className="h-3.5 w-3.5" />}
        </Button>
        <Button variant="outline" size="sm" disabled={running} onClick={() => runWorkspaceAction(workspaceId, 'mark-review')} title="Review">
          <Eye className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="sm" disabled={running} onClick={() => runWorkspaceAction(workspaceId, 'mark-done')} title="Done">
          <Check className="h-3.5 w-3.5" />
        </Button>
        <Button variant="outline" size="sm" disabled={running} onClick={() => runWorkspaceAction(workspaceId, 'mark-canceled')} title="Cancel">
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>
      {result?.status === 'error' && (
        <div className="mt-2 truncate text-[11px] text-destructive" title={result.error}>
          {result.error}
        </div>
      )}
      {result?.url && (
        <a href={result.url} target="_blank" rel="noreferrer" className="mt-2 block truncate text-[11px] text-primary hover:underline">
          {result.url}
        </a>
      )}

      <CreatePRDialog
        open={prOpen}
        onOpenChange={setPrOpen}
        defaultBranch={branch ?? undefined}
        onSubmit={(title, body) => runWorkspaceAction(workspaceId, 'create-pr', { title, body })}
      />
    </div>
  );
}
