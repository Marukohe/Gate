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

function buildGroup(toolRun: ChatMessage[]): ToolActivityGroup {
  const items: MergedToolItem[] = [];
  let isUserBash = false;

  for (let i = 0; i < toolRun.length; i++) {
    const msg = toolRun[i];

    if (msg.type === 'tool_call') {
      // Check if next message is its paired result
      const next = toolRun[i + 1];
      if (next?.type === 'tool_result') {
        items.push({ call: msg, result: next });
        i++; // skip the paired result
      } else {
        items.push({ call: msg, result: null });
      }
    } else if (msg.type === 'tool_result') {
      // Standalone tool_result without a preceding tool_call (e.g. !command bash)
      if (msg.toolName === 'bash') isUserBash = true;
      items.push({ call: msg, result: null });
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
