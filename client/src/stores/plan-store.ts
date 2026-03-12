import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { parseMarkdownChecklist } from '@/lib/plan-parser';
import { uniqueId } from '@/lib/utils';

export interface PlanStep {
  id: string;
  text: string;
  completed: boolean;
  children?: PlanStep[];
}

export interface Plan {
  id: string;
  sessionId: string;
  title: string;
  content: string;
  steps: PlanStep[];
  status: 'draft' | 'active' | 'completed';
  createdAt: number;
  updatedAt: number;
}

interface PlanStore {
  plans: Record<string, Plan[]>; // keyed by sessionId
  activePlanId: string | null;
  autoExtractedPlanIds: Record<string, string>; // sessionId → planId
  addPlan: (sessionId: string, plan: Plan) => void;
  updatePlan: (sessionId: string, planId: string, updates: Partial<Plan>) => void;
  toggleStep: (sessionId: string, planId: string, stepId: string) => void;
  setActivePlan: (planId: string | null) => void;
  autoExtractPlan: (sessionId: string, content: string) => void;
  extractTodoWrite: (sessionId: string, jsonContent: string) => void;
}

interface TodoEntry {
  text: string;
  completed: boolean;
}

function parseTodoStatus(status: unknown, fallbackCompleted: boolean): boolean {
  if (typeof status === 'string') {
    const normalized = status.toLowerCase();
    return normalized === 'completed' || normalized === 'done';
  }
  return fallbackCompleted;
}

function normalizeTodoEntry(todo: unknown): TodoEntry | null {
  if (!todo || typeof todo !== 'object') return null;
  const record = todo as Record<string, unknown>;
  const text = record.content
    ?? record.task
    ?? record.text
    ?? record.title
    ?? record.label;
  if (typeof text !== 'string' || text.trim().length === 0) return null;

  const completedFlag =
    typeof record.completed === 'boolean' ? record.completed
    : typeof record.done === 'boolean' ? record.done
    : false;

  return {
    text,
    completed: parseTodoStatus(record.status, completedFlag),
  };
}

function normalizeTodoList(parsed: unknown): TodoEntry[] {
  const rawTodos = Array.isArray(parsed)
    ? parsed
    : parsed && typeof parsed === 'object' && Array.isArray((parsed as Record<string, unknown>).todos)
      ? (parsed as Record<string, unknown>).todos as unknown[]
      : [];

  return rawTodos
    .map((todo) => normalizeTodoEntry(todo))
    .filter((todo): todo is TodoEntry => !!todo);
}

function toggleStepInList(steps: PlanStep[], stepId: string): PlanStep[] {
  return steps.map((step) => {
    if (step.id === stepId) return { ...step, completed: !step.completed };
    if (step.children) return { ...step, children: toggleStepInList(step.children, stepId) };
    return step;
  });
}

export const usePlanStore = create<PlanStore>()(
  persist(
  (set, get) => ({
  plans: {},
  activePlanId: null,
  autoExtractedPlanIds: {},
  addPlan: (sessionId, plan) => set((s) => ({
    plans: {
      ...s.plans,
      [sessionId]: [...(s.plans[sessionId] ?? []), plan],
    },
  })),
  updatePlan: (sessionId, planId, updates) => set((s) => ({
    plans: {
      ...s.plans,
      [sessionId]: (s.plans[sessionId] ?? []).map((p) =>
        p.id === planId ? { ...p, ...updates, updatedAt: Date.now() } : p
      ),
    },
  })),
  toggleStep: (sessionId, planId, stepId) => set((s) => ({
    plans: {
      ...s.plans,
      [sessionId]: (s.plans[sessionId] ?? []).map((p) =>
        p.id === planId ? { ...p, steps: toggleStepInList(p.steps, stepId), updatedAt: Date.now() } : p
      ),
    },
  })),
  setActivePlan: (planId) => set({ activePlanId: planId }),
  autoExtractPlan: (sessionId, content) => {
    const { title, steps } = parseMarkdownChecklist(content);
    if (steps.length < 2) return;

    const state = get();
    const existingPlanId = state.autoExtractedPlanIds[sessionId];

    if (existingPlanId) {
      // Update the existing auto-extracted plan
      set((s) => ({
        plans: {
          ...s.plans,
          [sessionId]: (s.plans[sessionId] ?? []).map((p) =>
            p.id === existingPlanId
              ? { ...p, title, steps, content, updatedAt: Date.now() }
              : p
          ),
        },
        activePlanId: existingPlanId,
      }));
    } else {
      // Create a new plan
      const planId = uniqueId();
      const plan: Plan = {
        id: planId,
        sessionId,
        title,
        content,
        steps,
        status: 'active',
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };
      set((s) => ({
        plans: {
          ...s.plans,
          [sessionId]: [...(s.plans[sessionId] ?? []), plan],
        },
        activePlanId: planId,
        autoExtractedPlanIds: {
          ...s.autoExtractedPlanIds,
          [sessionId]: planId,
        },
      }));
    }
  },
  extractTodoWrite: (sessionId, jsonContent) => {
    try {
      const parsed = JSON.parse(jsonContent);
      const todos = normalizeTodoList(parsed);
      if (todos.length < 1) return;

      const steps: PlanStep[] = todos.map((t) => ({
        id: uniqueId(),
        text: t.text,
        completed: t.completed,
      }));
      const title = 'Task Progress';

      const state = get();
      const existingPlanId = state.autoExtractedPlanIds[sessionId];

      if (existingPlanId) {
        set((s) => ({
          plans: {
            ...s.plans,
            [sessionId]: (s.plans[sessionId] ?? []).map((p) =>
              p.id === existingPlanId
                ? { ...p, title, steps, content: jsonContent, updatedAt: Date.now() }
                : p
            ),
          },
          activePlanId: existingPlanId,
        }));
      } else {
        const planId = uniqueId();
        const plan: Plan = {
          id: planId,
          sessionId,
          title,
          content: jsonContent,
          steps,
          status: 'active',
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        set((s) => ({
          plans: {
            ...s.plans,
            [sessionId]: [...(s.plans[sessionId] ?? []), plan],
          },
          activePlanId: planId,
          autoExtractedPlanIds: {
            ...s.autoExtractedPlanIds,
            [sessionId]: planId,
          },
        }));
      }
    } catch (e) {
      console.warn('[plan-store] extractTodoWrite failed:', e);
    }
  },
}),
  {
    name: 'plan-store',
    // Persist plans and mappings; activePlanId is restored per-session in ChatView
    partialize: (state) => ({
      plans: state.plans,
      autoExtractedPlanIds: state.autoExtractedPlanIds,
    }),
  },
));
