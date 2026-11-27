import { connectSsh, type ConnectionSettings } from './ssh.js';
import { resolveTools } from './tool-executable.js';
import type { ToolDefinition } from './types.js';

export async function discoverTools(settings: ConnectionSettings, tools: ToolDefinition[]) {
  const ssh = await connectSsh(settings, AbortSignal.timeout(25_000));
  try {
    const found = await resolveTools(ssh, tools.map(({ executable }) => executable));
    return tools.filter(({ executable }) => found.has(executable)).map(({ id }) => id);
  } finally {
    ssh.end();
  }
}
