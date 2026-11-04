import type { Attention, Question } from './types.js';

export function supportsStructuredAnswers(initialInput: string): boolean {
  try { return JSON.parse(initialInput).gateProtocol >= 2; } catch { return false; }
}

export function supportsNativeCancel(initialInput: string): boolean {
  try { return JSON.parse(initialInput).gateProtocol >= 3; } catch { return false; }
}

export function describeAttention(provider: string, method: string, detail: Record<string, any>):
  Pick<Attention, 'kind' | 'title' | 'questions' | 'choices'> {
  const claudeQuestion = provider === 'claude' && method === 'can_use_tool' && detail.tool_name === 'AskUserQuestion';
  if ((provider === 'codex' && method === 'item/tool/requestUserInput') || claudeQuestion) {
    const raw = claudeQuestion ? detail.input?.questions : detail.questions;
    if (!Array.isArray(raw) || !raw.length || raw.length > 20) {
      return { kind: 'unsupported', title: 'Unsupported question format', questions: [], choices: [] };
    }
    const questions: Question[] = raw.map((question, index) => ({
      id: claudeQuestion ? String(index) : String(question.id), text: String(question.question ?? ''),
      options: Array.isArray(question.options) ? question.options.map((option: any) => ({
        label: String(option.label), description: String(option.description ?? ''),
      })) : [], multiSelect: Boolean(question.multiSelect), secret: Boolean(question.isSecret),
    }));
    return { kind: 'question', title: 'Agent needs your answer', questions, choices: [] };
  }
  if ((provider === 'claude' && method === 'can_use_tool') ||
    (provider === 'codex' && ['item/commandExecution/requestApproval', 'item/fileChange/requestApproval'].includes(method))) {
    const choices = provider === 'codex' && Array.isArray(detail.availableDecisions)
      ? ['accept', 'decline', 'cancel'].filter((value) => detail.availableDecisions.includes(value)) : ['accept', 'decline'];
    if (!choices.length) return { kind: 'unsupported', title: 'No supported approval choice', questions: [], choices: [] };
    return { kind: 'approval', title: provider === 'claude' ? `Allow ${detail.tool_name ?? 'tool'}?` :
      method.includes('commandExecution') ? 'Allow this command?' : 'Allow these file changes?', questions: [], choices };
  }
  return { kind: 'unsupported', title: 'This request requires the native tool', questions: [], choices: [] };
}

export function validateDecision(item: Attention, value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid decision');
  const response = value as Record<string, unknown>;
  if (item.kind === 'failure') {
    if (response.decision !== 'acknowledge') throw new Error('Acknowledge this failure');
    return { decision: 'acknowledge' };
  }
  if (item.kind === 'approval') {
    if (!item.choices.includes(String(response.decision))) throw new Error('Decision is not offered by the provider');
    return { decision: response.decision };
  }
  if (item.kind === 'question') {
    if (!response.answers || typeof response.answers !== 'object') throw new Error('Answer every question');
    const answers: Record<string, string[]> = {};
    for (const question of item.questions) {
      const values = (response.answers as Record<string, unknown>)[question.id];
      if (!Array.isArray(values) || !values.length || values.length > 20 ||
        (!question.multiSelect && values.length !== 1) ||
        values.some((text) => typeof text !== 'string' || !text.trim() || text.length > 10_000 || text.includes('\0'))) {
        throw new Error('Answer every question with nonempty text');
      }
      answers[question.id] = values;
    }
    return { answers };
  }
  throw new Error('Unsupported provider request; stop this run before switching tools');
}
