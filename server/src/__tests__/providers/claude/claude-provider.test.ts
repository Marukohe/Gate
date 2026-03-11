import { describe, it, expect } from 'vitest';
import { ClaudeProvider } from '../../../providers/claude/index.js';

describe('ClaudeProvider', () => {
  const provider = new ClaudeProvider();

  it('has correct name', () => {
    expect(provider.name).toBe('claude');
  });

  it('builds command with working dir', () => {
    const cmd = provider.buildCommand({ workingDir: '~/project' });
    expect(cmd).toContain('claude ');
    expect(cmd).toContain('--output-format stream-json');
    expect(cmd).toContain('cd $HOME/project');
  });

  it('does not use print mode for interactive sessions', () => {
    const cmd = provider.buildCommand({});
    expect(cmd).not.toContain('claude -p');
  });

  it('builds command with resume session', () => {
    const cmd = provider.buildCommand({ resumeSessionId: 'abc-123' });
    expect(cmd).toContain("--resume 'abc-123'");
  });

  it('formats input as JSON line', () => {
    const input = provider.formatInput('hello');
    const parsed = JSON.parse(input.trim());
    expect(parsed.type).toBe('user');
    expect(parsed.message.content).toBe('hello');
  });

  it('extracts session ID from init message', () => {
    const id = provider.extractSessionId({
      type: 'system',
      subType: 'init',
      content: 'Session started (abc-123)',
      timestamp: Date.now(),
    });
    expect(id).toBe('abc-123');
  });

  it('returns null for non-init messages', () => {
    const id = provider.extractSessionId({
      type: 'assistant',
      content: 'hello',
      timestamp: Date.now(),
    });
    expect(id).toBeNull();
  });

  it('normalizes tool names (identity for Claude)', () => {
    expect(provider.normalizeToolName('Bash')).toBe('Bash');
  });

  it('reports correct capabilities', () => {
    const caps = provider.getCapabilities();
    expect(caps.nativePlanMode).toBe(true);
    expect(caps.supportsResume).toBe(true);
  });
});
