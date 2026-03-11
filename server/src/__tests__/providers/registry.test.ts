import { describe, it, expect } from 'vitest';
import { ProviderRegistry } from '../../providers/registry.js';
import type { CLIProvider } from '../../providers/types.js';

function makeMockProvider(name: string): CLIProvider {
  return {
    name,
    buildCommand: () => '',
    formatInput: (t) => t,
    requestSummary: () => '',
    createParser: () => { throw new Error('not implemented'); },
    extractSessionId: () => null,
    normalizeToolName: (n) => n,
    listRemoteSessions: async () => [],
    syncTranscript: async () => [],
    getCapabilities: () => ({
      nativePlanMode: false,
      nativeTodoTracking: false,
      supportsResume: false,
      supportsStdin: false,
    }),
  };
}

describe('ProviderRegistry', () => {
  it('registers and retrieves a provider', () => {
    const registry = new ProviderRegistry();
    const provider = makeMockProvider('claude');
    registry.register(provider);
    expect(registry.get('claude')).toBe(provider);
  });

  it('returns undefined for unknown provider', () => {
    const registry = new ProviderRegistry();
    expect(registry.get('unknown')).toBeUndefined();
  });

  it('lists registered provider names', () => {
    const registry = new ProviderRegistry();
    registry.register(makeMockProvider('claude'));
    registry.register(makeMockProvider('codex'));
    expect(registry.list()).toEqual(['claude', 'codex']);
  });

  it('has a default provider', () => {
    const registry = new ProviderRegistry();
    const claude = makeMockProvider('claude');
    registry.register(claude);
    registry.setDefault('claude');
    expect(registry.getDefault()).toBe(claude);
  });
});
