import type { WorkspacePrState, WorkspaceStatus } from './db.js';

export type WorkspaceAction =
  | 'generate-commit-message'
  | 'commit-push'
  | 'push'
  | 'create-pr'
  | 'mark-review'
  | 'mark-done'
  | 'mark-canceled';

export interface WorkspaceActionUpdate {
  status?: WorkspaceStatus;
  prUrl?: string | null;
  prState?: WorkspacePrState;
}

export function normalizeWorkspaceAction(value?: string): WorkspaceAction | null {
  return value === 'generate-commit-message'
    || value === 'commit-push'
    || value === 'push'
    || value === 'create-pr'
    || value === 'mark-review'
    || value === 'mark-done'
    || value === 'mark-canceled'
    ? value
    : null;
}

export function workspaceActionUpdate(
  action: WorkspaceAction,
  result?: { url?: string | null },
): WorkspaceActionUpdate {
  if (action === 'create-pr') {
    return { status: 'review', prUrl: result?.url ?? null, prState: result?.url ? 'open' : 'unknown' };
  }
  if (action === 'mark-review') return { status: 'review' };
  if (action === 'mark-done') return { status: 'done' };
  if (action === 'mark-canceled') return { status: 'canceled' };
  return {};
}
