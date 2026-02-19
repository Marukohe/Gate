import { X } from 'lucide-react';
import { usePlanModeStore } from '@/stores/plan-mode-store';
import { Button } from '@/components/ui/button';

export function PlanModeThinking() {
  const toolCallCount = usePlanModeStore((s) => s.toolCallCount);
  const lastToolName = usePlanModeStore((s) => s.lastToolName);
  const progressMessages = usePlanModeStore((s) => s.progressMessages);
  const dismiss = usePlanModeStore((s) => s.dismiss);

  return (
    <div className="relative flex h-full flex-col items-center px-4 pt-24">
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-4 top-4"
        onClick={dismiss}
      >
        <X className="h-5 w-5" />
      </Button>

      {/* Pulsing indicator */}
      <div className="relative mb-6">
        <div className="h-12 w-12 rounded-full bg-primary/20 animate-pulse" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="h-6 w-6 rounded-full bg-primary animate-ping opacity-75" />
        </div>
      </div>

      <h2 className="text-lg font-semibold mb-1">Claude is planning...</h2>
      <p className="text-sm text-muted-foreground mb-6">
        {toolCallCount} tool call{toolCallCount !== 1 ? 's' : ''}
        {lastToolName ? ` — ${lastToolName}` : ''}
      </p>

      {/* Progress messages scroll area */}
      {progressMessages.length > 0 && (
        <div className="w-full max-w-2xl flex-1 overflow-y-auto rounded-lg border bg-muted/50 p-4">
          <div className="space-y-3">
            {progressMessages.map((msg, i) => (
              <p key={i} className="text-sm text-muted-foreground leading-relaxed">
                {msg.length > 300 ? msg.slice(0, 300) + '...' : msg}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
