import { useEffect, useRef } from 'react';
import { AlertCircle } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { SessionBar } from './SessionBar';
import { useChatStore, type ChatMessage } from '@/stores/chat-store';
import { useServerStore } from '@/stores/server-store';
import { useSessionStore } from '@/stores/session-store';

const EMPTY_MESSAGES: ChatMessage[] = [];

interface ChatViewProps {
  onSend: (text: string) => void;
  onCreateSession: (name: string, workingDir: string | null) => void;
  onDeleteSession: (sessionId: string) => void;
  onSelectSession: (sessionId: string) => void;
}

export function ChatView({ onSend, onCreateSession, onDeleteSession, onSelectSession }: ChatViewProps) {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeSessionId = useSessionStore((s) => activeServerId ? s.activeSessionId[activeServerId] : undefined);
  const connectionStatus = useSessionStore((s) => activeSessionId ? s.connectionStatus[activeSessionId] : undefined);
  const connectionError = useSessionStore((s) => activeSessionId ? s.connectionError[activeSessionId] : undefined);
  const isConnected = connectionStatus === 'connected';
  const messages = useChatStore((s) => activeSessionId ? (s.messages[activeSessionId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES);
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
      <SessionBar
        serverId={activeServerId}
        onCreateSession={onCreateSession}
        onDeleteSession={onDeleteSession}
        onSelectSession={onSelectSession}
      />
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
      <div className="flex-1 overflow-y-auto px-4">
        <div className="mx-auto max-w-3xl py-4">
          {messages.length === 0 && isConnected && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Waiting for Claude...
            </div>
          )}
          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}
          <div ref={bottomRef} />
        </div>
      </div>
      <ChatInput onSend={onSend} disabled={!isConnected} />
    </div>
  );
}
