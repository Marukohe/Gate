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

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function readPath(source: unknown, path: string[]): unknown {
  let current = source;
  for (const key of path) {
    if (!isRecord(current) || !(key in current)) return undefined;
    current = current[key];
  }
  return current;
}

function extractText(value: unknown): string | null {
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value
      .map((entry) => extractText(entry))
      .filter((entry): entry is string => !!entry && entry.length > 0);
    return parts.length > 0 ? parts.join('\n') : null;
  }
  if (!isRecord(value)) return null;

  // Codex sometimes nests human-readable output inside generic block objects.
  for (const key of ['text', 'content', 'value', 'message']) {
    const extracted = extractText(value[key]);
    if (extracted) return extracted;
  }

  return null;
}

function extractOutputField(value: unknown): string | null {
  if (isRecord(value) && ('stdout' in value || 'stderr' in value)) return null;
  return extractText(value);
}

function firstText(source: unknown, paths: string[][], extractor: (value: unknown) => string | null = extractText): string | null {
  for (const path of paths) {
    const extracted = extractor(readPath(source, path));
    if (extracted) return extracted;
  }
  return null;
}

function firstNumber(source: unknown, paths: string[][]): number | null {
  for (const path of paths) {
    const value = readPath(source, path);
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

export function formatCodexCommandResult(payload: unknown): string | null {
  const stdout = firstText(payload, [
    ['stdout'],
    ['result', 'stdout'],
    ['output', 'stdout'],
    ['command_output', 'stdout'],
  ]);
  const stderr = firstText(payload, [
    ['stderr'],
    ['result', 'stderr'],
    ['output', 'stderr'],
    ['command_output', 'stderr'],
  ]);
  const output = firstText(
    payload,
    [
      ['output'],
      ['result', 'output'],
      ['content'],
      ['result', 'content'],
      ['aggregated_output'],
      ['combined_output'],
      ['command_output'],
    ],
    extractOutputField,
  );
  const exitCode = firstNumber(payload, [
    ['exit_code'],
    ['result', 'exit_code'],
    ['output', 'exit_code'],
  ]);

  const sections: string[] = [];
  if (stdout) {
    sections.push(stderr ? `stdout:\n${stdout}` : stdout);
  }
  if (stderr) {
    sections.push(`stderr:\n${stderr}`);
  }
  if (sections.length === 0 && output) {
    sections.push(output);
  }
  if (sections.length === 0) {
    return exitCode != null ? `Exit code: ${exitCode}` : null;
  }
  if (exitCode != null && exitCode !== 0) {
    sections.push(`Exit code: ${exitCode}`);
  }
  return sections.join('\n\n');
}
