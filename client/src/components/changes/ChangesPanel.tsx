import { useEffect, useState } from 'react';
import { ExternalLink, GitCommitHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useGitStore } from '@/stores/git-store';
import { useServerStore } from '@/stores/server-store';
import { useSessionStore } from '@/stores/session-store';
import { useUIStore } from '@/stores/ui-store';
import { usePlanStore } from '@/stores/plan-store';
import { useWebSocket } from '@/hooks/use-websocket';
import { FileItem } from './FileItem';
import { CreatePRDialog } from './CreatePRDialog';

const EMPTY_PLANS: import('@/stores/plan-store').Plan[] = [];

export function ChangesPanel() {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeSessionId = useSessionStore((s) => activeServerId ? s.activeSessionId[activeServerId] : undefined);
  const gitStatus = useGitStore((s) => activeSessionId ? s.status[activeSessionId] : undefined);
  const selectedFile = useGitStore((s) => activeSessionId ? s.selectedFile[activeSessionId] : null);
  const setSelectedFile = useGitStore((s) => s.setSelectedFile);
  const setActiveTab = useUIStore((s) => s.setActiveTab);
  const prInfo = useGitStore((s) => activeSessionId ? s.prInfo[activeSessionId] : null);
  const gitBranch = useSessionStore((s) => activeSessionId ? s.gitInfo[activeSessionId]?.branch : undefined);
  const { fetchGitStatus, fetchGitDiff, gitCreatePR, fetchPRInfo } = useWebSocket();

  const activePlanId = usePlanStore((s) => s.activePlanId);
  const sessionPlans = usePlanStore((s) => activeSessionId ? (s.plans[activeSessionId] ?? EMPTY_PLANS) : EMPTY_PLANS);
  const activePlan = activePlanId ? sessionPlans.find((p) => p.id === activePlanId) ?? null : null;
  const hasUnfinishedTodos = activePlan ? activePlan.steps.some((step) => !step.completed) : false;

  const [prDialogOpen, setPRDialogOpen] = useState(false);

  useEffect(() => {
    if (!activeServerId || !activeSessionId) return;
    fetchGitStatus(activeServerId, activeSessionId);
    const interval = setInterval(() => fetchGitStatus(activeServerId, activeSessionId), 15_000);
    return () => clearInterval(interval);
    // fetchGitStatus is a stable useCallback — safe to omit from deps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServerId, activeSessionId]);

  useEffect(() => {
    if (activeServerId && activeSessionId) {
      fetchPRInfo(activeServerId, activeSessionId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeServerId, activeSessionId]);

  const handleFileClick = (path: string, isUntracked: boolean) => {
    if (!activeSessionId || !activeServerId) return;
    setSelectedFile(activeSessionId, path);
    setActiveTab('diff');
    // Untracked files aren't in git index, so use --no-index to show full content
    const diffArgs = isUntracked
      ? `--no-index /dev/null '${path}'`
      : `-- '${path}'`;
    fetchGitDiff(activeServerId, activeSessionId, diffArgs);
  };

  const totalChanges = (gitStatus?.staged.length ?? 0) + (gitStatus?.unstaged.length ?? 0) + (gitStatus?.untracked.length ?? 0);

  return (
    <>
      <div className="flex h-full flex-col bg-muted/20">
        <div className="flex items-center justify-between border-b px-3 py-2">
          <span className="text-xs font-medium">Changes</span>
          {totalChanges > 0 && (
            <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
              {totalChanges}
            </span>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-1 py-1">
          {!gitStatus && (
            <div className="py-8 text-center text-xs text-muted-foreground">Loading...</div>
          )}

          {gitStatus?.staged.length ? (
            <div className="mb-2">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-green-600 dark:text-green-400">
                Staged ({gitStatus.staged.length})
              </div>
              {gitStatus.staged.map((f) => (
                <FileItem key={'s-' + f.path} file={f} selected={selectedFile === f.path} onClick={() => handleFileClick(f.path, false)} />
              ))}
            </div>
          ) : null}

          {gitStatus?.unstaged.length ? (
            <div className="mb-2">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-yellow-600 dark:text-yellow-400">
                Modified ({gitStatus.unstaged.length})
              </div>
              {gitStatus.unstaged.map((f) => (
                <FileItem key={'u-' + f.path} file={f} selected={selectedFile === f.path} onClick={() => handleFileClick(f.path, false)} />
              ))}
            </div>
          ) : null}

          {gitStatus?.untracked.length ? (
            <div className="mb-2">
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                Untracked ({gitStatus.untracked.length})
              </div>
              {gitStatus.untracked.map((f) => (
                <FileItem key={'t-' + f.path} file={f} selected={selectedFile === f.path} onClick={() => handleFileClick(f.path, true)} />
              ))}
            </div>
          ) : null}

          {gitStatus && totalChanges === 0 && (
            <div className="py-8 text-center text-xs text-muted-foreground">Working tree clean</div>
          )}
        </div>

        <div className="border-t px-2 py-2">
          {prInfo ? (
            <a
              href={prInfo.url}
              target="_blank"
              rel="noopener noreferrer"
              className="flex w-full items-center justify-center gap-1.5 rounded-md bg-green-500/10 px-3 py-1.5 text-xs font-medium text-green-600 dark:text-green-400 hover:bg-green-500/20"
            >
              <ExternalLink className="h-3 w-3" />
              PR #{prInfo.number} ({prInfo.state})
            </a>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                className="w-full text-xs"
                onClick={() => setPRDialogOpen(true)}
                disabled={totalChanges === 0 || hasUnfinishedTodos}
                title={hasUnfinishedTodos ? 'Complete all plan items before creating PR' : undefined}
              >
                <GitCommitHorizontal className="mr-1.5 h-3 w-3" />
                Create PR
              </Button>
              {hasUnfinishedTodos && (
                <div className="text-[10px] text-yellow-600 dark:text-yellow-400 text-center">
                  {activePlan!.steps.filter((s) => !s.completed).length} plan items remaining
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <CreatePRDialog
        open={prDialogOpen}
        onOpenChange={setPRDialogOpen}
        onSubmit={(title, body) => {
          if (activeServerId && activeSessionId) {
            gitCreatePR(activeServerId, activeSessionId, title, body);
          }
        }}
        defaultBranch={gitBranch}
      />
    </>
  );
}
