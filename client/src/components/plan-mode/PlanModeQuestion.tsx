import { X } from 'lucide-react';
import { usePlanModeStore } from '@/stores/plan-mode-store';
import { Checkbox } from '@/components/ui/checkbox';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface PlanModeQuestionProps {
  onSendInput: (text: string) => void;
}

export function PlanModeQuestion({ onSendInput }: PlanModeQuestionProps) {
  const questions = usePlanModeStore((s) => s.currentQuestions);
  const selectedAnswers = usePlanModeStore((s) => s.selectedAnswers);
  const selectAnswer = usePlanModeStore((s) => s.selectAnswer);
  const deselectAnswer = usePlanModeStore((s) => s.deselectAnswer);
  const submitAnswers = usePlanModeStore((s) => s.submitAnswers);
  const dismiss = usePlanModeStore((s) => s.dismiss);

  const handleSubmit = () => {
    const answer = submitAnswers();
    onSendInput(answer);
  };

  const hasAnySelection = Object.values(selectedAnswers).some((arr) => arr.length > 0);

  return (
    <div className="relative flex h-full flex-col items-center overflow-y-auto px-4 pt-16">
      <Button
        variant="ghost"
        size="icon"
        className="absolute right-4 top-4"
        onClick={dismiss}
      >
        <X className="h-5 w-5" />
      </Button>

      <h2 className="text-lg font-semibold mb-6">Claude has a question</h2>

      <div className="w-full max-w-2xl space-y-6">
        {questions.map((q, qi) => {
          const selected = selectedAnswers[qi] ?? [];
          return (
            <div key={qi} className="rounded-lg border bg-card p-4">
              <p className="text-sm font-medium mb-3">{q.question}</p>
              <div className="space-y-2">
                {q.options.map((opt) => {
                  const isSelected = selected.includes(opt.label);

                  if (q.multiSelect) {
                    return (
                      <label
                        key={opt.label}
                        className={cn(
                          'flex items-start gap-3 rounded-md border p-3 cursor-pointer transition-colors',
                          isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                        )}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={(checked) => {
                            if (checked) selectAnswer(qi, opt.label);
                            else deselectAnswer(qi, opt.label);
                          }}
                          className="mt-0.5"
                        />
                        <div>
                          <div className="text-sm font-medium">{opt.label}</div>
                          {opt.description && (
                            <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
                          )}
                        </div>
                      </label>
                    );
                  }

                  // Single select — styled button card with radio indicator
                  return (
                    <button
                      key={opt.label}
                      type="button"
                      onClick={() => selectAnswer(qi, opt.label)}
                      className={cn(
                        'flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors',
                        isSelected ? 'border-primary bg-primary/5' : 'hover:bg-muted/50'
                      )}
                    >
                      <div className={cn(
                        'mt-0.5 h-4 w-4 shrink-0 rounded-full border-2 transition-colors',
                        isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                      )}>
                        {isSelected && (
                          <div className="flex h-full w-full items-center justify-center">
                            <div className="h-1.5 w-1.5 rounded-full bg-primary-foreground" />
                          </div>
                        )}
                      </div>
                      <div>
                        <div className="text-sm font-medium">{opt.label}</div>
                        {opt.description && (
                          <div className="text-xs text-muted-foreground mt-0.5">{opt.description}</div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-6 pb-8">
        <Button onClick={handleSubmit} disabled={!hasAnySelection} size="lg">
          Continue
        </Button>
      </div>
    </div>
  );
}
