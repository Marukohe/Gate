import { describe, expect, it, vi } from 'vitest';
import { shouldAutoStartInteractiveSession } from '../session-start-policy.js';

describe('shouldAutoStartInteractiveSession', () => {
  it('starts a new empty interactive session on connect', () => {
    const db = {
      getMessageCount: vi.fn(() => 0),
      getMessageCountAfter: vi.fn(() => 0),
    };

    expect(shouldAutoStartInteractiveSession(db, { id: 's1', chatStartedAt: null })).toBe(true);
    expect(db.getMessageCount).toHaveBeenCalledWith('s1');
    expect(db.getMessageCountAfter).not.toHaveBeenCalled();
  });

  it('does not restart an existing interactive session just because it was opened', () => {
    const db = {
      getMessageCount: vi.fn(() => 2),
      getMessageCountAfter: vi.fn(() => 0),
    };

    expect(shouldAutoStartInteractiveSession(db, { id: 's1', chatStartedAt: null })).toBe(false);
  });

  it('uses the visible history boundary for reset conversations', () => {
    const db = {
      getMessageCount: vi.fn(() => 3),
      getMessageCountAfter: vi.fn(() => 0),
    };

    expect(shouldAutoStartInteractiveSession(db, { id: 's1', chatStartedAt: 123 })).toBe(true);
    expect(db.getMessageCountAfter).toHaveBeenCalledWith('s1', 123);
    expect(db.getMessageCount).not.toHaveBeenCalled();
  });
});
