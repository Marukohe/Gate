import type { SessionState } from '../../../server/src/types';

export const labels: Record<SessionState, string> = { running: 'Running', waiting: 'Needs you', idle: 'Idle', saved: 'Saved', error: 'Error', unknown: 'Unknown' };
