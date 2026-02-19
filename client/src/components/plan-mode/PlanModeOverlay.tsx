import { usePlanModeStore } from '@/stores/plan-mode-store';
import { PlanModeThinking } from './PlanModeThinking';
import { PlanModeQuestion } from './PlanModeQuestion';
import { PlanModeDone } from './PlanModeDone';

interface PlanModeOverlayProps {
  onSendInput: (text: string) => void;
}

export function PlanModeOverlay({ onSendInput }: PlanModeOverlayProps) {
  const phase = usePlanModeStore((s) => s.phase);

  if (phase === 'idle') return null;

  return (
    <div className="fixed inset-0 z-50 bg-background/95 backdrop-blur-sm">
      {phase === 'active' && <PlanModeThinking />}
      {phase === 'question' && <PlanModeQuestion onSendInput={onSendInput} />}
      {phase === 'done' && <PlanModeDone />}
    </div>
  );
}
