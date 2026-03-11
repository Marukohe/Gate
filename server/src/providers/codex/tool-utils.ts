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

export function stripShellWrapper(command: string): string {
  return unwrapQuoted(command.trim().replace(SHELL_WRAPPER_RE, ''));
}

export function normalizeCodexToolName(rawName: string): string {
  switch (rawName) {
    case 'command_execution':
    case 'exec_command':
      return 'Bash';
    case 'file_change':
    case 'apply_patch':
      return 'Edit';
    case 'web_search':
      return 'WebSearch';
    case 'todo_list':
      return 'TodoWrite';
    default:
      return rawName;
  }
}

export function serializeToolInput(input: unknown): string {
  return typeof input === 'string'
    ? input
    : JSON.stringify(input ?? {}, null, 2);
}

export function summarizeCodexToolDetail(name: string, input: unknown): string {
  if (name === 'apply_patch' && typeof input === 'string') {
    const matches = [...input.matchAll(/^\*\*\* (?:Add|Update|Delete) File: (.+)$/gm)]
      .map((match) => match[1])
      .filter(Boolean);
    if (matches.length === 0) return 'Patch';
    if (matches.length === 1) return matches[0];
    return `${matches[0]} (+${matches.length - 1} more)`;
  }

  if (name === 'exec_command') {
    try {
      const parsed = typeof input === 'string' ? JSON.parse(input) : input;
      const command = parsed && typeof parsed === 'object' && 'cmd' in parsed ? parsed.cmd : '';
      return typeof command === 'string' ? stripShellWrapper(command) : 'Command';
    } catch {
      return typeof input === 'string' ? stripShellWrapper(input) : 'Command';
    }
  }

  if (input && typeof input === 'object') {
    const detail = (input as Record<string, unknown>).file_path
      ?? (input as Record<string, unknown>).path
      ?? (input as Record<string, unknown>).file;
    if (typeof detail === 'string') return detail;
  }

  return name;
}

export function getCodexResultType(type: string, name?: string): string {
  if ((type === 'custom_tool_call' || type === 'function_call') && name === 'apply_patch') {
    return 'file_change';
  }
  if ((type === 'custom_tool_call' || type === 'function_call') && name === 'exec_command') {
    return 'command_execution';
  }
  return type;
}
