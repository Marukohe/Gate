import { create } from 'zustand';

export interface ChatMessage {
  id: string;
  type: 'assistant' | 'user' | 'tool_call' | 'tool_result' | 'system';
  content: string;
  toolName?: string;
  toolDetail?: string;
  timestamp: number;
}

interface ChatStore {
  messages: Record<string, ChatMessage[]>; // keyed by serverId
  addMessage: (serverId: string, message: ChatMessage) => void;
  setHistory: (serverId: string, messages: ChatMessage[]) => void;
  clearMessages: (serverId: string) => void;
}

export const useChatStore = create<ChatStore>((set) => ({
  messages: {},
  addMessage: (serverId, message) => set((s) => ({
    messages: {
      ...s.messages,
      [serverId]: [...(s.messages[serverId] ?? []), message],
    },
  })),
  setHistory: (serverId, messages) => set((s) => ({
    messages: { ...s.messages, [serverId]: messages },
  })),
  clearMessages: (serverId) => set((s) => ({
    messages: { ...s.messages, [serverId]: [] },
  })),
}));
