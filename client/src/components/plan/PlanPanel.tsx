import { useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { PlanStepItem } from './PlanStepItem';
import { usePlanStore, type Plan } from '@/stores/plan-store';
import { useServerStore } from '@/stores/server-store';
import { useSessionStore } from '@/stores/session-store';
import { parseMarkdownChecklist, stepsToMarkdown } from '@/lib/plan-parser';

const EMPTY_PLANS: Plan[] = [];

interface PlanPanelProps {
  onSendToChat: (text: string) => void;
}

export function PlanPanel({ onSendToChat }: PlanPanelProps) {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeSessionId = useSessionStore((s) => activeServerId ? s.activeSessionId[activeServerId] : undefined);
  const plans = usePlanStore((s) => activeSessionId ? (s.plans[activeSessionId] ?? EMPTY_PLANS) : EMPTY_PLANS);
  const activePlanId = usePlanStore((s) => s.activePlanId);
  const toggleStep = usePlanStore((s) => s.toggleStep);
  const updatePlan = usePlanStore((s) => s.updatePlan);

  const activePlan = plans.find((p) => p.id === activePlanId);
  const [editContent, setEditContent] = useState('');
  const [tab, setTab] = useState('view');

  const handleEditStart = () => {
    if (activePlan) {
      setEditContent(stepsToMarkdown(activePlan.title, activePlan.steps));
    }
    setTab('edit');
  };

  const handleSave = () => {
    if (!activePlan || !activeSessionId) return;
    const { title, steps } = parseMarkdownChecklist(editContent);
    updatePlan(activeSessionId, activePlan.id, { title, steps, content: editContent });
    setTab('view');
  };

  const handleSendToClaudeForExecution = () => {
    if (!activePlan) return;
    const md = stepsToMarkdown(activePlan.title, activePlan.steps);
    onSendToChat(`Please execute this plan:\n\n${md}`);
  };

  if (!activePlan) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-muted-foreground">
        <p className="text-sm">No active plan</p>
        <p className="text-xs">Extract a plan from chat to get started</p>
      </div>
    );
  }

  const completedCount = activePlan.steps.filter((s) => s.completed).length;
  const totalCount = activePlan.steps.length;

  return (
    <div className="flex h-full flex-col">
      <div className="border-b p-4">
        <h3 className="font-semibold">{activePlan.title}</h3>
        <p className="text-xs text-muted-foreground">{completedCount}/{totalCount} steps completed</p>
      </div>
      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col">
        <TabsList className="mx-4 mt-2">
          <TabsTrigger value="view" className="flex-1">View</TabsTrigger>
          <TabsTrigger value="edit" className="flex-1" onClick={handleEditStart}>Edit</TabsTrigger>
        </TabsList>
        <TabsContent value="view" className="flex-1 overflow-hidden">
          <ScrollArea className="h-full px-4 pb-4">
            {activePlan.steps.map((step) => (
              <PlanStepItem
                key={step.id}
                step={step}
                onToggle={(stepId) => activeSessionId && toggleStep(activeSessionId, activePlan.id, stepId)}
              />
            ))}
          </ScrollArea>
        </TabsContent>
        <TabsContent value="edit" className="flex flex-1 flex-col gap-2 p-4">
          <Textarea
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="flex-1 resize-none font-mono text-xs"
          />
          <Button size="sm" onClick={handleSave}>Save</Button>
        </TabsContent>
      </Tabs>
      <div className="border-t p-4">
        <Button size="sm" variant="outline" className="w-full" onClick={handleSendToClaudeForExecution}>
          Send to Claude for execution
        </Button>
      </div>
    </div>
  );
}
