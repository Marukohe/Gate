import { EventEmitter } from 'events';

export interface ParsedMessage {
  type: 'assistant' | 'user' | 'tool_call' | 'tool_result' | 'system';
  content: string;
  toolName?: string;
  toolDetail?: string;
  timestamp: number;
}

/**
 * Parses NDJSON output from `claude -p --output-format stream-json --verbose`.
 *
 * Each stdout line is a complete JSON object. Actual event shapes:
 *   - {type:"system", subtype:"init", session_id, ...}
 *   - {type:"assistant", message:{role:"assistant", content:[...]}, session_id, ...}
 *   - {type:"user", message:{role:"user", content:".." | [{type:"tool_result",...}]}, ...}
 *   - {type:"result", total_cost_usd, duration_ms, num_turns, ...}
 *   - {type:"rate_limit_event", ...} → ignored
 */
export class StreamJsonParser extends EventEmitter {
  private buffer = '';
  private sessionId: string | null = null;

  feed(chunk: string): void {
    this.buffer += chunk;
    const lines = this.buffer.split('\n');
    // Keep the last (possibly incomplete) line in the buffer
    this.buffer = lines.pop() ?? '';

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;

      let obj: any;
      try {
        obj = JSON.parse(trimmed);
      } catch {
        // Skip non-JSON lines (stderr leakage, debug output, etc.)
        continue;
      }

      this.processEvent(obj);
    }
  }

  flush(): void {
    const trimmed = this.buffer.trim();
    if (trimmed) {
      try {
        this.processEvent(JSON.parse(trimmed));
      } catch {
        // Ignore incomplete JSON
      }
    }
    this.buffer = '';
  }

  getSessionId(): string | null {
    return this.sessionId;
  }

  // ── Event dispatch ──────────────────────────────────────────────

  private processEvent(obj: any): void {
    // System init: {type:"system", subtype:"init", session_id}
    if (obj.type === 'system' && obj.subtype === 'init') {
      this.sessionId = obj.session_id ?? null;
      this.emitMessage({
        type: 'system',
        content: `Session started${obj.session_id ? ` (${obj.session_id})` : ''}`,
        timestamp: Date.now(),
      });
      return;
    }

    // Result summary: {type:"result", duration_ms, num_turns, ...}
    if (obj.type === 'result') {
      const parts: string[] = [];
      if (obj.duration_ms != null) parts.push(`Duration: ${(obj.duration_ms / 1000).toFixed(1)}s`);
      if (obj.num_turns != null) parts.push(`Turns: ${obj.num_turns}`);
      this.emitMessage({
        type: 'system',
        content: parts.join(' | ') || 'Task complete',
        timestamp: Date.now(),
      });
      return;
    }

    // Assistant message: {type:"assistant", message:{role:"assistant", content:[...]}}
    if (obj.type === 'assistant') {
      const content = obj.message?.content;
      if (!Array.isArray(content)) return;
      for (const block of content) {
        if (block.type === 'text' && block.text) {
          this.emitMessage({
            type: 'assistant',
            content: block.text,
            timestamp: Date.now(),
          });
        } else if (block.type === 'tool_use') {
          this.emitMessage({
            type: 'tool_call',
            content: JSON.stringify(block.input, null, 2),
            toolName: block.name ?? 'unknown',
            toolDetail: summarizeToolInput(block.name, block.input),
            timestamp: Date.now(),
          });
        }
      }
      return;
    }

    // User message: {type:"user", message:{role:"user", content:"..." | [...]}}
    if (obj.type === 'user') {
      const content = obj.message?.content;
      if (typeof content === 'string') {
        this.emitMessage({
          type: 'user',
          content,
          timestamp: Date.now(),
        });
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (block.type === 'tool_result') {
            const text = typeof block.content === 'string'
              ? block.content
              : JSON.stringify(block.content);
            this.emitMessage({
              type: 'tool_result',
              content: text,
              timestamp: Date.now(),
            });
          }
        }
      }
      return;
    }

    // Unrecognised event (rate_limit_event, etc.) — silently ignore
  }

  private emitMessage(msg: ParsedMessage): void {
    this.emit('message', msg);
  }
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
