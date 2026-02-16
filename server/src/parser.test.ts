import { describe, it, expect } from 'vitest';
import { ClaudeOutputParser } from './parser.js';

describe('ClaudeOutputParser', () => {
  it('should parse a simple assistant text message', () => {
    const parser = new ClaudeOutputParser();
    const messages: any[] = [];
    parser.onMessage((msg) => messages.push(msg));

    parser.feed('Hello! I can help you with that.\n\n');
    parser.flush();

    expect(messages.length).toBeGreaterThanOrEqual(1);
    expect(messages.some(m => m.type === 'assistant' && m.content.includes('Hello'))).toBe(true);
  });

  it('should strip ANSI escape codes', () => {
    const parser = new ClaudeOutputParser();
    const messages: any[] = [];
    parser.onMessage((msg) => messages.push(msg));

    parser.feed('\x1b[1m\x1b[34mHello World\x1b[0m\n\n');
    parser.flush();

    expect(messages.some(m => m.content.includes('Hello World') && !m.content.includes('\x1b'))).toBe(true);
  });

  it('should detect tool call blocks', () => {
    const parser = new ClaudeOutputParser();
    const messages: any[] = [];
    parser.onMessage((msg) => messages.push(msg));

    parser.feed('I\'ll edit that file for you.\n\n');
    parser.feed('⏺ Edit file: src/index.ts\n');
    parser.feed('  Added line: console.log("hello")\n\n');
    parser.flush();

    expect(messages.some(m => m.type === 'tool_call')).toBe(true);
  });

  it('should detect user prompt', () => {
    const parser = new ClaudeOutputParser();
    const messages: any[] = [];
    parser.onMessage((msg) => messages.push(msg));

    parser.feed('> fix the bug in auth.ts\n');
    parser.flush();

    expect(messages.some(m => m.type === 'user')).toBe(true);
  });

  it('should handle Bash tool calls', () => {
    const parser = new ClaudeOutputParser();
    const messages: any[] = [];
    parser.onMessage((msg) => messages.push(msg));

    parser.feed('⏺ Bash: npm test\n');
    parser.feed('  PASS src/test.ts\n');
    parser.feed('  Tests: 3 passed\n\n');
    parser.flush();

    const toolMsg = messages.find(m => m.type === 'tool_call');
    expect(toolMsg).toBeDefined();
    expect(toolMsg.toolName).toBe('Bash');
  });
});
