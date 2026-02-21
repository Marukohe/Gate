import { create } from 'zustand';
import { parseMarkdownChecklist } from '@/lib/plan-parser';
import { useUIStore } from './ui-store';

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
}

function toggleStepInList(steps: PlanStep[], stepId: string): PlanStep[] {
  return steps.map((step) => {
    if (step.id === stepId) return { ...step, completed: !step.completed };
    if (step.children) return { ...step, children: toggleStepInList(step.children, stepId) };
    return step;
  });
}

export const usePlanStore = create<PlanStore>((set, get) => ({
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
      const planId = crypto.randomUUID();
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

    useUIStore.getState().setPlanPanelOpen(true);
  },
}));
