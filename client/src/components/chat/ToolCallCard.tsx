import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/stores/chat-store';
import { stripLineNumbers } from '@/lib/utils';

interface ToolCallCardProps {
  message: ChatMessage;
}

export function ToolCallCard({ message }: ToolCallCardProps) {
  const isBashResult = message.type === 'tool_result' && message.toolName === 'bash';
  const [open, setOpen] = useState(isBashResult);
  const content = stripLineNumbers(message.content);
  const isDiff = /^diff --git /m.test(content);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-2 rounded-md border bg-muted/30">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
        <ChevronRight className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} />
        <Badge variant="outline" className="font-mono text-xs">{message.toolName}</Badge>
        <span className="truncate text-muted-foreground">{message.toolDetail || message.content.slice(0, 80)}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3 py-2">
        {isDiff ? (
          <pre className="whitespace-pre-wrap break-all text-xs">
            {content.split('\n').map((line, i) => {
              let cls = '';
              if (line.startsWith('+')) cls = 'text-green-600 dark:text-green-400';
              else if (line.startsWith('-')) cls = 'text-red-600 dark:text-red-400';
              else if (line.startsWith('@@')) cls = 'text-cyan-600 dark:text-cyan-400';
              return <div key={i} className={cls}>{line}</div>;
            })}
          </pre>
        ) : (
          <pre className="whitespace-pre-wrap break-all text-xs">{content}</pre>
        )}
      </CollapsibleContent>
    </Collapsible>
  );
}
