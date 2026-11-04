// Normalize complete provider messages before journaling; reconnect never depends on parser memory in Gate.
export function createAdapter(config, send, emit, finish) {
  let threadId = config.nativeSessionId;
  let completed = false;
  const pending = new Map();
  const done = (failed, message) => {
    if (completed) return;
    completed = true;
    emit({ type: 'result', failed, message: message ?? null });
    finish(failed);
  };
  const attention = (id, kind, detail) => {
    const key = String(id);
    pending.set(key, { id, kind, detail });
    emit({ type: 'attention', id: key, kind, detail });
  };
  if (config.provider === 'codex') {
    send({ id: 'gate-init', method: 'initialize', params: { clientInfo: { name: 'gate', version: '1.1.0' } } });
  } else if (config.provider === 'claude') {
    send({ type: 'control_request', request_id: 'gate-init', request: { subtype: 'initialize' } });
  } else throw new Error('Unsupported managed provider');

  function message(msg) {
    if (config.provider === 'codex') {
      if (msg.id !== undefined && msg.method) {
        attention(msg.id, msg.method, msg.params ?? {});
        return;
      }
      if (msg.error) { done(true, msg.error.message ?? 'Provider request failed'); return; }
      if (msg.id === 'gate-init') {
        send({ method: 'initialized' });
        send({ id: 'gate-thread', method: threadId ? 'thread/resume' : 'thread/start', params: {
          ...(threadId ? { threadId } : {}), cwd: config.cwd, approvalPolicy: 'on-request',
          sandbox: config.readOnly ? 'read-only' : 'workspace-write',
        } });
      } else if (msg.id === 'gate-thread') {
        threadId = msg.result?.thread?.id;
        if (!threadId) { done(true, 'Provider did not return a thread ID'); return; }
        emit({ type: 'session', nativeSessionId: threadId });
        send({ id: 'gate-turn', method: 'turn/start', params: { threadId,
          input: [{ type: 'text', text: config.prompt }] } });
      } else if (msg.method === 'item/completed') {
        const item = msg.params?.item;
        if (item?.type === 'agentMessage') emit({ type: 'message', text: item.text ?? '' });
        else if (item) emit({ type: 'tool', item });
      } else if (msg.method === 'turn/completed') {
        const turn = msg.params?.turn;
        done(turn?.status !== 'completed', turn?.error?.message ?? (turn?.status === 'interrupted' ? 'Turn interrupted' : null));
      } else if (msg.method === 'serverRequest/resolved') {
        const id = String(msg.params?.requestId);
        if (pending.delete(id)) emit({ type: 'attention-resolved', id });
      } else if (msg.method === 'turn/plan/updated' || msg.method === 'turn/diff/updated') {
        emit({ type: msg.method, ...msg.params });
      }
    } else {
      if (msg.type === 'control_response' && msg.response?.request_id === 'gate-init') {
        if (msg.response.subtype === 'error') { done(true, msg.response.error); return; }
        send({ type: 'user', message: { role: 'user', content: config.prompt }, parent_tool_use_id: null,
          session_id: threadId ?? '' });
      } else if (msg.type === 'control_request') {
        attention(msg.request_id, msg.request?.subtype ?? 'unsupported', msg.request ?? {});
      } else if (msg.type === 'control_cancel_request') {
        const id = String(msg.request_id);
        if (pending.delete(id)) emit({ type: 'attention-resolved', id });
      } else if (msg.type === 'system' && msg.session_id) {
        threadId = msg.session_id;
        emit({ type: 'session', nativeSessionId: threadId });
      } else if (msg.type === 'assistant') {
        for (const item of msg.message?.content ?? []) {
          if (item.type === 'text') emit({ type: 'message', text: item.text });
          else if (item.type === 'tool_use') emit({ type: 'tool', item });
        }
      } else if (msg.type === 'user') {
        for (const item of msg.message?.content ?? []) if (item.type === 'tool_result') emit({ type: 'tool', item });
      } else if (msg.type === 'result') {
        done(Boolean(msg.is_error), msg.is_error ? (msg.errors?.join('; ') || msg.result || msg.subtype) : null);
      }
    }
  }

  function input(value) {
    const request = pending.get(String(value.id));
    if (!request) throw new Error('Decision is no longer pending');
    const { id, kind, detail } = request;
    if (config.provider === 'codex' && ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(kind)) {
      if (!['accept', 'decline'].includes(value.decision)) throw new Error('Choose accept or decline');
      if (detail.availableDecisions && !detail.availableDecisions.includes(value.decision)) {
        throw new Error('Decision is not offered by the provider');
      }
      send({ id, result: { decision: value.decision } });
    } else if (config.provider === 'codex' && kind === 'item/tool/requestUserInput') {
      if (!value.answers || typeof value.answers !== 'object') throw new Error('Answers are required');
      send({ id, result: { answers: value.answers } });
    } else if (config.provider === 'claude' && kind === 'can_use_tool') {
      if (!['accept', 'decline'].includes(value.decision)) throw new Error('Choose accept or decline');
      send({ type: 'control_response', response: { subtype: 'success', request_id: id, response:
        value.decision === 'accept' ? { behavior: 'allow', updatedInput: detail.input } :
          { behavior: 'deny', message: value.message || 'Declined in Gate' } } });
    } else throw new Error('This provider request requires the native tool; stop this run before switching');
    pending.delete(String(id));
    emit({ type: 'attention-resolved', id: String(id) });
  }
  return { message, input, isComplete: () => completed };
}
