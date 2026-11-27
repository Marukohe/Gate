import type { AgentAdapter } from '../backend.js';
import { AgyService } from './backend.js';

export const antigravityAdapter: AgentAdapter = {
  tool: {
    id: 'agy',
    name: 'Antigravity (agy)',
    executable: 'agy',
    description: 'Sign in on this SSH server with agy acp --login. Live status covers work started through Gate.',
  },
  createBackend: () => new AgyService(),
};
