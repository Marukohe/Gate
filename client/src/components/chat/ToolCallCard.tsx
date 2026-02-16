import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Badge } from '@/components/ui/badge';
import { ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/stores/chat-store';

interface ToolCallCardProps {
  message: ChatMessage;
}

export function ToolCallCard({ message }: ToolCallCardProps) {
  const [open, setOpen] = useState(false);

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-2 rounded-md border bg-muted/30">
      <CollapsibleTrigger className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm">
        <ChevronRight className={cn('h-4 w-4 transition-transform', open && 'rotate-90')} />
        <Badge variant="outline" className="font-mono text-xs">{message.toolName}</Badge>
        <span className="truncate text-muted-foreground">{message.toolDetail || message.content.slice(0, 80)}</span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-t px-3 py-2">
        <pre className="whitespace-pre-wrap text-xs">{message.content}</pre>
      </CollapsibleContent>
    </Collapsible>
  );
}
