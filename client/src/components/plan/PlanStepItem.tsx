import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { PlanStep } from '@/stores/plan-store';

interface PlanStepItemProps {
  step: PlanStep;
  onToggle: (stepId: string) => void;
}

export function PlanStepItem({ step, onToggle }: PlanStepItemProps) {
  return (
    <div>
      <div className="flex items-start gap-2 py-1">
        <Checkbox
          checked={step.completed}
          onCheckedChange={() => onToggle(step.id)}
          className="mt-0.5"
        />
        <span className={cn('text-sm', step.completed && 'text-muted-foreground line-through')}>
          {step.text}
        </span>
      </div>
      {step.children && step.children.length > 0 && (
        <div className="ml-6">
          {step.children.map((child) => (
            <PlanStepItem key={child.id} step={child} onToggle={onToggle} />
          ))}
        </div>
      )}
    </div>
  );
}
