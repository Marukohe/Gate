import type { ChatMessage } from '@/stores/chat-store';

export interface MergedToolItem {
  call: ChatMessage;
  result: ChatMessage | null;
}

export interface ToolActivityGroup {
  kind: 'tool-group';
  items: MergedToolItem[];
  isUserBash: boolean;
}

export interface SingleMessage {
  kind: 'single';
  message: ChatMessage;
}

export type RenderItem = ToolActivityGroup | SingleMessage;

function isToolMessage(msg: ChatMessage): boolean {
  return msg.type === 'tool_call' || msg.type === 'tool_result';
}

function canPair(call: ChatMessage, result: ChatMessage): boolean {
  if (call.type !== 'tool_call' || result.type !== 'tool_result') return false;
  if (result.toolName && call.toolName && result.toolName !== call.toolName) return false;
  if (result.toolDetail && call.toolDetail && result.toolDetail !== call.toolDetail) return false;
  return true;
}

function buildGroup(toolRun: ChatMessage[]): ToolActivityGroup {
  const items: MergedToolItem[] = [];
  let isUserBash = false;

  for (let i = 0; i < toolRun.length; i++) {
    const msg = toolRun[i];

    if (msg.type === 'tool_call') {
      items.push({ call: msg, result: null });
    } else if (msg.type === 'tool_result') {
      for (let j = items.length - 1; j >= 0; j--) {
        if (items[j].result === null && canPair(items[j].call, msg)) {
          items[j] = { ...items[j], result: msg };
          if (items[j].call.toolName === 'bash' || items[j].call.toolName === 'Bash') isUserBash = true;
          break;
        }
        if (j === 0) {
          // Standalone tool_result without a preceding tool_call. When the backend
          // omitted tool metadata, inherit the last seen tool so the UI remains readable.
          const previous = items[items.length - 1]?.call;
          const inherited = {
            ...msg,
            toolName: msg.toolName ?? previous?.toolName,
            toolDetail: msg.toolDetail ?? previous?.toolDetail,
          };
          if (inherited.toolName === 'bash' || inherited.toolName === 'Bash') isUserBash = true;
          items.push({ call: inherited, result: null });
        }
      }
      if (items.length === 0) {
        if (msg.toolName === 'bash' || msg.toolName === 'Bash') isUserBash = true;
        items.push({ call: msg, result: null });
      }
    }
  }

  return { kind: 'tool-group', items, isUserBash };
}

export function groupMessages(messages: ChatMessage[]): RenderItem[] {
  const result: RenderItem[] = [];
  let toolRun: ChatMessage[] = [];

  function flushToolRun() {
    if (toolRun.length > 0) {
      result.push(buildGroup(toolRun));
      toolRun = [];
    }
  }

  for (const msg of messages) {
    if (isToolMessage(msg)) {
      toolRun.push(msg);
    } else {
      flushToolRun();
      result.push({ kind: 'single', message: msg });
    }
  }

  flushToolRun();
  return result;
}
