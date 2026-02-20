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
  addMessage: (sessionId: string, message: Omit<ChatMessage, 'id'>) => void;
  setHistory: (sessionId: string, messages: ChatMessage[]) => void;
  clearMessages: (sessionId: string) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: {},
  addMessage: (sessionId, message) => set((s) => ({
    messages: {
      ...s.messages,
      [sessionId]: [...(s.messages[sessionId] ?? []), { ...message, id: `msg-${++msgSeq}` }],
    },
  })),
  setHistory: (sessionId, messages) => set((s) => ({
    messages: { ...s.messages, [sessionId]: messages },
  })),
  clearMessages: (sessionId) => set((s) => ({
    messages: { ...s.messages, [sessionId]: [] },
  })),
}));
