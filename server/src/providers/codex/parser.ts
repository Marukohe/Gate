import { OutputParser, type ParsedMessage } from '../types.js';
import {
  formatCodexCommandResult,
  getCodexResultType,
  normalizeCodexToolName,
  serializeToolInput,
  stripShellWrapper,
  summarizeCodexToolDetail,
} from './tool-utils.js';

function getFileDetail(item: { file?: string; file_path?: string; path?: string }): string {
  return item.file ?? item.file_path ?? item.path ?? '';
}

/**
 * Parses Codex CLI NDJSON output from `codex exec --json`.
 * Each line is a JSON event with a `type` field that maps to ParsedMessage types.
 */
export class CodexStreamParser extends OutputParser {
  private buffer = '';
  private sessionId: string | null = null;
  private activeTool:
    | { resultType: string; name: string; detail: string }
    | null = null;

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
    if (obj.type === 'response_item' || obj.type === 'ResponseItem') {
      this.processEvent(obj.payload ?? {});
      return;
    }

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

    if (obj.type === 'agent_message') {
      this.emit('message', {
        type: 'assistant',
        content: obj.text ?? '',
        timestamp: Date.now(),
      } satisfies ParsedMessage);
      return;
    }

    if (obj.type === 'command_execution') {
      const activeToolDetail =
        this.activeTool && this.activeTool.resultType === obj.type
          ? this.activeTool.detail
          : '';
      const command = obj.command ? stripShellWrapper(obj.command) : activeToolDetail;
      const resultContent = formatCodexCommandResult(obj);

      if (resultContent || activeToolDetail) {
        this.emit('message', {
          type: 'tool_result',
          content: resultContent ?? 'Exit code: 0',
          toolName: normalizeCodexToolName(obj.type),
          toolDetail: command,
          timestamp: Date.now(),
        } satisfies ParsedMessage);
        this.activeTool = null;
      } else {
        this.emit('message', {
          type: 'tool_call',
          content: JSON.stringify({ command }, null, 2),
          toolName: normalizeCodexToolName(obj.type),
          toolDetail: command,
          timestamp: Date.now(),
        } satisfies ParsedMessage);
        this.activeTool = {
          resultType: obj.type,
          name: normalizeCodexToolName(obj.type),
          detail: command,
        };
      }
      return;
    }

    if (obj.type === 'file_change') {
      const activeToolDetail =
        this.activeTool && this.activeTool.resultType === obj.type
          ? this.activeTool.detail
          : '';
      const fileDetail = getFileDetail(obj);

      if (obj.diff != null || obj.content != null || activeToolDetail) {
        this.emit('message', {
          type: 'tool_result',
          content: obj.diff ?? obj.content ?? 'File changed',
          toolName: normalizeCodexToolName(obj.type),
          toolDetail: fileDetail || activeToolDetail,
          timestamp: Date.now(),
        } satisfies ParsedMessage);
        this.activeTool = null;
      } else {
        this.emit('message', {
          type: 'tool_call',
          content: JSON.stringify({ file: fileDetail }, null, 2),
          toolName: normalizeCodexToolName(obj.type),
          toolDetail: fileDetail,
          timestamp: Date.now(),
        } satisfies ParsedMessage);
        this.activeTool = {
          resultType: obj.type,
          name: normalizeCodexToolName(obj.type),
          detail: fileDetail,
        };
      }
      return;
    }

    if (obj.type === 'custom_tool_call' || obj.type === 'function_call') {
      const name = obj.name ?? obj.type;
      const input = obj.input ?? obj.arguments ?? {};
      const detail = summarizeCodexToolDetail(name, input);
      this.emit('message', {
        type: 'tool_call',
        content: serializeToolInput(input),
        toolName: normalizeCodexToolName(name),
        toolDetail: detail,
        timestamp: Date.now(),
      } satisfies ParsedMessage);
      this.activeTool = {
        resultType: getCodexResultType(obj.type, name),
        name: normalizeCodexToolName(name),
        detail,
      };
      return;
    }

    if (obj.type === 'item.started') {
      const item = obj.item;
      if (!item) return;
      if (item.type === 'command_execution') {
        const command = stripShellWrapper(item.command ?? '');
        this.emit('message', {
          type: 'tool_call',
          content: JSON.stringify({ command }, null, 2),
          toolName: normalizeCodexToolName(item.type),
          toolDetail: command,
          timestamp: Date.now(),
        } satisfies ParsedMessage);
        this.activeTool = {
          resultType: item.type,
          name: normalizeCodexToolName(item.type),
          detail: command,
        };
      } else if (item.type === 'file_change') {
        const fileDetail = getFileDetail(item);
        this.emit('message', {
          type: 'tool_call',
          content: JSON.stringify({ file: fileDetail }, null, 2),
          toolName: normalizeCodexToolName(item.type),
          toolDetail: fileDetail,
          timestamp: Date.now(),
        } satisfies ParsedMessage);
        this.activeTool = {
          resultType: item.type,
          name: normalizeCodexToolName(item.type),
          detail: fileDetail,
        };
      } else if (item.type === 'mcp_tool_call') {
        this.emit('message', {
          type: 'tool_call',
          content: JSON.stringify(item.input ?? {}, null, 2),
          toolName: normalizeCodexToolName(item.name ?? 'mcp_tool'),
          toolDetail: item.name ?? '',
          timestamp: Date.now(),
        } satisfies ParsedMessage);
        this.activeTool = {
          resultType: item.type,
          name: normalizeCodexToolName(item.name ?? 'mcp_tool'),
          detail: item.name ?? '',
        };
      } else if (item.type === 'custom_tool_call' || item.type === 'function_call') {
        const name = item.name ?? item.type;
        const input = item.input ?? item.arguments ?? {};
        this.emit('message', {
          type: 'tool_call',
          content: serializeToolInput(input),
          toolName: normalizeCodexToolName(name),
          toolDetail: summarizeCodexToolDetail(name, input),
          timestamp: Date.now(),
        } satisfies ParsedMessage);
        this.activeTool = {
          resultType: getCodexResultType(item.type, name),
          name: normalizeCodexToolName(name),
          detail: summarizeCodexToolDetail(name, input),
        };
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
        const activeToolDetail =
          this.activeTool && this.activeTool.resultType === item.type
            ? this.activeTool.detail
            : '';
        const detail = item.command
          ? stripShellWrapper(item.command)
          : activeToolDetail;
        const resultContent = formatCodexCommandResult(item);
        this.emit('message', {
          type: 'tool_result',
          content: resultContent ?? 'Exit code: 0',
          toolName: normalizeCodexToolName(item.type),
          toolDetail: detail,
          timestamp: Date.now(),
        } satisfies ParsedMessage);
        this.activeTool = null;
      } else if (item.type === 'file_change') {
        const activeToolDetail =
          this.activeTool && this.activeTool.resultType === item.type
            ? this.activeTool.detail
            : '';
        const fileDetail = getFileDetail(item);
        this.emit('message', {
          type: 'tool_result',
          content: item.diff ?? item.content ?? 'File changed',
          toolName: normalizeCodexToolName(item.type),
          toolDetail: fileDetail || activeToolDetail,
          timestamp: Date.now(),
        } satisfies ParsedMessage);
        this.activeTool = null;
      } else if (item.type === 'todo_list') {
        this.emit('message', {
          type: 'tool_call',
          content: JSON.stringify({ todos: item.todos ?? [] }, null, 2),
          toolName: normalizeCodexToolName(item.type),
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
