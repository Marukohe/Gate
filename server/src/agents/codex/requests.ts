import type { Request } from '../../types.js';
import type { RpcMessage } from './connection.js';

export function describeRequest(message: RpcMessage): Request {
  const p = message.params ?? {};
  const base: Request = { id: String(message.id), threadId: p.threadId ?? '', turnId: p.turnId, method: message.method!,
    title: 'Respond in the Codex terminal', detail: p.reason ?? message.method!, kind: 'unsupported',
    choices: [], questions: [], answering: false };
  if (message.method === 'item/tool/requestUserInput' && Array.isArray(p.questions)) {
    return { ...base, kind: 'question', title: 'Codex needs your answer', questions: p.questions.map((q: any) => ({
      id: String(q.id), text: String(q.question), options: (q.options ?? []).map((o: any) => String(o.label)), secret: !!q.isSecret,
    })) };
  }
  if (['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(message.method!)) {
    return { ...base, kind: 'approval', title: message.method!.includes('commandExecution') ? 'Allow this command?' : 'Allow these file changes?',
      detail: [p.command, p.cwd ?? p.grantRoot, p.reason, p.networkApprovalContext ? JSON.stringify(p.networkApprovalContext) : ''].filter(Boolean).join('\n'),
      choices: ['accept', 'decline', 'cancel'].filter((choice) => !p.availableDecisions || p.availableDecisions.includes(choice)) };
  }
  if (message.method === 'item/permissions/requestApproval') return { ...base, kind: 'permissions', title: 'Allow these permissions for this turn?',
    detail: [p.reason, JSON.stringify(p.permissions, null, 2)].filter(Boolean).join('\n'), choices: ['accept', 'decline'] };
  return base;
}

export function decision(request: Request, params: Record<string, any>, value: any): object {
  if (request.kind === 'approval' || request.kind === 'permissions') {
    if (!request.choices.includes(value?.decision)) throw new Error('Choose an offered decision');
    return request.kind === 'permissions' ? { permissions: value.decision === 'accept' ? params.permissions : {}, scope: 'turn' }
      : { decision: value.decision };
  }
  if (request.kind === 'question') {
    const answers: Record<string, { answers: string[] }> = {};
    for (const q of request.questions) {
      const text = value?.answers?.[q.id];
      if (typeof text !== 'string' || !text.trim() || text.length > 10_000) throw new Error('Answer every question');
      answers[q.id] = { answers: [text] };
    }
    return { answers };
  }
  throw new Error('This request must be answered in the Codex terminal');
}
