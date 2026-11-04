import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createAdapter } from '../../server/runtime/provider.mjs';

function adapter(provider) {
  const sent = [], events = [], finished = [];
  const instance = createAdapter({ provider, cwd: '/repo', prompt: 'A literal $(command)', executable: '/tool' },
    (message) => sent.push(message), (event) => events.push(event), (failed) => finished.push(failed));
  return { ...instance, sent, events, finished };
}

test('Codex performs the handshake, separates approvals from output, and reports semantic failures', () => {
  const a = adapter('codex');
  assert.equal(a.sent[0].method, 'initialize');
  a.message({ id: 'gate-init', result: {} });
  assert.deepEqual(a.sent.slice(1).map((m) => m.method), ['initialized', 'thread/start']);
  assert.equal(a.sent.at(-1).params.approvalPolicy, 'on-request');
  a.message({ id: 'gate-thread', result: { thread: { id: 'thread-1' } } });
  assert.deepEqual(a.sent.at(-1).params.input, [{ type: 'text', text: 'A literal $(command)' }]);
  a.message({ id: 42, method: 'item/commandExecution/requestApproval', params: { command: 'test', availableDecisions: ['accept', 'decline'] } });
  assert.equal(a.events.at(-1).type, 'attention');
  assert.throws(() => a.input({ id: '42', decision: 'always' }), /accept or decline/);
  a.input({ id: '42', decision: 'accept' });
  assert.deepEqual(a.sent.at(-1), { id: 42, result: { decision: 'accept' } });
  assert.throws(() => a.input({ id: '42', decision: 'accept' }), /no longer pending/);
  a.message({ method: 'item/completed', params: { item: { type: 'agentMessage', text: 'Done' } } });
  assert.equal(a.events.at(-1).text, 'Done');
  a.message({ method: 'turn/completed', params: { turn: { status: 'failed', error: { message: 'API unavailable' } } } });
  assert.deepEqual(a.finished, [true]);
  assert.equal(a.events.at(-1).message, 'API unavailable');
});

test('Claude initializes streaming control and returns the exact tool input only after acceptance', () => {
  const a = adapter('claude');
  a.message({ type: 'control_response', response: { subtype: 'success', request_id: 'gate-init', response: {} } });
  assert.equal(a.sent.at(-1).message.content, 'A literal $(command)');
  a.message({ type: 'system', session_id: 'claude-1' });
  assert.equal(a.events.at(-1).nativeSessionId, 'claude-1');
  a.message({ type: 'control_request', request_id: 'approve-1', request: {
    subtype: 'can_use_tool', tool_name: 'Bash', input: { command: 'npm test' },
  } });
  a.input({ id: 'approve-1', decision: 'accept' });
  assert.deepEqual(a.sent.at(-1).response.response, { behavior: 'allow', updatedInput: { command: 'npm test' } });
  a.message({ type: 'assistant', message: { content: [{ type: 'text', text: 'Verified' }] } });
  a.message({ type: 'result', is_error: false });
  assert.deepEqual(a.finished, [false]);
  assert.ok(a.events.some((e) => e.text === 'Verified'));
});

test('Codex exposes offered cancellation and distinguishes interrupted turns from failures', () => {
  const a = adapter('codex');
  a.message({ id: 1, method: 'item/commandExecution/requestApproval', params: { command: 'printf probe', availableDecisions: ['accept', 'cancel'] } });
  assert.throws(() => a.input({ id: '1', decision: 'decline' }), /not offered/);
  a.input({ id: '1', decision: 'cancel' });
  assert.deepEqual(a.sent.at(-1), { id: 1, result: { decision: 'cancel' } });
  a.message({ method: 'turn/completed', params: { turn: { status: 'interrupted', error: null } } });
  assert.deepEqual(a.finished, [false]);
  assert.deepEqual(a.events.at(-1), { type: 'result', failed: false, message: null, interrupted: true });
});

test('unknown provider requests remain pending and never receive an invented approval', () => {
  const a = adapter('codex');
  a.message({ id: 2, method: 'future/requestApproval', params: {} });
  assert.throws(() => a.input({ id: '2', decision: 'accept' }), /native tool/);
  assert.equal(a.sent.length, 1);
  a.message({ method: 'serverRequest/resolved', params: { requestId: 2 } });
  assert.equal(a.events.at(-1).type, 'attention-resolved');
});

test('questions produce provider-specific answers without dropping original Claude tool input', () => {
  const codex = adapter('codex');
  codex.message({ id: 5, method: 'item/tool/requestUserInput', params: { questions: [{ id: 'target', question: 'Target?' }] } });
  codex.input({ id: '5', answers: { target: ['Linux'] } });
  assert.deepEqual(codex.sent.at(-1), { id: 5, result: { answers: { target: { answers: ['Linux'] } } } });
  const claude = adapter('claude');
  const questions = [{ question: 'Features?', multiSelect: true, options: [] }];
  claude.message({ type: 'control_request', request_id: 'q', request: {
    subtype: 'can_use_tool', tool_name: 'AskUserQuestion', input: { questions },
  } });
  claude.input({ id: 'q', answers: { '0': ['Replay', 'Approvals'] } });
  assert.deepEqual(claude.sent.at(-1).response.response, { behavior: 'allow', updatedInput: {
    questions, answers: { 'Features?': 'Replay, Approvals' },
  } });
});

test('Codex review disables inherited MCP servers and plugins before creating a read-only thread', () => {
  const sent = [], finished = [];
  const a = createAdapter({ provider: 'codex', cwd: '/review', prompt: 'Review', readOnly: true },
    (value) => sent.push(value), () => {}, (failed) => finished.push(failed));
  a.message({ id: 'gate-init', result: {} });
  assert.equal(sent.at(-1).method, 'config/read');
  assert.equal(sent.some((value) => value.method === 'thread/start'), false);
  a.message({ id: 'gate-review-config', result: { config: {
    mcp_servers: { 'server.with.dots': { command: '/tool' } }, plugins: { 'plugin@market': { enabled: true } },
  } } });
  assert.equal(sent.at(-1).params.sandbox, 'read-only');
  assert.deepEqual(sent.at(-1).params.config, {
    mcp_servers: { 'server.with.dots': { enabled: false } }, plugins: { 'plugin@market': { enabled: false } },
  });
  a.message({ id: 'gate-review-config', error: { message: 'Unsupported configuration read' } });
  assert.deepEqual(finished, [true]);
});
