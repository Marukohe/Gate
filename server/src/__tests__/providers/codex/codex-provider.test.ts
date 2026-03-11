import { describe, it, expect } from 'vitest';
import { CodexProvider } from '../../../providers/codex/index.js';

describe('CodexProvider', () => {
  const provider = new CodexProvider();

  it('has correct name', () => {
    expect(provider.name).toBe('codex');
  });

  it('builds command with working dir', () => {
    const cmd = provider.buildCommand({ workingDir: '~/project' });
    expect(cmd).toContain('codex');
    expect(cmd).toContain('--json');
    expect(cmd).toContain('cd $HOME/project');
  });

  it('builds command with resume', () => {
    const cmd = provider.buildCommand({ resumeSessionId: 'abc-123' });
    expect(cmd).toContain('resume');
    expect(cmd).toContain('abc-123');
  });

  it('builds command with initial context', () => {
    const cmd = provider.buildCommand({
      workingDir: '~/p',
      initialContext: 'Previous context',
    });
    expect(cmd).toContain('Previous context');
  });

  it('builds command with default prompt when no context', () => {
    const cmd = provider.buildCommand({});
    expect(cmd).toContain('You are ready. Wait for instructions.');
  });

  it('formats input as plain text with newline', () => {
    expect(provider.formatInput('hello')).toBe('hello\n');
  });

  it('returns a summary request string', () => {
    const summary = provider.requestSummary();
    expect(summary).toContain('summarize');
    expect(summary.length).toBeGreaterThan(0);
  });

  it('creates a CodexStreamParser', () => {
    const parser = provider.createParser();
    expect(parser).toBeDefined();
    expect(typeof parser.feed).toBe('function');
    expect(typeof parser.flush).toBe('function');
  });

  it('normalizes tool names', () => {
    expect(provider.normalizeToolName('command_execution')).toBe('Bash');
    expect(provider.normalizeToolName('file_change')).toBe('Edit');
    expect(provider.normalizeToolName('web_search')).toBe('WebSearch');
    expect(provider.normalizeToolName('todo_list')).toBe('TodoWrite');
    expect(provider.normalizeToolName('unknown')).toBe('unknown');
  });

  it('extracts session ID from init message', () => {
    const id = provider.extractSessionId({
      type: 'system',
      subType: 'init',
      content: 'Session started (0199a213-81c0-7800-8aa1-bbab2a035a53)',
      timestamp: Date.now(),
    });
    expect(id).toBe('0199a213-81c0-7800-8aa1-bbab2a035a53');
  });

  it('returns null for non-init messages', () => {
    const id = provider.extractSessionId({
      type: 'assistant',
      content: 'Hello',
      timestamp: Date.now(),
    });
    expect(id).toBeNull();
  });

  it('reports correct capabilities', () => {
    const caps = provider.getCapabilities();
    expect(caps.nativePlanMode).toBe(false);
    expect(caps.nativeTodoTracking).toBe(true);
    expect(caps.supportsResume).toBe(true);
    expect(caps.supportsStdin).toBe(false);
  });
});
