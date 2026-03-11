import { describe, it, expect } from 'vitest';
import type { ParsedMessage } from '../../providers/types.js';

describe('Provider types', () => {
  it('ParsedMessage supports provider field', () => {
    const msg: ParsedMessage = {
      type: 'assistant',
      content: 'hello',
      timestamp: Date.now(),
      provider: 'claude',
    };
    expect(msg.provider).toBe('claude');
  });

  it('ParsedMessage provider is optional', () => {
    const msg: ParsedMessage = {
      type: 'assistant',
      content: 'hello',
      timestamp: Date.now(),
    };
    expect(msg.provider).toBeUndefined();
  });
});
