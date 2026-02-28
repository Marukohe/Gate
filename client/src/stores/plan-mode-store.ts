import { create } from 'zustand';
import type { ChatMessage } from './chat-store';

export interface PlanQuestionOption {
  label: string;
  description: string;
}

export interface PlanQuestion {
  question: string;
  header: string;
  options: PlanQuestionOption[];
  multiSelect: boolean;
}

type Phase = 'idle' | 'active' | 'question' | 'done';

interface PlanModeStore {
  phase: Phase;
  serverId: string | null;
  sessionId: string | null;
  toolCallCount: number;
  lastToolName: string | null;
  progressMessages: string[];
  currentQuestions: PlanQuestion[];
  selectedAnswers: Record<number, string[]>;
  finalPlanContent: string | null;

  processMessage: (serverId: string, sessionId: string, message: ChatMessage) => void;
  selectAnswer: (questionIndex: number, optionLabel: string) => void;
  deselectAnswer: (questionIndex: number, optionLabel: string) => void;
  submitAnswers: () => string;
  dismiss: () => void;
}

function parseQuestions(content: string): PlanQuestion[] {
  try {
    const input = JSON.parse(content);
    const questions = input.questions;
    if (!Array.isArray(questions)) return [];
    return questions.map((q: any) => ({
      question: q.question ?? '',
      header: q.header ?? '',
      options: Array.isArray(q.options)
        ? q.options.map((o: any) => ({ label: o.label ?? '', description: o.description ?? '' }))
        : [],
      multiSelect: q.multiSelect ?? false,
    }));
  } catch {
    return [];
  }
}

export const usePlanModeStore = create<PlanModeStore>((set, get) => ({
  phase: 'idle',
  serverId: null,
  sessionId: null,
  toolCallCount: 0,
  lastToolName: null,
  progressMessages: [],
  currentQuestions: [],
  selectedAnswers: {},
  finalPlanContent: null,

  processMessage: (serverId, sessionId, message) => {
    const state = get();

    // Enter plan mode on EnterPlanMode tool_call
    if (message.type === 'tool_call' && message.toolName === 'EnterPlanMode') {
      set({
        phase: 'active',
        serverId,
        sessionId,
        toolCallCount: 1,
        lastToolName: 'EnterPlanMode',
        progressMessages: [],
        currentQuestions: [],
        selectedAnswers: {},
        finalPlanContent: null,
      });
      return;
    }

    // Ignore messages when idle or for a different session
    if (state.phase === 'idle') return;
    if (state.sessionId !== sessionId) return;

    // ── question phase: HOLD until user acts ──
    // Under --dangerously-skip-permissions, AskUserQuestion auto-resolves
    // and Claude keeps going. We freeze the UI so the user can still answer.
    // Background: silently track tool counts and capture plan content, but
    // only the user (submit / dismiss) can leave question phase.
    if (state.phase === 'question') {
      if (message.type === 'tool_call') {
        set({ toolCallCount: state.toolCallCount + 1, lastToolName: message.toolName ?? null });
      }
      if (message.type === 'assistant') {
        set({
          progressMessages: [...state.progressMessages, message.content],
          finalPlanContent: message.content,
        });
      }
      // Stay in question phase regardless
      return;
    }

    // AskUserQuestion → enter question phase
    if (message.type === 'tool_call' && message.toolName === 'AskUserQuestion') {
      const questions = parseQuestions(message.content);
      if (questions.length > 0) {
        set({
          phase: 'question',
          currentQuestions: questions,
          selectedAnswers: {},
          toolCallCount: state.toolCallCount + 1,
          lastToolName: 'AskUserQuestion',
        });
        return;
      }
    }

    // ExitPlanMode → done
    if (message.type === 'tool_call' && message.toolName === 'ExitPlanMode') {
      set({
        phase: 'done',
        toolCallCount: state.toolCallCount + 1,
        lastToolName: 'ExitPlanMode',
      });
      return;
    }

    // System result event → finalize if active/done
    if (message.type === 'system' && message.subType === 'result') {
      if (state.phase === 'active' || state.phase === 'done') {
        set({ phase: 'done' });
      }
      return;
    }

    // Any other tool_call while active
    if (message.type === 'tool_call') {
      set({
        phase: 'active',
        toolCallCount: state.toolCallCount + 1,
        lastToolName: message.toolName ?? null,
      });
      return;
    }

    // Assistant text → capture as progress or final plan content
    if (message.type === 'assistant') {
      // In done phase, new assistant text means Claude moved past plan mode.
      // If we already have plan content (set before ExitPlanMode), keep showing it.
      // If not (ExitPlanMode was called without a plan), this is post-plan
      // conversation — auto-dismiss so the user can interact normally.
      if (state.phase === 'done') {
        if (state.finalPlanContent) {
          return;
        }
        set({
          phase: 'idle',
          serverId: null,
          sessionId: null,
          toolCallCount: 0,
          lastToolName: null,
          progressMessages: [],
          currentQuestions: [],
          selectedAnswers: {},
          finalPlanContent: null,
        });
        return;
      }

      if (state.phase === 'active') {
        set({
          progressMessages: [...state.progressMessages, message.content],
          finalPlanContent: message.content,
        });
      }
      return;
    }
  },

  selectAnswer: (questionIndex, optionLabel) => {
    const state = get();
    const current = state.selectedAnswers[questionIndex] ?? [];
    const question = state.currentQuestions[questionIndex];
    if (!question) return;

    if (question.multiSelect) {
      if (!current.includes(optionLabel)) {
        set({ selectedAnswers: { ...state.selectedAnswers, [questionIndex]: [...current, optionLabel] } });
      }
    } else {
      set({ selectedAnswers: { ...state.selectedAnswers, [questionIndex]: [optionLabel] } });
    }
  },

  deselectAnswer: (questionIndex, optionLabel) => {
    const state = get();
    const current = state.selectedAnswers[questionIndex] ?? [];
    set({
      selectedAnswers: {
        ...state.selectedAnswers,
        [questionIndex]: current.filter((l) => l !== optionLabel),
      },
    });
  },

  submitAnswers: () => {
    const state = get();
    // Build a text response summarizing selected answers
    const lines: string[] = [];
    for (let i = 0; i < state.currentQuestions.length; i++) {
      const q = state.currentQuestions[i];
      const selected = state.selectedAnswers[i] ?? [];
      if (selected.length > 0) {
        lines.push(`${q.header}: ${selected.join(', ')}`);
      }
    }
    const answer = lines.join('\n') || 'Continue';
    // Always go back to active — the answer is being sent to Claude and
    // planning will continue. Clear finalPlanContent since whatever Claude
    // generated while we were frozen in question phase was based on the
    // auto-resolved answer, not the user's actual choice.
    set({
      phase: 'active',
      currentQuestions: [],
      selectedAnswers: {},
      finalPlanContent: null,
      progressMessages: [],
    });
    return answer;
  },

  dismiss: () => {
    set({
      phase: 'idle',
      serverId: null,
      sessionId: null,
      toolCallCount: 0,
      lastToolName: null,
      progressMessages: [],
      currentQuestions: [],
      selectedAnswers: {},
      finalPlanContent: null,
    });
  },
}));
