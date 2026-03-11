import { describe, it, expect } from 'vitest';
import { parseCodexTranscript } from '../../../providers/codex/transcript.js';

describe('parseCodexTranscript', () => {
  it('parses SessionMeta', () => {
    const input = '{"timestamp":"2025-01-01T00:00:00Z","type":"SessionMeta","payload":{"id":"sess-1","cwd":"/home/user"}}\n';
    const msgs = parseCodexTranscript(input);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('system');
    expect(msgs[0].subType).toBe('init');
    expect(msgs[0].content).toContain('sess-1');
  });

  it('parses agent_message ResponseItem', () => {
    const input = '{"timestamp":"2025-01-01T00:00:00Z","type":"ResponseItem","payload":{"type":"agent_message","text":"Hello"}}\n';
    const msgs = parseCodexTranscript(input);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('assistant');
    expect(msgs[0].content).toBe('Hello');
  });

  it('parses command_execution ResponseItem with output', () => {
    const input = '{"timestamp":"2025-01-01T00:00:00Z","type":"ResponseItem","payload":{"type":"command_execution","command":"ls","output":"file.txt"}}\n';
    const msgs = parseCodexTranscript(input);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].type).toBe('tool_call');
    expect(msgs[0].toolName).toBe('command_execution');
    expect(msgs[1].type).toBe('tool_result');
    expect(msgs[1].content).toBe('file.txt');
  });

  it('parses file_change ResponseItem', () => {
    const input = '{"timestamp":"2025-01-01T00:00:00Z","type":"ResponseItem","payload":{"type":"file_change","file":"main.ts"}}\n';
    const msgs = parseCodexTranscript(input);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('tool_call');
    expect(msgs[0].toolName).toBe('file_change');
    expect(msgs[0].toolDetail).toBe('main.ts');
  });

  it('handles response_item type alias', () => {
    const input = '{"timestamp":"2025-01-01T00:00:00Z","type":"response_item","payload":{"type":"agent_message","text":"Hi"}}\n';
    const msgs = parseCodexTranscript(input);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('assistant');
  });

  it('handles multiple lines', () => {
    const input = [
      '{"timestamp":"2025-01-01T00:00:00Z","type":"SessionMeta","payload":{"id":"s1"}}',
      '{"timestamp":"2025-01-01T00:01:00Z","type":"ResponseItem","payload":{"type":"agent_message","text":"hi"}}',
      '{"timestamp":"2025-01-01T00:02:00Z","type":"ResponseItem","payload":{"type":"command_execution","command":"pwd","output":"/home"}}',
    ].join('\n');
    const msgs = parseCodexTranscript(input);
    expect(msgs).toHaveLength(4); // SessionMeta + agent_message + tool_call + tool_result
  });

  it('skips invalid JSON lines', () => {
    const input = 'not valid json\n{"timestamp":"2025-01-01T00:00:00Z","type":"ResponseItem","payload":{"type":"agent_message","text":"ok"}}\n';
    const msgs = parseCodexTranscript(input);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('ok');
  });

  it('skips empty lines', () => {
    const input = '\n\n{"type":"ResponseItem","payload":{"type":"agent_message","text":"hi"}}\n\n';
    const msgs = parseCodexTranscript(input);
    expect(msgs).toHaveLength(1);
  });

  it('strips bash -lc prefix from commands', () => {
    const input = '{"type":"ResponseItem","payload":{"type":"command_execution","command":"bash -lc echo hi"}}\n';
    const msgs = parseCodexTranscript(input);
    expect(msgs[0].toolDetail).toBe('echo hi');
  });
});
