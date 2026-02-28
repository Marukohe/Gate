import { useEffect, useMemo, useRef, useCallback, useState } from 'react';
import { AlertCircle, RefreshCw, ChevronUp } from 'lucide-react';
import { MessageBubble } from './MessageBubble';
import { ChatInput } from './ChatInput';
import { SessionBar } from './SessionBar';
import { ToolActivityBlock } from './ToolActivityBlock';
import { groupMessages } from './group-tools';
import { useChatStore, type ChatMessage } from '@/stores/chat-store';
import { useServerStore } from '@/stores/server-store';
import { useSessionStore } from '@/stores/session-store';
import { useUIStore } from '@/stores/ui-store';
import { usePlanStore } from '@/stores/plan-store';
import { usePlanModeStore } from '@/stores/plan-mode-store';
import { useSwipe } from '@/hooks/use-swipe';
import { PlanModeOverlay } from '@/components/plan-mode/PlanModeOverlay';

const EMPTY_MESSAGES: ChatMessage[] = [];

interface ChatViewProps {
  onSend: (text: string) => void;
  onCreateSession: (name: string, workingDir: string | null, claudeSessionId?: string | null) => void;
  onDeleteSession: (sessionId: string) => void;
  onSelectSession: (sessionId: string) => void;
  onListBranches: (serverId: string, sessionId: string) => void;
  onSwitchBranch: (serverId: string, sessionId: string, branch: string) => void;
  onSyncTranscript: (sessionId: string) => void;
  onListClaudeSessions?: (serverId: string, workingDir: string) => Promise<string[]>;
  onSendToSession: (text: string, serverId: string, sessionId: string) => void;
  onLoadMore: (beforeTimestamp: number) => void;
}

