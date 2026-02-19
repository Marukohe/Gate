import { CheckCircle } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { usePlanModeStore } from '@/stores/plan-mode-store';
import { CodeBlock } from '@/components/chat/CodeBlock';
import { Button } from '@/components/ui/button';

export function PlanModeDone() {
  const finalPlanContent = usePlanModeStore((s) => s.finalPlanContent);
  const dismiss = usePlanModeStore((s) => s.dismiss);

  return (
    <div className="flex h-full flex-col items-center overflow-y-auto px-4 pt-12">
      <CheckCircle className="h-10 w-10 text-green-500 mb-3" />
      <h2 className="text-lg font-semibold mb-6">Plan Complete</h2>

      {finalPlanContent && (
        <div className="w-full max-w-3xl flex-1 overflow-y-auto rounded-lg border bg-card p-6 text-sm">
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
            {finalPlanContent}
          </ReactMarkdown>
        </div>
      )}

      <div className="mt-6 pb-8">
        <Button onClick={dismiss} size="lg" variant="outline">
          Close
        </Button>
      </div>
    </div>
  );
}
