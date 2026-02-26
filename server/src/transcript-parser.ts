import type { ParsedMessage } from './stream-json-parser.js';

/**
 * Parses a Claude Code JSONL transcript file into Gate-compatible messages.
 *
 * The JSONL format (one object per line) has entries like:
 *   {type:"user",  message:{role:"user", content:"..." | [...]}, timestamp:"...", uuid:"..."}
 *   {type:"assistant", message:{role:"assistant", content:[{type:"text"|"tool_use"|"thinking",...}]}, timestamp:"...", uuid:"..."}
 *   {type:"queue-operation", ...}  — ignored
 *
 * Each assistant entry may contain a single content block (text, tool_use, or thinking).
 * Thinking blocks are skipped.
 */
export function parseTranscript(jsonlContent: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];

  for (const line of jsonlContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : Date.now();

    if (obj.type === 'assistant' && obj.message?.content) {
      const blocks: any[] = Array.isArray(obj.message.content) ? obj.message.content : [];
      for (const block of blocks) {
        if (block.type === 'text' && block.text) {
          messages.push({ type: 'assistant', content: block.text, timestamp: ts });
        } else if (block.type === 'tool_use') {
          messages.push({
            type: 'tool_call',
            content: JSON.stringify(block.input, null, 2),
            toolName: block.name ?? 'unknown',
            toolDetail: summarizeToolInput(block.name, block.input),
            timestamp: ts,
          });
        }
        // Skip thinking blocks
      }
      continue;
    }

    if (obj.type === 'user' && obj.message?.content) {
      const content = obj.message.content;
      if (typeof content === 'string') {
        // Skip system-injected content (context continuation summaries, system reminders)
        if (isSystemInjected(content)) continue;
        messages.push({ type: 'user', content, timestamp: ts });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            const text = typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content);
            messages.push({ type: 'tool_result', content: text, timestamp: ts });
          }
        }
      }
      continue;
    }

    // Skip queue-operation, system, result, and other entries
  }

  return messages;
}

/** Detect system-injected user messages that aren't real user input. */
function isSystemInjected(content: string): boolean {
  if (content.startsWith('This session is being continued from a previous conversation')) return true;
  if (content.includes('<system-reminder>')) return true;
  if (content.startsWith('<command-name>')) return true;
  if (content.startsWith('<local-command-stdout>')) return true;
  return false;
}

function summarizeToolInput(name: string | undefined, input: any): string {
  if (!name || !input) return '';
  switch (name) {
    case 'Bash': return input.command ?? '';
    case 'Read': return input.file_path ?? '';
    case 'Write': return input.file_path ?? '';
    case 'Edit': return input.file_path ?? '';
    case 'Glob': return input.pattern ?? '';
    case 'Grep': return input.pattern ?? '';
    case 'WebFetch': return input.url ?? '';
    case 'WebSearch': return input.query ?? '';
    case 'Task': return input.description ?? '';
    default: return '';
  }
}
