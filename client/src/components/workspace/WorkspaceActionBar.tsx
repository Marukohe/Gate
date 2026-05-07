import { useEffect, useState } from 'react';
import {
  Ban, Check, Eye, GitCommitHorizontal, GitPullRequest, Loader2, MoreHorizontal, Rocket,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { CreatePRDialog } from '@/components/changes/CreatePRDialog';
import { useWorkspaceStore } from '@/stores/workspace-store';
import { useWebSocket } from '@/hooks/use-websocket';
import type { WorkspaceActionState } from '@/stores/workspace-store';

interface WorkspaceActionBarProps {
  workspaceId: string;
  branch?: string | null;
  provider?: string | null;
}

export function WorkspaceActionBar({ workspaceId, branch, provider }: WorkspaceActionBarProps) {
  const result = useWorkspaceStore((s) => s.actionResults[workspaceId]);
  const { runWorkspaceAction } = useWebSocket();
  const [prOpen, setPrOpen] = useState(false);
  const [commitOpen, setCommitOpen] = useState(false);
  const running = result?.status === 'running';
  const runningAction = result?.status === 'running' ? result.action : null;

  return (
    <div className="border-b px-2 py-2">
      <div className="grid grid-cols-[minmax(0,1fr)_2.5rem_2.5rem] gap-1.5">
        <Button
          size="sm"
          disabled={running}
          onClick={() => setCommitOpen(true)}
          title="Stage all changes, commit, and push"
          className="min-w-0 justify-center text-xs"
        >
          {runningAction === 'commit-push' ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <GitCommitHorizontal className="h-3.5 w-3.5" />
          )}
          <span className="truncate">Commit & push</span>
        </Button>
        <Button variant="outline" size="sm" disabled={running} onClick={() => setPrOpen(true)} title="Create PR" className="px-0">
          {runningAction === 'create-pr' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitPullRequest className="h-3.5 w-3.5" />}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm" disabled={running} title="More actions" className="px-0">
              <MoreHorizontal className="h-3.5 w-3.5" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-40">
            <DropdownMenuLabel>Git</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => runWorkspaceAction(workspaceId, 'push')}>
              <Rocket className="h-4 w-4" />
              Push
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel>Status</DropdownMenuLabel>
            <DropdownMenuItem onClick={() => runWorkspaceAction(workspaceId, 'mark-review')}>
              <Eye className="h-4 w-4" />
              Mark review
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => runWorkspaceAction(workspaceId, 'mark-done')}>
              <Check className="h-4 w-4" />
              Mark done
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => runWorkspaceAction(workspaceId, 'mark-canceled')} variant="destructive">
              <Ban className="h-4 w-4" />
              Mark canceled
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {result?.status === 'error' && (
        <div className="mt-2 truncate text-[11px] text-destructive" title={result.error}>
          {result.error}
        </div>
      )}
      {result?.status === 'done' && !result.url && (
        <div className="mt-2 truncate text-[11px] text-muted-foreground" title={result.output}>
          {actionDoneLabel(result.action)}
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
      <CommitPushDialog
        open={commitOpen}
        onOpenChange={setCommitOpen}
        branch={branch}
        provider={provider}
        result={result}
        onGenerate={() => runWorkspaceAction(workspaceId, 'generate-commit-message', { provider: provider ?? undefined })}
        onSubmit={(commitMessage) => runWorkspaceAction(workspaceId, 'commit-push', { commitMessage })}
      />
    </div>
  );
}

function actionDoneLabel(action: string): string {
  if (action === 'generate-commit-message') return 'Commit message generated.';
  if (action === 'commit-push') return 'Committed and pushed.';
  if (action === 'push') return 'Pushed.';
  if (action === 'mark-review') return 'Marked for review.';
  if (action === 'mark-done') return 'Marked done.';
  if (action === 'mark-canceled') return 'Canceled.';
  return 'Action finished.';
}

function CommitPushDialog({
  open,
  onOpenChange,
  branch,
  provider,
  result,
  onGenerate,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  branch?: string | null;
  provider?: string | null;
  result?: WorkspaceActionState;
  onGenerate: () => void;
  onSubmit: (commitMessage: string) => void;
}) {
  const [message, setMessage] = useState('');
  const generating = result?.action === 'generate-commit-message' && result.status === 'running';

  useEffect(() => {
    if (!open || result?.action !== 'generate-commit-message' || result.status !== 'done' || !result.message) return;
    setMessage(result.message);
  }, [open, result?.action, result?.message, result?.status, result?.updatedAt]);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    const commitMessage = message.trim();
    if (!commitMessage) return;
    onSubmit(commitMessage);
    setMessage('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Commit and push</DialogTitle>
          <DialogDescription>Stage all current changes, create one commit, then push the current branch.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          {branch && (
            <div className="text-xs text-muted-foreground">
              Branch: <span className="font-mono">{branch}</span>
            </div>
          )}
          <div className="flex gap-2">
            <Input
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              placeholder="Commit message"
              autoFocus
            />
            <Button type="button" variant="outline" onClick={onGenerate} disabled={generating} title={provider ? `Generate with ${provider}` : 'Generate with AI'}>
              {generating ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Generate'}
            </Button>
          </div>
          {result?.action === 'generate-commit-message' && result.status === 'error' && (
            <div className="text-xs text-destructive" title={result.error}>
              {result.error}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={!message.trim()}>Commit & push</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
