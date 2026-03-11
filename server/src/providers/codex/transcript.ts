import type { ParsedMessage } from '../types.js';

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
        const command = (payload.command ?? '').replace(/^bash\s+-lc\s+/, '');
        messages.push({
          type: 'tool_call',
          content: JSON.stringify({ command }, null, 2),
          toolName: 'command_execution',
          toolDetail: command,
          timestamp: ts,
        });
        if (payload.output != null) {
          messages.push({
            type: 'tool_result',
            content: payload.output,
            timestamp: ts,
          });
        }
      } else if (payload.type === 'file_change') {
        messages.push({
          type: 'tool_call',
          content: JSON.stringify({ file: payload.file }, null, 2),
          toolName: 'file_change',
          toolDetail: payload.file ?? '',
          timestamp: ts,
        });
      }
    }
  }
  return messages;
}
