import { OutputParser, type ParsedMessage } from '../types.js';

/**
 * Parses Codex CLI NDJSON output from `codex exec --json`.
 * Each line is a JSON event with a `type` field that maps to ParsedMessage types.
 */
export class CodexStreamParser extends OutputParser {
  private buffer = '';
  private sessionId: string | null = null;

  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    // Keep the last incomplete line in the buffer
    this.buffer = lines.pop() ?? '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        this.processEvent(JSON.parse(trimmed));
      } catch {
        continue;
      }
    }
  }

  flush(): void {
    const trimmed = this.buffer.trim();
    if (trimmed) {
      try {
        this.processEvent(JSON.parse(trimmed));
      } catch {
        /* ignore unparseable trailing data */
      }
    }
    this.buffer = '';
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  private processEvent(obj: any): void {
    if (obj.type === 'thread.started') {
      this.sessionId = obj.thread_id ?? null;
      this.emit('message', {
        type: 'system',
        subType: 'init',
        content: `Session started${obj.thread_id ? ` (${obj.thread_id})` : ''}`,
        timestamp: Date.now(),
      } satisfies ParsedMessage);
      return;
    }

    if (obj.type === 'turn.completed') {
      const parts: string[] = [];
      if (obj.usage?.input_tokens != null)
        parts.push(`Input: ${obj.usage.input_tokens} tokens`);
      if (obj.usage?.output_tokens != null)
        parts.push(`Output: ${obj.usage.output_tokens} tokens`);
      this.emit('message', {
        type: 'system',
        subType: 'result',
        content: parts.join(' | ') || 'Turn complete',
        timestamp: Date.now(),
      } satisfies ParsedMessage);
      return;
    }

    if (obj.type === 'turn.failed' || obj.type === 'error') {
      this.emit('message', {
        type: 'system',
        subType: 'error',
        content: obj.error?.message ?? obj.message ?? 'Unknown error',
        timestamp: Date.now(),
      } satisfies ParsedMessage);
      return;
    }

    if (obj.type === 'item.started') {
      const item = obj.item;
      if (!item) return;
      if (item.type === 'command_execution') {
        const command = (item.command ?? '').replace(/^bash\s+-lc\s+/, '');
        this.emit('message', {
          type: 'tool_call',
          content: JSON.stringify({ command }, null, 2),
          toolName: 'command_execution',
          toolDetail: command,
          timestamp: Date.now(),
        } satisfies ParsedMessage);
      } else if (item.type === 'file_change') {
        this.emit('message', {
          type: 'tool_call',
          content: JSON.stringify({ file: item.file }, null, 2),
          toolName: 'file_change',
          toolDetail: item.file ?? '',
          timestamp: Date.now(),
        } satisfies ParsedMessage);
      } else if (item.type === 'mcp_tool_call') {
        this.emit('message', {
          type: 'tool_call',
          content: JSON.stringify(item.input ?? {}, null, 2),
          toolName: item.name ?? 'mcp_tool',
          toolDetail: item.name ?? '',
          timestamp: Date.now(),
        } satisfies ParsedMessage);
      }
      return;
    }

    if (obj.type === 'item.completed') {
      const item = obj.item;
      if (!item) return;
      if (item.type === 'agent_message') {
        this.emit('message', {
          type: 'assistant',
          content: item.text ?? '',
          timestamp: Date.now(),
        } satisfies ParsedMessage);
      } else if (item.type === 'command_execution') {
        this.emit('message', {
          type: 'tool_result',
          content: item.output ?? `Exit code: ${item.exit_code ?? 0}`,
          timestamp: Date.now(),
        } satisfies ParsedMessage);
      } else if (item.type === 'file_change') {
        this.emit('message', {
          type: 'tool_result',
          content: item.diff ?? item.content ?? 'File changed',
          timestamp: Date.now(),
        } satisfies ParsedMessage);
      } else if (item.type === 'todo_list') {
        this.emit('message', {
          type: 'tool_call',
          content: JSON.stringify(item.todos ?? item, null, 2),
          toolName: 'TodoWrite',
          toolDetail: 'Task list update',
          timestamp: Date.now(),
        } satisfies ParsedMessage);
      }
      // Skip: reasoning, unknown types
      return;
    }
    // Ignore: turn.started, etc.
  }
}