export function ChatView({ onSend, onCreateSession, onDeleteSession, onSelectSession, onListBranches, onSwitchBranch, onSyncTranscript, onListClaudeSessions, onSendToSession, onLoadMore }: ChatViewProps) {
  const activeServerId = useServerStore((s) => s.activeServerId);
  const activeSessionId = useSessionStore((s) => activeServerId ? s.activeSessionId[activeServerId] : undefined);
  const sessions = useSessionStore((s) => activeServerId ? s.sessions[activeServerId] : undefined);
  const connectionStatus = useSessionStore((s) => activeSessionId ? s.connectionStatus[activeSessionId] : undefined);
  const connectionError = useSessionStore((s) => activeSessionId ? s.connectionError[activeSessionId] : undefined);
  const isConnected = connectionStatus === 'connected';
  const syncStatus = useUIStore((s) => activeSessionId ? s.syncStatus[activeSessionId] : undefined);
  const setSyncStatus = useUIStore((s) => s.setSyncStatus);
  const messages = useChatStore((s) => activeSessionId ? (s.messages[activeSessionId] ?? EMPTY_MESSAGES) : EMPTY_MESSAGES);
  const hasMore = useChatStore((s) => activeSessionId ? (s.hasMore[activeSessionId] ?? false) : false);
  const renderItems = useMemo(() => groupMessages(messages), [messages]);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [loadingMore, setLoadingMore] = useState(false);

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

  // Auto-dismiss sync status after 3 seconds
  useEffect(() => {
    if (!activeSessionId || !syncStatus) return;
    if (syncStatus.state === 'done' || syncStatus.state === 'error') {
      const timer = setTimeout(() => setSyncStatus(activeSessionId, { state: 'idle' }), 3000);
      return () => clearTimeout(timer);
    }
  }, [activeSessionId, syncStatus, setSyncStatus]);

  // Scroll instant on session switch or initial mount, smooth on new messages
  const isInitialRef = useRef(true);
  const prevSessionRef = useRef(activeSessionId);
  useEffect(() => {
    const switched = prevSessionRef.current !== activeSessionId;
    // If messages haven't loaded yet (initial mount or session switch), wait for history
    if ((isInitialRef.current || switched) && messages.length === 0) return;
    prevSessionRef.current = activeSessionId;
    if (isInitialRef.current || switched) {
      isInitialRef.current = false;
      bottomRef.current?.scrollIntoView({ behavior: 'instant' });
      return;
    }
    // Only auto-scroll on new messages if user is near the bottom
    const el = scrollRef.current;
    if (el) {
      const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 150;
      if (nearBottom) bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, activeSessionId]);

  // Preserve scroll position when prepending older messages
  const prevMessageCountRef = useRef(0);
  useEffect(() => {
    if (loadingMore && messages.length > prevMessageCountRef.current) {
      setLoadingMore(false);
    }
    prevMessageCountRef.current = messages.length;
  }, [messages.length, loadingMore]);

  // Restore active plan when switching sessions/servers
  useEffect(() => {
    if (!activeSessionId) return;
    const knownPlanId = usePlanStore.getState().autoExtractedPlanIds[activeSessionId];
    usePlanStore.getState().setActivePlan(knownPlanId ?? null);
  }, [activeSessionId]);

  // Extract plans from messages (TodoWrite tool calls or assistant checklists).
  // Only scan the latest messages — if the session already has a plan and no
  // newer plan-bearing message exists in the current window, keep the existing plan.
  const prevExtractLenRef = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!activeSessionId || messages.length === 0) return;
    const prevLen = prevExtractLenRef.current[activeSessionId] ?? 0;
    prevExtractLenRef.current[activeSessionId] = messages.length;

    const hasExistingPlan = !!usePlanStore.getState().autoExtractedPlanIds[activeSessionId];

    // If plan already exists and no new messages arrived, skip re-extraction.
    // This prevents losing plans when history is reloaded with fewer messages.
    if (hasExistingPlan && messages.length <= prevLen) return;

    const planPhase = usePlanModeStore.getState().phase;
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      if (msg.type === 'tool_call' && msg.toolName === 'TodoWrite') {
        usePlanStore.getState().extractTodoWrite(activeSessionId, msg.content);
        return;
      }
      if (msg.type === 'assistant' && msg.content && planPhase === 'idle') {
        usePlanStore.getState().autoExtractPlan(activeSessionId, msg.content);
        if (usePlanStore.getState().autoExtractedPlanIds[activeSessionId]) return;
      }
    }
  }, [activeSessionId, messages]);

  const handleLoadMore = useCallback(() => {
    if (!messages.length || loadingMore) return;
    const el = scrollRef.current;
    const prevHeight = el?.scrollHeight ?? 0;
    setLoadingMore(true);
    onLoadMore(messages[0].timestamp);
    // Restore scroll position after prepend
    requestAnimationFrame(() => {
      if (el) {
        const newHeight = el.scrollHeight;
        el.scrollTop += newHeight - prevHeight;
      }
    });
  }, [messages, loadingMore, onLoadMore]);

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
        onSyncTranscript={onSyncTranscript}
        onListClaudeSessions={onListClaudeSessions}
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
      {syncStatus?.state === 'syncing' && (
        <div className="flex items-center justify-center gap-2 border-b bg-muted px-4 py-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3 w-3 animate-spin" />
          Syncing transcript...
        </div>
      )}
      {syncStatus?.state === 'done' && (
        <div className="border-b bg-green-500/10 px-4 py-2 text-center text-xs text-green-700 dark:text-green-400">
          Synced {syncStatus.added} new message{syncStatus.added !== 1 ? 's' : ''} from transcript
        </div>
      )}
      {syncStatus?.state === 'error' && (
        <div className="flex items-center gap-2 border-b bg-destructive/10 px-4 py-2 text-xs text-destructive">
          <AlertCircle className="h-3 w-3 shrink-0" />
          Sync failed: {syncStatus.error}
        </div>
      )}
      <div className="relative flex-1 flex flex-col overflow-hidden">
        <PlanModeOverlay activeSessionId={activeSessionId} onSendInput={onSendToSession} />
        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4" {...swipe}>
          <div className="mx-auto max-w-3xl py-4">
            {hasMore && (
              <button
                onClick={handleLoadMore}
                disabled={loadingMore}
                className="mx-auto mb-4 flex items-center gap-1 rounded-full border bg-muted/50 px-4 py-1.5 text-xs text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
              >
                {loadingMore ? (
                  <RefreshCw className="h-3 w-3 animate-spin" />
                ) : (
                  <ChevronUp className="h-3 w-3" />
                )}
                {loadingMore ? 'Loading...' : 'Load older messages'}
              </button>
            )}
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
    </div>
  );
}
