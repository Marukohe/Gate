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
  plans: Record<string, Plan[]>; // keyed by serverId
  activePlanId: string | null;
  addPlan: (serverId: string, plan: Plan) => void;
  updatePlan: (serverId: string, planId: string, updates: Partial<Plan>) => void;
  toggleStep: (serverId: string, planId: string, stepId: string) => void;
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
  addPlan: (serverId, plan) => set((s) => ({
    plans: {
      ...s.plans,
      [serverId]: [...(s.plans[serverId] ?? []), plan],
    },
  })),
  updatePlan: (serverId, planId, updates) => set((s) => ({
    plans: {
      ...s.plans,
      [serverId]: (s.plans[serverId] ?? []).map((p) =>
        p.id === planId ? { ...p, ...updates, updatedAt: Date.now() } : p
      ),
    },
  })),
  toggleStep: (serverId, planId, stepId) => set((s) => ({
    plans: {
      ...s.plans,
      [serverId]: (s.plans[serverId] ?? []).map((p) =>
        p.id === planId ? { ...p, steps: toggleStepInList(p.steps, stepId), updatedAt: Date.now() } : p
      ),
    },
  })),
  setActivePlan: (planId) => set({ activePlanId: planId }),
}));
