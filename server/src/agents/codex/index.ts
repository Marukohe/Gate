import type { AgentAdapter } from '../backend.js';
import { CodexService } from './backend.js';

export const codexAdapter: AgentAdapter = {
  tool: {
    id: 'codex',
    name: 'Codex',
    executable: 'codex',
    description: 'Connect to existing terminal sessions through the native shared backend.',
  },
  createBackend: () => new CodexService(),
};
