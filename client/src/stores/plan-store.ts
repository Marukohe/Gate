import { create } from 'zustand';

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
  addPlan: (sessionId: string, plan: Plan) => void;
  updatePlan: (sessionId: string, planId: string, updates: Partial<Plan>) => void;
  toggleStep: (sessionId: string, planId: string, stepId: string) => void;
  setActivePlan: (planId: string | null) => void;
}

function toggleStepInList(steps: PlanStep[], stepId: string): PlanStep[] {
  return steps.map((step) => {
    if (step.id === stepId) return { ...step, completed: !step.completed };
    if (step.children) return { ...step, children: toggleStepInList(step.children, stepId) };
    return step;
  });
}

export const usePlanStore = create<PlanStore>((set) => ({
  plans: {},
  activePlanId: null,
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
}));
