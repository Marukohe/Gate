import { useState } from 'react';
import { GitBranch, GitFork, SendHorizontal, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import type { WorkspaceBranchList } from '@/stores/workspace-store';

export interface WorkspaceStartOptions {
  provider: string;
  branchMode: 'current' | 'existing' | 'create';
  branchName?: string;
  worktreeMode: 'main' | 'isolated' | 'existing';
  worktreePath?: string;
}

interface WorkspaceStartProps {
  workspaceName: string;
  defaultBranch: string | null;
  branches?: WorkspaceBranchList;
  existingWorktrees: string[];
  disabled?: boolean;
  onStart: (goal: string, options: WorkspaceStartOptions) => void;
}

const providerOptions = [
  { name: 'claude', label: 'Claude' },
  { name: 'codex', label: 'Codex' },
];

const branchModeOptions = [
  { name: 'current', label: 'Current' },
  { name: 'existing', label: 'Existing' },
  { name: 'create', label: 'New' },
] as const;

const worktreeModeOptions = [
  { name: 'main', label: 'Main' },
  { name: 'isolated', label: 'Worktree' },
  { name: 'existing', label: 'Existing' },
] as const;

export function WorkspaceStart({
  workspaceName,
  defaultBranch,
  branches,
  existingWorktrees,
  disabled,
  onStart,
}: WorkspaceStartProps) {
  const [goal, setGoal] = useState('');
  const [provider, setProvider] = useState('claude');
  const [branchMode, setBranchMode] = useState<WorkspaceStartOptions['branchMode']>('current');
  const [branchName, setBranchName] = useState('');
  const [worktreeMode, setWorktreeMode] = useState<WorkspaceStartOptions['worktreeMode']>('main');
  const [worktreePath, setWorktreePath] = useState('');
  const trimmedGoal = goal.trim();
  const trimmedBranch = branchName.trim();
  const needsBranchName = branchMode === 'existing' || branchMode === 'create' || worktreeMode === 'isolated';
  const canSubmit = !!trimmedGoal && (!needsBranchName || !!trimmedBranch);

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!canSubmit || disabled) return;
    onStart(trimmedGoal, {
      provider,
      branchMode,
      branchName: trimmedBranch || undefined,
      worktreeMode,
      worktreePath: worktreeMode === 'existing' ? worktreePath || existingWorktrees[0] : undefined,
    });
    setGoal('');
  };

  const branchChoices = [
    ...(branches?.local ?? []),
    ...(branches?.remote ?? []).map((branch) => branch.replace(/^[^/]+\//, '')),
  ].filter((branch, index, all) => branch && all.indexOf(branch) === index);

  const currentLabel = branches?.current || defaultBranch || 'current';

  return (
    <section className="border-b bg-muted/20 px-6 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          <span>Start work in {workspaceName}</span>
          <span className="text-xs">· {currentLabel}</span>
        </div>
        <form onSubmit={handleSubmit} className="rounded-md border bg-background p-2 shadow-sm">
          <Textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="What should we build or change?"
            className="min-h-28 resize-none border-0 px-2 py-2 shadow-none focus-visible:ring-0"
          />
          <div className="mt-2 flex flex-col gap-2 border-t pt-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap gap-2">
              <SegmentedControl
                value={provider}
                options={providerOptions}
                onChange={setProvider}
              />
              <SegmentedControl
                icon={<GitBranch className="h-3.5 w-3.5" />}
                value={branchMode}
                options={branchModeOptions}
                onChange={(value) => {
                  setBranchMode(value);
                  if (worktreeMode === 'isolated' && value === 'current') setBranchMode('create');
                }}
              />
              <SegmentedControl
                icon={<GitFork className="h-3.5 w-3.5" />}
                value={worktreeMode}
                options={worktreeModeOptions}
                onChange={(value) => {
                  if (value === 'existing' && existingWorktrees.length === 0) return;
                  setWorktreeMode(value);
                  if (value === 'isolated' && branchMode === 'current') setBranchMode('create');
                  if (value === 'existing' && !worktreePath) setWorktreePath(existingWorktrees[0] ?? '');
                }}
              />
            </div>
            <Button type="submit" size="sm" disabled={!canSubmit || disabled}>
              <SendHorizontal className="h-4 w-4" />
              Start task
            </Button>
          </div>
          {(branchMode !== 'current' || worktreeMode === 'existing') && (
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {branchMode !== 'current' && (
                <Input
                  value={branchName}
                  onChange={(event) => setBranchName(event.target.value)}
                  placeholder={branchMode === 'create' ? 'feature/new-work' : 'branch name'}
                  list="workspace-start-branches"
                  className="h-8 font-mono text-xs"
                />
              )}
              {worktreeMode === 'existing' && (
                <Input
                  value={worktreePath}
                  onChange={(event) => setWorktreePath(event.target.value)}
                  placeholder="worktree path"
                  list="workspace-start-worktrees"
                  className="h-8 font-mono text-xs"
                />
              )}
              <datalist id="workspace-start-branches">
                {branchChoices.map((branch) => <option key={branch} value={branch} />)}
              </datalist>
              <datalist id="workspace-start-worktrees">
                {existingWorktrees.map((path) => <option key={path} value={path} />)}
              </datalist>
            </div>
          )}
        </form>
      </div>
    </section>
  );
}

function SegmentedControl<T extends string>({
  icon,
  value,
  options,
  onChange,
}: {
  icon?: React.ReactNode;
  value: T;
  options: readonly { name: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div className="flex items-center gap-1 rounded border bg-muted/20 p-0.5">
      {icon && <span className="px-1 text-muted-foreground">{icon}</span>}
      {options.map((option) => (
        <button
          key={option.name}
          type="button"
          className={cn(
            'rounded px-2 py-1 text-xs font-medium transition-colors',
            value === option.name
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-foreground',
          )}
          onClick={() => onChange(option.name)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
