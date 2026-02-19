import { describe, it, expect } from 'vitest';
import { StreamJsonParser, type ParsedMessage } from './stream-json-parser.js';

function collect(parser: StreamJsonParser): ParsedMessage[] {
  const msgs: ParsedMessage[] = [];
  parser.on('message', (m: ParsedMessage) => msgs.push(m));
  return msgs;
}

describe('StreamJsonParser', () => {
  it('parses system init event', () => {
    const parser = new StreamJsonParser();
    const msgs = collect(parser);
    parser.feed('{"type":"system","subtype":"init","session_id":"abc-123"}\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('system');
    expect(msgs[0].subType).toBe('init');
    expect(msgs[0].content).toContain('abc-123');
    expect(parser.getSessionId()).toBe('abc-123');
  });

  it('parses assistant text message (wrapped format)', () => {
    const parser = new StreamJsonParser();
    const msgs = collect(parser);
    parser.feed(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{ type: 'text', text: 'Hello world' }],
      },
      session_id: 's1',
    }) + '\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('assistant');
    expect(msgs[0].content).toBe('Hello world');
  });

  it('parses assistant tool_use message', () => {
    const parser = new StreamJsonParser();
    const msgs = collect(parser);
    parser.feed(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [{
          type: 'tool_use',
          id: 'toolu_123',
          name: 'Bash',
          input: { command: 'ls -la' },
        }],
      },
    }) + '\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('tool_call');
    expect(msgs[0].toolName).toBe('Bash');
    expect(msgs[0].toolDetail).toBe('ls -la');
    expect(msgs[0].content).toContain('ls -la');
  });

  it('parses mixed text + tool_use in one assistant message', () => {
    const parser = new StreamJsonParser();
    const msgs = collect(parser);
    parser.feed(JSON.stringify({
      type: 'assistant',
      message: {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Let me check' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: '/tmp/a.txt' } },
        ],
      },
    }) + '\n');
    expect(msgs).toHaveLength(2);
    expect(msgs[0].type).toBe('assistant');
    expect(msgs[0].content).toBe('Let me check');
    expect(msgs[1].type).toBe('tool_call');
    expect(msgs[1].toolName).toBe('Read');
    expect(msgs[1].toolDetail).toBe('/tmp/a.txt');
  });

  it('parses user text echo (wrapped format)', () => {
    const parser = new StreamJsonParser();
    const msgs = collect(parser);
    parser.feed(JSON.stringify({
      type: 'user',
      message: { role: 'user', content: 'explain this code' },
    }) + '\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('user');
    expect(msgs[0].content).toBe('explain this code');
  });

  it('parses tool_result message (wrapped format)', () => {
    const parser = new StreamJsonParser();
    const msgs = collect(parser);
    parser.feed(JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{
          type: 'tool_result',
          content: '/home/user/project',
          tool_use_id: 'toolu_123',
        }],
      },
    }) + '\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('tool_result');
    expect(msgs[0].content).toBe('/home/user/project');
  });

  it('parses result summary with duration and turns', () => {
    const parser = new StreamJsonParser();
    const msgs = collect(parser);
    parser.feed('{"type":"result","total_cost_usd":0.0102,"duration_ms":2415,"num_turns":1}\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('system');
    expect(msgs[0].subType).toBe('result');
    expect(msgs[0].content).toContain('2.4s');
    expect(msgs[0].content).toContain('Turns: 1');
    expect(msgs[0].content).not.toContain('$');
  });

  it('parses result summary without cost', () => {
    const parser = new StreamJsonParser();
    const msgs = collect(parser);
    parser.feed('{"type":"result","duration_ms":12000}\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('system');
    expect(msgs[0].content).toContain('12.0s');
    expect(msgs[0].content).not.toContain('Cost');
  });

  it('buffers incomplete lines across feed() calls', () => {
    const parser = new StreamJsonParser();
    const msgs = collect(parser);
    parser.feed('{"type":"assistant","mes');
    expect(msgs).toHaveLength(0);
    parser.feed('sage":{"role":"assistant","content":[{"type":"text","text":"hi"}]}}\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('hi');
  });

  it('handles multiple lines in a single feed()', () => {
    const parser = new StreamJsonParser();
    const msgs = collect(parser);
    parser.feed(
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'q1' } }) + '\n' +
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'a1' }] } }) + '\n'
    );
    expect(msgs).toHaveLength(2);
    expect(msgs[0].type).toBe('user');
    expect(msgs[1].type).toBe('assistant');
  });

  it('skips empty lines and non-JSON lines', () => {
    const parser = new StreamJsonParser();
    const msgs = collect(parser);
    parser.feed('\n\nNot JSON\n' + JSON.stringify({ type: 'user', message: { role: 'user', content: 'ok' } }) + '\n');
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('ok');
  });

  it('flush() processes remaining buffer', () => {
    const parser = new StreamJsonParser();
    const msgs = collect(parser);
    parser.feed(JSON.stringify({ type: 'user', message: { role: 'user', content: 'last' } }));
    expect(msgs).toHaveLength(0);
    parser.flush();
    expect(msgs).toHaveLength(1);
    expect(msgs[0].content).toBe('last');
  });

  it('summarizes tool inputs for known tools', () => {
    const parser = new StreamJsonParser();
    const msgs = collect(parser);
    const tools = [
      { name: 'Edit', input: { file_path: '/a.ts' }, expected: '/a.ts' },
      { name: 'Write', input: { file_path: '/b.ts' }, expected: '/b.ts' },
      { name: 'Glob', input: { pattern: '**/*.ts' }, expected: '**/*.ts' },
      { name: 'Grep', input: { pattern: 'TODO' }, expected: 'TODO' },
      { name: 'WebFetch', input: { url: 'https://x.com' }, expected: 'https://x.com' },
      { name: 'WebSearch', input: { query: 'test' }, expected: 'test' },
      { name: 'Task', input: { description: 'do stuff' }, expected: 'do stuff' },
    ];
    for (const t of tools) {
      parser.feed(JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'x', name: t.name, input: t.input }],
        },
      }) + '\n');
    }
    for (let i = 0; i < tools.length; i++) {
      expect(msgs[i].toolDetail).toBe(tools[i].expected);
    }
  });

  it('summarizes plan-related tools', () => {
    const parser = new StreamJsonParser();
    const msgs = collect(parser);
    const tools = [
      { name: 'EnterPlanMode', input: {}, expected: 'Entering plan mode' },
      { name: 'ExitPlanMode', input: {}, expected: 'Plan ready for review' },
      { name: 'AskUserQuestion', input: { questions: [{ question: 'Which approach?' }] }, expected: 'Which approach?' },
    ];
    for (const t of tools) {
      parser.feed(JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'tool_use', id: 'x', name: t.name, input: t.input }],
        },
      }) + '\n');
    }
    for (let i = 0; i < tools.length; i++) {
      expect(msgs[i].toolDetail).toBe(tools[i].expected);
    }
  });

  it('ignores unrecognised events like rate_limit_event', () => {
    const parser = new StreamJsonParser();
    const msgs = collect(parser);
    parser.feed('{"type":"rate_limit_event","rate_limit_info":{}}\n');
    expect(msgs).toHaveLength(0);
  });

  it('handles a real Claude init sequence', () => {
    const parser = new StreamJsonParser();
    const msgs = collect(parser);
    // Actual events from Claude CLI
    parser.feed('{"type":"rate_limit_event","rate_limit_info":{"status":"allowed"},"session_id":"s1"}\n');
    parser.feed('{"type":"system","subtype":"init","session_id":"s1","model":"claude-opus-4-6"}\n');
    parser.feed('{"type":"assistant","message":{"role":"assistant","content":[{"type":"text","text":"Hello!"}]},"session_id":"s1"}\n');
    parser.feed('{"type":"result","total_cost_usd":0.01,"duration_ms":2400,"num_turns":1,"session_id":"s1"}\n');
    expect(msgs).toHaveLength(3);
    expect(msgs[0].type).toBe('system');
    expect(msgs[1].type).toBe('assistant');
    expect(msgs[1].content).toBe('Hello!');
    expect(msgs[2].type).toBe('system');
    expect(msgs[2].content).toContain('2.4s');
  });
});
