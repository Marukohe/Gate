import { CheckCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { usePlanModeStore } from '@/stores/plan-mode-store';
import { usePlanStore } from '@/stores/plan-store';
import { useUIStore } from '@/stores/ui-store';
import { parseMarkdownChecklist } from '@/lib/plan-parser';
import { CodeBlock } from '@/components/chat/CodeBlock';
import { Button } from '@/components/ui/button';
import { stripLineNumbers, uniqueId } from '@/lib/utils';

export function PlanModeDone() {
  const finalPlanContent = usePlanModeStore((s) => s.finalPlanContent);
  const sessionId = usePlanModeStore((s) => s.sessionId);
  const dismiss = usePlanModeStore((s) => s.dismiss);
  const addPlan = usePlanStore((s) => s.addPlan);
  const setActivePlan = usePlanStore((s) => s.setActivePlan);
  const setPlanPanelOpen = useUIStore((s) => s.setPlanPanelOpen);

  const handleDismiss = () => {
    // Extract plan into plan store if there's checklist content
    if (finalPlanContent && sessionId) {
      const { title, steps } = parseMarkdownChecklist(finalPlanContent);
      if (steps.length > 0) {
        const planId = uniqueId();
        addPlan(sessionId, {
          id: planId,
          sessionId,
          title,
          content: finalPlanContent,
          steps,
          status: 'active',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        });
        setActivePlan(planId);
        setPlanPanelOpen(true);
      }
    }
    dismiss();
  };

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto px-4 pt-12">
      <CheckCircle className="h-10 w-10 text-green-500 mb-3" />
      <h2 className="text-lg font-semibold mb-6">Plan Complete</h2>

      {finalPlanContent && (
        <div className="w-full max-w-3xl flex-1 overflow-y-auto rounded-lg border bg-card p-6">
          <div className="markdown-prose">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                code({ className, children, ...props }) {
                  const match = /language-(\w+)/.exec(className || '');
                  const code = String(children).replace(/\n$/, '');
                  if (match) {
                    return <CodeBlock code={code} language={match[1]} />;
                  }
                  return <code className="rounded bg-muted px-1 py-0.5 text-xs" {...props}>{children}</code>;
                },
              }}
            >
              {stripLineNumbers(finalPlanContent)}
            </ReactMarkdown>
          </div>
        </div>
      )}

      <div className="mt-6 pb-8">
        <Button onClick={handleDismiss} size="lg" variant="outline">
          Close
        </Button>
      </div>
    </div>
  );
}
