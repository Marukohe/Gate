import { useState } from 'react';
import { SendHorizontal, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';

interface WorkspaceStartProps {
  workspaceName: string;
  defaultBranch: string | null;
  disabled?: boolean;
  onStart: (goal: string, provider: string) => void;
}

const providerOptions = [
  { name: 'claude', label: 'Claude' },
  { name: 'codex', label: 'Codex' },
];

export function WorkspaceStart({ workspaceName, defaultBranch, disabled, onStart }: WorkspaceStartProps) {
  const [goal, setGoal] = useState('');
  const [provider, setProvider] = useState('claude');
  const trimmedGoal = goal.trim();

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault();
    if (!trimmedGoal || disabled) return;
    onStart(trimmedGoal, provider);
    setGoal('');
  };

  return (
    <section className="border-b bg-muted/20 px-6 py-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-3">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <Sparkles className="h-4 w-4" />
          <span>Start work in {workspaceName}</span>
          {defaultBranch && <span className="text-xs">· {defaultBranch}</span>}
        </div>
        <form onSubmit={handleSubmit} className="rounded-md border bg-background p-2 shadow-sm">
          <Textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder="What should we build or change?"
            className="min-h-28 resize-none border-0 px-2 py-2 shadow-none focus-visible:ring-0"
          />
          <div className="mt-2 flex flex-col gap-2 border-t pt-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex gap-1">
              {providerOptions.map((option) => (
                <button
                  key={option.name}
                  type="button"
                  className={cn(
                    'rounded px-2.5 py-1 text-xs font-medium transition-colors',
                    provider === option.name
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                  )}
                  onClick={() => setProvider(option.name)}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <Button type="submit" size="sm" disabled={!trimmedGoal || disabled}>
              <SendHorizontal className="h-4 w-4" />
              Start task
            </Button>
          </div>
        </form>
      </div>
    </section>
  );
}
