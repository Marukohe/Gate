import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  type: 'assistant' | 'user' | 'tool_call' | 'tool_result' | 'system';
  subType?: string;
  content: string;
  toolName?: string;
  toolDetail?: string;
  timestamp: number;
}

let msgSeq = 0;

interface ChatStore {
  messages: Record<string, ChatMessage[]>; // keyed by sessionId
  hasMore: Record<string, boolean>;        // sessionId → has older messages in DB
  addMessage: (sessionId: string, message: Omit<ChatMessage, 'id'>) => void;
  setHistory: (sessionId: string, messages: ChatMessage[], hasMore?: boolean) => void;
  prependMessages: (sessionId: string, messages: ChatMessage[], hasMore: boolean) => void;
  clearMessages: (sessionId: string) => void;
  clearServerMessages: (keepSessionIds: Set<string>) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: {},
  hasMore: {},
  addMessage: (sessionId, message) => set((s) => ({
    messages: {
      ...s.messages,
      [sessionId]: [...(s.messages[sessionId] ?? []), { ...message, id: `msg-${++msgSeq}` }],
    },
  })),
  setHistory: (sessionId, messages, hasMore) => set((s) => ({
    messages: { ...s.messages, [sessionId]: messages },
    hasMore: hasMore !== undefined ? { ...s.hasMore, [sessionId]: hasMore } : s.hasMore,
  })),
  prependMessages: (sessionId, older, hasMore) => set((s) => ({
    messages: {
      ...s.messages,
      [sessionId]: [...older, ...(s.messages[sessionId] ?? [])],
    },
    hasMore: { ...s.hasMore, [sessionId]: hasMore },
  })),
  clearMessages: (sessionId) => set((s) => ({
    messages: { ...s.messages, [sessionId]: [] },
    hasMore: { ...s.hasMore, [sessionId]: false },
  })),
  // Evict messages for sessions NOT in keepSessionIds (used on server switch)
  clearServerMessages: (keepSessionIds) => set((s) => {
    const messages: Record<string, ChatMessage[]> = {};
    const hasMore: Record<string, boolean> = {};
    for (const sid of Object.keys(s.messages)) {
      if (keepSessionIds.has(sid)) {
        messages[sid] = s.messages[sid];
        hasMore[sid] = s.hasMore[sid] ?? false;
      }
    }
    return { messages, hasMore };
  }),
}));
