import type { ChatMessage } from '@/stores/chat-store';

const TOOL_NAME_MAP: Record<string, string> = {
  command_execution: 'Bash',
  file_change: 'Edit',
  web_search: 'WebSearch',
  todo_list: 'TodoWrite',
};

const SHELL_WRAPPER_RE = /^(?:(?:\/\S+\s+)?(?:\/\S+\/)?(?:bash|zsh|sh)|(?:bash|zsh|sh))\s+-lc\s+/;

function unwrapQuoted(text: string): string {
  if (
    (text.startsWith("'") && text.endsWith("'")) ||
    (text.startsWith('"') && text.endsWith('"'))
  ) {
    return text.slice(1, -1);
  }
  return text;
}

export function cleanToolCommand(command: string): string {
  return unwrapQuoted(command.trim().replace(SHELL_WRAPPER_RE, ''));
}

function parseJsonField(content: string, field: string): string {
  try {
    const parsed = JSON.parse(content);
    const value = parsed?.[field];
    return typeof value === 'string' ? value : '';
  } catch {
    return '';
  }
}

function extractDiffPath(content: string): string {
  const diffPath =
    content.match(/^diff --git a\/(.+?) b\/(.+)$/m)?.[2] ??
    content.match(/^\+\+\+ b\/(.+)$/m)?.[1] ??
    '';
  return diffPath;
}

export function getDisplayToolName(message: Pick<ChatMessage, 'type' | 'toolName'>): string {
  if (message.toolName) return TOOL_NAME_MAP[message.toolName] ?? message.toolName;
  if (message.type === 'tool_result') return 'Result';
  return 'Tool';
}

export function getDisplayToolDetail(
  message: Pick<ChatMessage, 'type' | 'toolName' | 'toolDetail' | 'content'>,
): string {
  if (message.type === 'tool_result' && !message.toolDetail) return '';
  const displayName = message.toolName ? (TOOL_NAME_MAP[message.toolName] ?? message.toolName) : '';
  const parsedDetail =
    parseJsonField(message.content, 'file') ||
    parseJsonField(message.content, 'file_path') ||
    parseJsonField(message.content, 'path');
  const diffPath = extractDiffPath(message.content);
  const detail = message.toolDetail || parsedDetail || diffPath || message.content.slice(0, 100);
  if (displayName === 'Bash') return cleanToolCommand(detail);
  return detail;
}
