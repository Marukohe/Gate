import { useState, useEffect, useMemo } from 'react';
import { GitBranch, Check, Loader2, Globe } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ScrollArea } from '@/components/ui/scroll-area';
import { useSessionStore, type BranchList } from '@/stores/session-store';
import { cn } from '@/lib/utils';

interface BranchSwitcherProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  serverId: string;
  onListBranches: (serverId: string, sessionId: string) => void;
  onSwitchBranch: (serverId: string, sessionId: string, branch: string) => void;
}

export function BranchSwitcher({ open, onOpenChange, sessionId, serverId, onListBranches, onSwitchBranch }: BranchSwitcherProps) {
  const branchData = useSessionStore((s) => s.branches[sessionId]) as BranchList | undefined;
  const gitInfo = useSessionStore((s) => s.gitInfo[sessionId]);
  const [filter, setFilter] = useState('');
  const [switching, setSwitching] = useState<string | null>(null);

  const currentBranch = gitInfo?.branch ?? branchData?.current ?? '';

  useEffect(() => {
    if (open) {
      setFilter('');
      setSwitching(null);
      onListBranches(serverId, sessionId);
    }
  }, [open, serverId, sessionId, onListBranches]);

  // When gitInfo updates (after switch), clear switching state and close
  useEffect(() => {
    if (switching && gitInfo?.branch === switching) {
      setSwitching(null);
      onOpenChange(false);
    }
  }, [gitInfo?.branch, switching, onOpenChange]);

  const filteredLocal = useMemo(() => {
    if (!branchData) return [];
    const q = filter.toLowerCase();
    return branchData.local.filter((b) => b.toLowerCase().includes(q));
  }, [branchData, filter]);

  const filteredRemote = useMemo(() => {
    if (!branchData) return [];
    const q = filter.toLowerCase();
    return branchData.remote.filter((b) => b.toLowerCase().includes(q));
  }, [branchData, filter]);

  const handleSwitch = (branch: string) => {
    if (branch === currentBranch) return;
    setSwitching(branch);
    onSwitchBranch(serverId, sessionId, branch);
  };

  const loading = !branchData;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="h-4 w-4" />
            Switch Branch
          </DialogTitle>
        </DialogHeader>

        <Input
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter branches..."
          autoFocus
        />

        <ScrollArea className="h-64">
          {loading ? (
            <div className="flex items-center justify-center p-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="flex flex-col gap-3 p-1">
              {filteredLocal.length > 0 && (
                <BranchGroup
                  label="Local"
                  branches={filteredLocal}
                  current={currentBranch}
                  switching={switching}
                  onSwitch={handleSwitch}
                />
              )}
              {filteredRemote.length > 0 && (
                <BranchGroup
                  label="Remote"
                  icon={<Globe className="h-3 w-3" />}
                  branches={filteredRemote}
                  current={currentBranch}
                  switching={switching}
                  onSwitch={(b) => {
                    // Strip "origin/" prefix for checkout
                    const local = b.replace(/^[^/]+\//, '');
                    handleSwitch(local);
                  }}
                />
              )}
              {filteredLocal.length === 0 && filteredRemote.length === 0 && (
                <div className="py-4 text-center text-xs text-muted-foreground">
                  No matching branches
                </div>
              )}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}

function BranchGroup({ label, icon, branches, current, switching, onSwitch }: {
  label: string;
  icon?: React.ReactNode;
  branches: string[];
  current: string;
  switching: string | null;
  onSwitch: (branch: string) => void;
}) {
  return (
    <div>
      <div className="flex items-center gap-1.5 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {icon}
        {label}
      </div>
      {branches.map((branch) => {
        const isCurrent = branch === current || branch.endsWith(`/${current}`);
        const isSwitching = switching === branch || switching === branch.replace(/^[^/]+\//, '');
        return (
          <button
            key={branch}
            className={cn(
              'flex w-full items-center gap-2 rounded px-2 py-1.5 text-sm font-mono',
              isCurrent ? 'bg-primary/10 text-primary' : 'hover:bg-muted',
              isSwitching && 'opacity-60',
            )}
            onClick={() => onSwitch(branch)}
            disabled={isCurrent || !!switching}
          >
            {isSwitching ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
            ) : isCurrent ? (
              <Check className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <span className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">{branch}</span>
          </button>
        );
      })}
    </div>
  );
}
