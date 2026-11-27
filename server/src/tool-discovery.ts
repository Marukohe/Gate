import { connectSsh, execRemote, quote, type ConnectionSettings } from './ssh.js';
import type { ToolDefinition } from './types.js';

export async function discoverTools(settings: ConnectionSettings, tools: ToolDefinition[]) {
  const ssh = await connectSsh(settings, AbortSignal.timeout(15_000));
  try {
    const checks = tools.map(({ id, executable }) =>
      `if command -v ${quote(executable)} >/dev/null 2>&1; then printf '%s\\n' ${quote(`gate-tool:${id}`)}; fi`);
    // Use the same login PATH as the native adapters. Only resolve commands.
    const output = await execRemote(ssh, `"$SHELL" -lc ${quote(`sh -c ${quote(checks.join('\n'))}`)}`);
    const lines = new Set(output.split('\n'));
    return tools.filter(({ id }) => lines.has(`gate-tool:${id}`)).map(({ id }) => id);
  } finally {
    ssh.end();
  }
}
