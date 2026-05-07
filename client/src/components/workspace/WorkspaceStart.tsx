import { useState } from 'react';
import { ChevronDown, GitBranch, GitFork, SendHorizontal } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
  currentWorktree: string;
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
  { name: 'current', label: 'Current branch' },
  { name: 'existing', label: 'Switch branch' },
  { name: 'create', label: 'New branch' },
] as const;

const worktreeModeOptions = [
  { name: 'main', label: 'Current worktree' },
  { name: 'isolated', label: 'New worktree' },
  { name: 'existing', label: 'Existing worktree' },
] as const;

export function WorkspaceStart({
  workspaceName,
  defaultBranch,
  currentWorktree,
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
  const [optionsOpen, setOptionsOpen] = useState(false);
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
  const providerLabel = providerOptions.find((option) => option.name === provider)?.label ?? provider;
  const branchLabel = branchMode === 'current'
    ? currentLabel
    : trimmedBranch || branchModeOptions.find((option) => option.name === branchMode)?.label || branchMode;
  const worktreeLabel = worktreeMode === 'main'
    ? compactPath(currentWorktree)
    : worktreeMode === 'existing'
      ? compactPath(worktreePath || existingWorktrees[0] || 'existing worktree')
      : 'new worktree';

  return (
    <section className="border-b px-6 py-6">
      <div className="mx-auto max-w-3xl">
        <form onSubmit={handleSubmit} className="rounded-md border bg-background p-3 shadow-sm">
          <div className="mb-2 text-sm font-medium text-muted-foreground">
            Start work in {workspaceName}
          </div>
          <Textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="What should we build or change?"
            className="min-h-28 resize-none border-0 px-0 py-1 shadow-none focus-visible:ring-0"
          />
          <div className="mt-2 flex flex-col gap-2 border-t pt-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
              <span>{providerLabel}</span>
              <span>·</span>
              <span>{branchLabel}</span>
              <span>·</span>
              <span className="truncate">{worktreeLabel}</span>
            </div>
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-8 px-2 text-xs"
                onClick={() => setOptionsOpen((open) => !open)}
              >
                Options
                <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', optionsOpen && 'rotate-180')} />
              </Button>
              <Button type="submit" size="sm" disabled={!canSubmit || disabled}>
                <SendHorizontal className="h-4 w-4" />
                Start
              </Button>
            </div>
          </div>

          {optionsOpen && (
            <div className="mt-3 border-t pt-3">
              <div className="flex flex-wrap gap-2">
                <FieldControl label="Agent">
                  <SegmentedControl
                    value={provider}
                    options={providerOptions}
                    onChange={setProvider}
                  />
                </FieldControl>
                <FieldControl label="Branch">
                  <SegmentedControl
                    icon={<GitBranch className="h-3.5 w-3.5" />}
                    value={branchMode}
                    options={branchModeOptions}
                    onChange={(value) => {
                      setBranchMode(value);
                      if (worktreeMode === 'isolated' && value === 'current') setBranchMode('create');
                    }}
                  />
                </FieldControl>
                <FieldControl label="Worktree">
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
                </FieldControl>
              </div>
              {(branchMode !== 'current' || worktreeMode === 'existing') && (
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {branchMode === 'existing' && branchChoices.length > 0 ? (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          className="h-8 min-w-0 justify-between px-2 text-xs font-normal"
                        >
                          <span className="truncate">{branchName || 'Select branch'}</span>
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="start" className="max-h-72 w-64 overflow-y-auto">
                        {branchChoices.map((branch) => (
                          <DropdownMenuItem key={branch} onClick={() => setBranchName(branch)}>
                            <span className="truncate">{branch}</span>
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  ) : branchMode !== 'current' && (
                    <Input
                      value={branchName}
                      onChange={(event) => setBranchName(event.target.value)}
                      placeholder={branchMode === 'create' ? 'feature/new-work' : 'branch name'}
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
                  <datalist id="workspace-start-worktrees">
                    {existingWorktrees.map((path) => <option key={path} value={path} />)}
                  </datalist>
                </div>
              )}
              <p className="mt-2 px-1 text-[11px] text-muted-foreground">
                Branch changes apply inside the selected worktree. A new worktree needs a branch name.
              </p>
            </div>
          )}
        </form>
      </div>
    </section>
  );
}

function compactPath(path: string): string {
  const parts = path.split('/').filter(Boolean);
  return parts.length > 2 ? parts.slice(-2).join('/') : path;
}

function FieldControl({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="px-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">{label}</span>
      {children}
    </label>
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
