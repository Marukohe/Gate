import { antigravityAdapter } from './antigravity/index.js';
import { codexAdapter } from './codex/index.js';
import { AgentService } from './service.js';

export function createAgentService() {
  // An explicit default preserves older server records that have no tool ID.
  return new AgentService([codexAdapter, antigravityAdapter], codexAdapter.tool.id);
}
