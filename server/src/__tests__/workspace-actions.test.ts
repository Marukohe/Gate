import { describe, it, expect } from 'vitest';
import { normalizeWorkspaceAction, workspaceActionUpdate } from '../workspace-actions.js';

describe('workspace actions', () => {
  it('moves a workspace to review when a PR is created', () => {
    expect(workspaceActionUpdate('create-pr', { url: 'https://github.com/acme/repo/pull/1' })).toEqual({
      status: 'review',
      prUrl: 'https://github.com/acme/repo/pull/1',
      prState: 'open',
    });
  });

  it('maps mark actions to workspace statuses', () => {
    expect(workspaceActionUpdate('mark-review')).toEqual({ status: 'review' });
    expect(workspaceActionUpdate('mark-done')).toEqual({ status: 'done' });
    expect(workspaceActionUpdate('mark-canceled')).toEqual({ status: 'canceled' });
  });

  it('accepts commit and push as a workspace action', () => {
    expect(normalizeWorkspaceAction('commit-push')).toBe('commit-push');
  });
});
