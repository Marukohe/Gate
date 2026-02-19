import { useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { useChatStore, type ChatMessage } from '@/stores/chat-store';
import { useServerStore } from '@/stores/server-store';

const EMPTY_MESSAGES: ChatMessage[] = [];

interface ChatViewProps {
  onSend: (text: string) => void;
  onExtractPlan?: (content: string) => void;
}

export function ChatView({ onSend, onExtractPlan }: ChatViewProps) {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const isConnected = useServerStore((s) => s.activeServerId ? s.connectionStatus[s.activeServerId] === 'connected' : false);
  const connectionStatus = useServerStore((s) => s.activeServerId ? s.connectionStatus[s.activeServerId] : undefined);
  const connectionError = useServerStore((s) => s.activeServerId ? s.connectionError[s.activeServerId] : undefined);
  const messages = useChatStore((s) => activeServerId ? (s.messages[activeServerId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  if (!activeServerId) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Select a server to start
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {connectionStatus === 'error' && connectionError && (
        <div className="flex items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>Connection failed: {connectionError}</span>
        </div>
      )}
      {connectionStatus === 'connecting' && (
        <div className="border-b bg-muted px-4 py-2 text-center text-xs text-muted-foreground">
          Connecting...
        </div>
      )}
      <ScrollArea className="flex-1 px-4">
        <div className="mx-auto max-w-3xl py-4">
          {messages.length === 0 && isConnected && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Waiting for Claude...
            </div>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} onExtractPlan={onExtractPlan} />
          ))}
          <div ref={bottomRef} />
        </div>
      </ScrollArea>
      <ChatInput onSend={onSend} disabled={!isConnected} />
    </div>
  );
}
