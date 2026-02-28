import { usePlanModeStore } from '@/stores/plan-mode-store';
import { PlanModeThinking } from './PlanModeThinking';
import { PlanModeQuestion } from './PlanModeQuestion';
import { PlanModeDone } from './PlanModeDone';

interface PlanModeOverlayProps {
  activeSessionId: string | undefined;
  onSendInput: (text: string, serverId: string, sessionId: string) => void;
}

export function PlanModeOverlay({ activeSessionId, onSendInput }: PlanModeOverlayProps) {
  const phase = usePlanModeStore((s) => s.phase);
  const planSessionId = usePlanModeStore((s) => s.sessionId);

  // Only show when this session owns the active plan mode
  if (phase === 'idle' || planSessionId !== activeSessionId) return null;

  return (
    <div className="absolute inset-0 z-40 bg-background/95 backdrop-blur-sm">
      {phase === 'active' && <PlanModeThinking />}
      {phase === 'question' && <PlanModeQuestion onSendInput={onSendInput} />}
      {phase === 'done' && <PlanModeDone />}
    </div>
  );
}
