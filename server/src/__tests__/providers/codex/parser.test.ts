import { describe, it, expect, vi } from 'vitest';
import { CodexStreamParser } from '../../../providers/codex/parser.js';
import type { ParsedMessage } from '../../../providers/types.js';

function collectMessages(parser: CodexStreamParser, input: string): ParsedMessage[] {
  const messages: ParsedMessage[] = [];
  parser.on('message', (msg: ParsedMessage) => messages.push(msg));
  parser.feed(input);
  parser.flush();
  return messages;
}

describe('CodexStreamParser', () => {
  it('parses thread.started event', () => {
    const parser = new CodexStreamParser();
    const msgs = collectMessages(
      parser,
      '{"type":"thread.started","thread_id":"abc-123"}\n',
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('system');
    expect(msgs[0].subType).toBe('init');
    expect(msgs[0].content).toContain('abc-123');
    expect(parser.getSessionId()).toBe('abc-123');
  });

  it('parses agent_message from item.completed', () => {
    const parser = new CodexStreamParser();
    const msgs = collectMessages(
      parser,
      '{"type":"item.completed","item":{"type":"agent_message","text":"Hello world"}}\n',
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('assistant');
    expect(msgs[0].content).toBe('Hello world');
  });

  it('parses command_execution started and completed', () => {
    const parser = new CodexStreamParser();
    const input = [
      '{"type":"item.started","item":{"type":"command_execution","command":"ls -la"}}',
      '{"type":"item.completed","item":{"type":"command_execution","output":"file1.txt\\nfile2.txt","exit_code":0}}',
    ].join('\n') + '\n';

    const msgs = collectMessages(parser, input);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].type).toBe('tool_call');
    expect(msgs[0].toolName).toBe('command_execution');
    expect(msgs[0].toolDetail).toBe('ls -la');
    expect(msgs[1].type).toBe('tool_result');
    expect(msgs[1].content).toContain('file1.txt');
  });

  it('parses file_change events', () => {
    const parser = new CodexStreamParser();
    const input = [
      '{"type":"item.started","item":{"type":"file_change","file":"src/main.ts"}}',
      '{"type":"item.completed","item":{"type":"file_change","diff":"+ new line"}}',
    ].join('\n') + '\n';

    const msgs = collectMessages(parser, input);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].type).toBe('tool_call');
    expect(msgs[0].toolName).toBe('file_change');
    expect(msgs[0].toolDetail).toBe('src/main.ts');
    expect(msgs[1].type).toBe('tool_result');
    expect(msgs[1].content).toBe('+ new line');
  });

  it('parses mcp_tool_call from item.started', () => {
    const parser = new CodexStreamParser();
    const msgs = collectMessages(
      parser,
      '{"type":"item.started","item":{"type":"mcp_tool_call","name":"web_search","input":{"query":"test"}}}\n',
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('tool_call');
    expect(msgs[0].toolName).toBe('web_search');
    expect(msgs[0].content).toContain('"query"');
  });

  it('parses todo_list from item.completed', () => {
    const parser = new CodexStreamParser();
    const msgs = collectMessages(
      parser,
      '{"type":"item.completed","item":{"type":"todo_list","todos":[{"task":"Do thing","done":false}]}}\n',
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('tool_call');
    expect(msgs[0].toolName).toBe('TodoWrite');
  });

  it('parses turn.completed with usage', () => {
    const parser = new CodexStreamParser();
    const msgs = collectMessages(
      parser,
      '{"type":"turn.completed","usage":{"input_tokens":100,"output_tokens":50}}\n',
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('system');
    expect(msgs[0].subType).toBe('result');
    expect(msgs[0].content).toContain('100');
    expect(msgs[0].content).toContain('50');
  });

  it('parses error events', () => {
    const parser = new CodexStreamParser();
    const msgs = collectMessages(
      parser,
      '{"type":"error","message":"Something went wrong"}\n',
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].type).toBe('system');
    expect(msgs[0].subType).toBe('error');
    expect(msgs[0].content).toBe('Something went wrong');
  });

  it('parses turn.failed events', () => {
    const parser = new CodexStreamParser();
    const msgs = collectMessages(
      parser,
      '{"type":"turn.failed","error":{"message":"Rate limited"}}\n',
    );
    expect(msgs).toHaveLength(1);
    expect(msgs[0].subType).toBe('error');
    expect(msgs[0].content).toBe('Rate limited');
  });

  it('ignores turn.started events', () => {
    const parser = new CodexStreamParser();
    const msgs = collectMessages(parser, '{"type":"turn.started"}\n');
    expect(msgs).toHaveLength(0);
  });

  it('ignores reasoning items', () => {
    const parser = new CodexStreamParser();
    const msgs = collectMessages(
      parser,
      '{"type":"item.completed","item":{"type":"reasoning","text":"thinking..."}}\n',
    );
    expect(msgs).toHaveLength(0);
  });

  it('handles buffering across chunks', () => {
    const parser = new CodexStreamParser();
    const messages: ParsedMessage[] = [];
    parser.on('message', (msg: ParsedMessage) => messages.push(msg));

    // Feed partial JSON across two chunks
    parser.feed('{"type":"thread.sta');
    expect(messages).toHaveLength(0);
    parser.feed('rted","thread_id":"x"}\n');
    expect(messages).toHaveLength(1);
    expect(messages[0].content).toContain('x');
  });

  it('handles flush with remaining buffer', () => {
    const parser = new CodexStreamParser();
    const messages: ParsedMessage[] = [];
    parser.on('message', (msg: ParsedMessage) => messages.push(msg));

    // Feed without trailing newline
    parser.feed('{"type":"thread.started","thread_id":"z"}');
    expect(messages).toHaveLength(0);
    parser.flush();
    expect(messages).toHaveLength(1);
    expect(parser.getSessionId()).toBe('z');
  });

  it('strips bash -lc prefix from commands', () => {
    const parser = new CodexStreamParser();
    const msgs = collectMessages(
      parser,
      '{"type":"item.started","item":{"type":"command_execution","command":"bash -lc echo hello"}}\n',
    );
    expect(msgs[0].toolDetail).toBe('echo hello');
  });

  it('handles command_execution with exit code fallback', () => {
    const parser = new CodexStreamParser();
    const msgs = collectMessages(
      parser,
      '{"type":"item.completed","item":{"type":"command_execution","exit_code":1}}\n',
    );
    expect(msgs[0].type).toBe('tool_result');
    expect(msgs[0].content).toBe('Exit code: 1');
  });
});
