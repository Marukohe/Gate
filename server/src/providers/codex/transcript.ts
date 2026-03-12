import type { ParsedMessage } from '../types.js';
import {
  formatCodexCommandResult,
  normalizeCodexToolName,
  serializeToolInput,
  stripShellWrapper,
  summarizeCodexToolDetail,
} from './tool-utils.js';

function getFileDetail(payload: { file?: string; file_path?: string; path?: string }): string {
  return payload.file ?? payload.file_path ?? payload.path ?? '';
}

/**
 * Parses Codex rollout JSONL transcripts (stored in ~/.codex/sessions/).
 * Each line: {timestamp, type: "SessionMeta"|"ResponseItem"|..., payload: {...}}
 */
export function parseCodexTranscript(jsonlContent: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  const lines = jsonlContent.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let obj: any;
    try {
      obj = JSON.parse(trimmed);
    } catch {
      continue;
    }

    const ts = obj.timestamp ? new Date(obj.timestamp).getTime() : Date.now();
    const payload = obj.payload ?? obj;

    if (obj.type === 'SessionMeta') {
      messages.push({
        type: 'system',
        subType: 'init',
        content: `Session started (${payload.id ?? 'unknown'})`,
        timestamp: ts,
      });
      continue;
    }

    if (obj.type === 'ResponseItem' || obj.type === 'response_item') {
      if (payload.type === 'agent_message') {
        messages.push({
          type: 'assistant',
          content: payload.text ?? '',
          timestamp: ts,
        });
      } else if (payload.type === 'command_execution') {
        const command = stripShellWrapper(payload.command ?? '');
        messages.push({
          type: 'tool_call',
          content: JSON.stringify({ command }, null, 2),
          toolName: normalizeCodexToolName(payload.type),
          toolDetail: command,
          timestamp: ts,
        });
        const resultContent = formatCodexCommandResult(payload);
        if (resultContent) {
          messages.push({
            type: 'tool_result',
            content: resultContent,
            toolName: normalizeCodexToolName(payload.type),
            toolDetail: command,
            timestamp: ts,
          });
        }
      } else if (payload.type === 'file_change') {
        const fileDetail = getFileDetail(payload);
        messages.push({
          type: 'tool_call',
          content: JSON.stringify({ file: fileDetail }, null, 2),
          toolName: normalizeCodexToolName(payload.type),
          toolDetail: fileDetail,
          timestamp: ts,
        });
      } else if (payload.type === 'custom_tool_call' || payload.type === 'function_call') {
        const name = payload.name ?? payload.type;
        const input = payload.input ?? payload.arguments ?? {};
        messages.push({
          type: 'tool_call',
          content: serializeToolInput(input),
          toolName: normalizeCodexToolName(name),
          toolDetail: summarizeCodexToolDetail(name, input),
          timestamp: ts,
        });
      }
    }
  }
  return messages;
}
