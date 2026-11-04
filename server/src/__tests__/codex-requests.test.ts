import { expect, it } from 'vitest';
import { describeRequest, decision } from '../codex-requests.js';

it('requires complete question answers and preserves the native response shape', () => {
  const request = describeRequest({ id: 9, method: 'item/tool/requestUserInput', params: { threadId: 'thread',
    questions: [{ id: 'repo', question: 'Which repository?', options: [{ label: 'Current' }] }] } });
  expect(() => decision(request, {}, { answers: { repo: ' ' } })).toThrow('Answer every question');
  expect(decision(request, {}, { answers: { repo: 'Current' } })).toEqual({ answers: { repo: { answers: ['Current'] } } });
});

it('limits permission grants to the requested scope and current turn', () => {
  const params = { threadId: 'thread', permissions: { network: { enabled: true } } };
  const request = describeRequest({ id: 10, method: 'item/permissions/requestApproval', params });
  expect(decision(request, params, { decision: 'accept', scope: 'session', permissions: { filesystem: {} } }))
    .toEqual({ permissions: params.permissions, scope: 'turn' });
  expect(decision(request, params, { decision: 'decline' })).toEqual({ permissions: {}, scope: 'turn' });
  const unsupported = describeRequest({ id: 11, method: 'new/unknown', params });
  expect(() => decision(unsupported, params, { decision: 'accept' })).toThrow('Codex terminal');
});
