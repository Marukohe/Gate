import { execFileSync } from 'node:child_process';
import { requestRuntime } from './runtime.mjs';

// Observers are advisory: emit no model context, never decide permissions, and never block the native CLI on failure.
if (!process.env.GATE_MANAGED) {
  const timer = setTimeout(() => process.exit(0), 1200);
  try {
    let data = '';
    for await (const chunk of process.stdin) {
      data += chunk;
      if (Buffer.byteLength(data) > 256 * 1024) throw new Error('Hook input too large');
    }
    const input = JSON.parse(data);
    if (!input.agent_id) {
      const [directory, scopeId, provider] = process.argv.slice(2);
      const cwd = execFileSync('git', ['-C', input.cwd, 'rev-parse', '--show-toplevel'],
        { encoding: 'utf8', timeout: 500, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      await requestRuntime(directory, { method: 'observe', scopeId, provider, cwd,
        sessionId: input.session_id, event: input.hook_event_name }, 500);
    }
  } catch {} finally { clearTimeout(timer); }
}
