import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { CodeBlock } from './CodeBlock';
import { ToolCallCard } from './ToolCallCard';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ChatMessage } from '@/stores/chat-store';

interface MessageBubbleProps {
  message: ChatMessage;
  onExtractPlan?: (content: string) => void;
}

export function MessageBubble({ message, onExtractPlan }: MessageBubbleProps) {
  if (message.type === 'tool_call' || message.type === 'tool_result') {
    return <ToolCallCard message={message} />;
  }

  if (message.type === 'system') {
    return (
      <div className="my-2 text-center text-xs text-muted-foreground">{message.content}</div>
    );
  }

  const isUser = message.type === 'user';

  return (
    <div className={cn('my-2 flex', isUser ? 'justify-end' : 'justify-start')}>
      <div className={cn(
        'max-w-[85%] rounded-lg px-4 py-2 text-sm',
        isUser
          ? 'bg-primary text-primary-foreground'
          : 'bg-muted'
      )}>
        {isUser ? (
          <p>{message.content}</p>
        ) : (
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              code({ className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '');
                const code = String(children).replace(/\n$/, '');
                if (match) {
                  return <CodeBlock code={code} language={match[1]} />;
                }
                return <code className="rounded bg-background/50 px-1 py-0.5 text-xs" {...props}>{children}</code>;
              },
            }}
          >
            {message.content}
          </ReactMarkdown>
        )}
        {!isUser && message.content.includes('- [ ]') && onExtractPlan && (
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => onExtractPlan(message.content)}
          >
            Extract to Plan Panel
          </Button>
        )}
      </div>
    </div>
  );
}
