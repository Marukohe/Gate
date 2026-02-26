import { describe, it, expect } from 'vitest';
import { parseTranscript } from '../transcript-parser.js';

describe('parseTranscript', () => {
  it('parses user text messages', () => {
    const jsonl = JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'Hello Claude' },
      timestamp: '2026-02-22T08:59:08.599Z',
      uuid: 'abc-123',
    });
    const msgs = parseTranscript(jsonl);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('user');
    expect(msgs[0].content).toBe('Hello Claude');
    expect(msgs[0].timestamp).toBe(new Date('2026-02-22T08:59:08.599Z').getTime());
  });

  it('parses assistant text messages', () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hi there!' }],
      },
      timestamp: '2026-02-22T09:00:00.000Z',
    });
    const msgs = parseTranscript(jsonl);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('assistant');
    expect(msgs[0].content).toBe('Hi there!');
  });

  it('parses tool_use blocks as tool_call', () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu_123',
          name: 'Read',
          input: { file_path: '/tmp/test.ts' },
        }],
      },
      timestamp: '2026-02-22T09:00:01.000Z',
    });
    const msgs = parseTranscript(jsonl);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('tool_call');
    expect(msgs[0].toolName).toBe('Read');
    expect(msgs[0].toolDetail).toBe('/tmp/test.ts');
  });

  it('parses tool_result blocks', () => {
    const jsonl = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          tool_use_id: 'toolu_123',
          content: 'file contents here',
        }],
      },
      timestamp: '2026-02-22T09:00:02.000Z',
    });
    const msgs = parseTranscript(jsonl);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('tool_result');
    expect(msgs[0].content).toBe('file contents here');
  });

  it('skips thinking blocks', () => {
    const jsonl = JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'thinking', thinking: 'Let me think...' }],
      },
      timestamp: '2026-02-22T09:00:03.000Z',
    });
    const msgs = parseTranscript(jsonl);
    expect(msgs).toHaveLength(0);
  });

  it('skips queue-operation entries', () => {
    const jsonl = JSON.stringify({
      type: 'queue-operation',
      operation: 'enqueue',
      timestamp: '2026-02-22T08:59:08.589Z',
      content: 'some content',
    });
    const msgs = parseTranscript(jsonl);
    expect(msgs).toHaveLength(0);
  });

  it('handles multiple lines', () => {
    const lines = [
      JSON.stringify({
        type: 'user',
        message: { role: 'user', content: 'Question 1' },
        timestamp: '2026-02-22T09:00:00.000Z',
      }),
      JSON.stringify({
        type: 'queue-operation',
        operation: 'dequeue',
        timestamp: '2026-02-22T09:00:00.001Z',
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Answer 1' }],
        },
        timestamp: '2026-02-22T09:00:01.000Z',
      }),
      JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{
            type: 'tool_use',
            id: 'toolu_1',
            name: 'Bash',
            input: { command: 'ls -la' },
          }],
        },
        timestamp: '2026-02-22T09:00:02.000Z',
      }),
    ].join('\n');

    const msgs = parseTranscript(lines);
    expect(msgs).toHaveLength(3);
    expect(msgs[0].type).toBe('user');
    expect(msgs[1].type).toBe('assistant');
    expect(msgs[2].type).toBe('tool_call');
    expect(msgs[2].toolName).toBe('Bash');
    expect(msgs[2].toolDetail).toBe('ls -la');
  });

  it('handles malformed lines gracefully', () => {
    const lines = 'not json\n{"type":"user","message":{"role":"user","content":"hello"},"timestamp":"2026-01-01T00:00:00Z"}\n{broken';
    const msgs = parseTranscript(lines);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('hello');
  });
});
