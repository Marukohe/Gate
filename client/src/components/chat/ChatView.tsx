import { useEffect, useMemo, useRef, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { SessionBar } from './SessionBar';
import { ToolActivityBlock } from './ToolActivityBlock';
import { groupMessages } from './group-tools';
import { useChatStore, type ChatMessage } from '@/stores/chat-store';
import { useServerStore } from '@/stores/server-store';
import { useSessionStore } from '@/stores/session-store';
import { useSwipe } from '@/hooks/use-swipe';

const EMPTY_MESSAGES: ChatMessage[] = [];

interface ChatViewProps {
  onSend: (text: string) => void;
  onCreateSession: (name: string, workingDir: string | null) => void;
  onDeleteSession: (sessionId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onListBranches: (serverId: string, sessionId: string) => void;
  onSwitchBranch: (serverId: string, sessionId: string, branch: string) => void;
}

export function ChatView({ onSend, onCreateSession, onDeleteSession, onSelectSession, onListBranches, onSwitchBranch }: ChatViewProps) {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeSessionId = useSessionStore((s) => activeServerId ? s.activeSessionId[activeServerId] : undefined);
  const sessions = useSessionStore((s) => activeServerId ? s.sessions[activeServerId] : undefined);
  const connectionStatus = useSessionStore((s) => activeSessionId ? s.connectionStatus[activeSessionId] : undefined);
  const connectionError = useSessionStore((s) => activeSessionId ? s.connectionError[activeSessionId] : undefined);
  const isConnected = connectionStatus === 'connected';
  const messages = useChatStore((s) => activeSessionId ? (s.messages[activeSessionId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES);
  const renderItems = useMemo(() => groupMessages(messages), [messages]);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Swipe left/right to switch sessions
  const switchSession = useCallback((dir: -1 | 1) => {
    if (!sessions || sessions.length < 2 || !activeSessionId) return;
    const idx = sessions.findIndex((s) => s.id === activeSessionId);
    const next = idx + dir;
    if (next >= 0 && next < sessions.length) {
      onSelectSession(sessions[next].id);
    }
  }, [sessions, activeSessionId, onSelectSession]);

  const swipe = useSwipe(
    useCallback(() => switchSession(1), [switchSession]),   // swipe left → next
    useCallback(() => switchSession(-1), [switchSession]),  // swipe right → prev
  );

  // Scroll instant on session switch, smooth on new messages within the same session
  const prevSessionRef = useRef(activeSessionId);
  useEffect(() => {
    const switched = prevSessionRef.current !== activeSessionId;
    prevSessionRef.current = activeSessionId;
    bottomRef.current?.scrollIntoView({ behavior: switched ? 'instant' : 'smooth' });
  }, [messages, activeSessionId]);

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
        onListBranches={onListBranches}
        onSwitchBranch={onSwitchBranch}
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
      <div className="flex-1 overflow-y-auto px-4" {...swipe}>
        <div className="mx-auto max-w-3xl py-4">
          {messages.length === 0 && isConnected && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              Waiting for Claude...
            </div>
          )}
          {renderItems.map((item, i) =>
            item.kind === 'single'
              ? <MessageBubble key={item.message.id} message={item.message} />
              : <ToolActivityBlock key={item.items[0]?.call.id ?? i} group={item} />
          )}
          <div ref={bottomRef} />
        </div>
      </div>
      <ChatInput onSend={onSend} disabled={!isConnected} />
    </div>
  );
}
